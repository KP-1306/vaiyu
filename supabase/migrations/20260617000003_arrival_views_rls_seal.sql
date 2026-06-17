-- ============================================================
-- VAiyu: Seal the arrival-view cross-tenant leak (P0)
-- ============================================================
-- FOUND 2026-06-17 (confirmed live on prod with the anon key):
--   The 7 v_arrival_* views + v_owner_arrivals_dashboard were PLAIN views
--   (security_invoker off => base tables read as the postgres owner => RLS
--   bypassed) AND granted SELECT to anon. Result: an UNAUTHENTICATED caller
--   could read guest_name / phone / booking_code / room_numbers / payment
--   state for EVERY hotel via the REST API. Authenticated callers likewise
--   saw all hotels (no hotel scoping anywhere in the chain).
--
-- The 2026-06-16 security_invoker pass only covered v_owner_* analytics views;
-- this operational arrival family was never scoped.
--
-- FIX (same shape proven for the analytics views):
--   * keep them PLAIN (fast: no RLS plan expansion) BUT add an explicit
--     hotel-membership filter inside each view, using the existing
--     SECURITY DEFINER helper public.vaiyu_is_hotel_member(hotel_id).
--     Audience = ANY active member (arrivals is a front-desk surface; not
--     manager-tier). auth.uid() inside the helper always resolves to the real
--     caller, even through the layered plain-view chain.
--   * REVOKE SELECT from anon + PUBLIC; keep authenticated + service_role.
--
-- v_owner_arrivals_dashboard is scoped here (member-tier) and EXCLUDED from the
-- analytics manager-tier migration, because v_arrival_dashboard_rows (the
-- front-desk page's source) reads it; manager-tier would blank the front desk.
--
-- Bodies below are verbatim from pg_get_viewdef with ONLY the membership
-- predicate added. Column sets are unchanged, so CREATE OR REPLACE is safe for
-- the dependent views (no drop/recreate, dependency order irrelevant).
-- ============================================================

-- ---------- Leaf views (no hotel_id in output: filter on the base table) ----------

CREATE OR REPLACE VIEW public.v_arrival_guest_labels WITH (security_invoker = false) AS
  SELECT b.id AS booking_id,
     g.vip_flag,
     g.loyalty_tier,
     b.source AS booking_source,
         CASE
             WHEN g.vip_flag THEN 'VIP'::text
             WHEN b.source::text = ANY (ARRAY['booking.com'::text, 'expedia'::text, 'airbnb'::text]) THEN 'OTA'::text
             ELSE 'DIRECT'::text
         END AS arrival_badge
    FROM bookings b
      LEFT JOIN guests g ON g.id = b.guest_id
   WHERE public.vaiyu_is_hotel_member(b.hotel_id);

CREATE OR REPLACE VIEW public.v_arrival_housekeeping_eta WITH (security_invoker = false) AS
  SELECT room_id,
     min(estimated_completion_at) AS estimated_completion_at,
     min(EXTRACT(epoch FROM estimated_completion_at - now()) / 60::numeric) AS minutes_remaining
    FROM housekeeping_tasks
   WHERE status = 'in_progress'::text
     AND public.vaiyu_is_hotel_member(housekeeping_tasks.hotel_id)
   GROUP BY room_id;

CREATE OR REPLACE VIEW public.v_arrival_payment_state WITH (security_invoker = false) AS
  SELECT b.id AS booking_id,
     COALESCE(sum(fe.amount) FILTER (WHERE fe.entry_type = ANY (ARRAY['ROOM_CHARGE'::text, 'FOOD_CHARGE'::text, 'SERVICE_CHARGE'::text, 'TAX'::text, 'ADJUSTMENT'::text])), 0::numeric) AS total_amount,
     COALESCE(- sum(fe.amount) FILTER (WHERE fe.entry_type = ANY (ARRAY['PAYMENT'::text, 'REFUND'::text])), 0::numeric) AS paid_amount,
     COALESCE(sum(fe.amount) FILTER (WHERE fe.entry_type = ANY (ARRAY['ROOM_CHARGE'::text, 'FOOD_CHARGE'::text, 'SERVICE_CHARGE'::text, 'TAX'::text, 'ADJUSTMENT'::text, 'PAYMENT'::text, 'REFUND'::text])), 0::numeric) AS pending_amount,
         CASE
             WHEN COALESCE(sum(fe.amount) FILTER (WHERE fe.entry_type = ANY (ARRAY['ROOM_CHARGE'::text, 'FOOD_CHARGE'::text, 'SERVICE_CHARGE'::text, 'TAX'::text, 'ADJUSTMENT'::text, 'PAYMENT'::text, 'REFUND'::text])), 0::numeric) > 0::numeric THEN true
             ELSE false
         END AS payment_pending,
     COALESCE(sum(fe.amount) FILTER (WHERE fe.entry_type = 'ROOM_CHARGE'::text), 0::numeric) AS room_charges,
     COALESCE(sum(fe.amount) FILTER (WHERE fe.entry_type = 'FOOD_CHARGE'::text), 0::numeric) AS food_charges,
     COALESCE(sum(fe.amount) FILTER (WHERE fe.entry_type = 'SERVICE_CHARGE'::text), 0::numeric) AS service_charges,
     COALESCE(sum(fe.amount) FILTER (WHERE fe.entry_type = 'TAX'::text), 0::numeric) AS tax_amount,
     COALESCE(- sum(fe.amount) FILTER (WHERE fe.entry_type = 'ADJUSTMENT'::text AND fe.amount < 0::numeric), 0::numeric) AS discount_amount,
     COALESCE(sum(fe.amount) FILTER (WHERE fe.entry_type = 'ADJUSTMENT'::text AND fe.amount > 0::numeric), 0::numeric) AS surcharge_amount
    FROM bookings b
      LEFT JOIN folio_entries fe ON fe.booking_id = b.id
   WHERE public.vaiyu_is_hotel_member(b.hotel_id)
   GROUP BY b.id;

CREATE OR REPLACE VIEW public.v_arrival_priority WITH (security_invoker = false) AS
  SELECT br.room_id,
     b.id AS booking_id,
     b.code AS booking_code,
     b.guest_name,
     b.scheduled_checkin_at,
     GREATEST(EXTRACT(epoch FROM b.scheduled_checkin_at - now())::integer / 60, 0) AS arrival_needed_in_minutes,
         CASE
             WHEN (EXTRACT(epoch FROM b.scheduled_checkin_at - now()) / 60::numeric) <= 30::numeric THEN 'CRITICAL'::text
             WHEN (EXTRACT(epoch FROM b.scheduled_checkin_at - now()) / 60::numeric) <= 120::numeric THEN 'HIGH'::text
             WHEN (EXTRACT(epoch FROM b.scheduled_checkin_at - now()) / 60::numeric) <= 360::numeric THEN 'MEDIUM'::text
             ELSE 'LOW'::text
         END AS arrival_urgency
    FROM bookings b
      JOIN booking_rooms br ON br.booking_id = b.id
   WHERE (b.status = ANY (ARRAY['CONFIRMED'::text, 'PRE_CHECKED_IN'::text]))
     AND b.scheduled_checkin_at > now()
     AND public.vaiyu_is_hotel_member(b.hotel_id);

-- ---------- Base view with hotel_id ----------

CREATE OR REPLACE VIEW public.v_arrival_operational_state WITH (security_invoker = false) AS
  WITH room_states AS (
          SELECT br.booking_id,
             string_agg(r.number, ', '::text) AS room_numbers,
             count(*) AS rooms_total,
             count(*) FILTER (WHERE br.status = 'CHECKED_IN'::text) AS rooms_checked_in,
             count(*) FILTER (WHERE br.room_id IS NULL) AS rooms_unassigned,
             count(*) FILTER (WHERE br.room_id IS NOT NULL AND r.housekeeping_status = 'dirty'::housekeeping_status_enum) AS rooms_dirty,
             count(*) FILTER (WHERE br.room_id IS NOT NULL AND (r.housekeeping_status = ANY (ARRAY['clean'::housekeeping_status_enum, 'inspected'::housekeeping_status_enum, 'pickup'::housekeeping_status_enum]))) AS rooms_clean
            FROM booking_rooms br
              LEFT JOIN rooms r ON r.id = br.room_id
           GROUP BY br.booking_id
         ), stay_states AS (
          SELECT stays.booking_id,
             count(*) FILTER (WHERE stays.status = 'inhouse'::stay_status) AS inhouse_count,
             count(*) FILTER (WHERE stays.status = 'checkout_requested'::stay_status) AS checkout_requested_count,
             max(stays.id::text) FILTER (WHERE stays.status = ANY (ARRAY['inhouse'::stay_status, 'checkout_requested'::stay_status]))::uuid AS active_stay_id
            FROM stays
           GROUP BY stays.booking_id
         )
  SELECT b.id AS booking_id,
     b.hotel_id,
     b.code AS booking_code,
     b.guest_name,
     b.phone,
     b.status AS booking_status,
     b.scheduled_checkin_at,
     b.scheduled_checkout_at,
     rs.room_numbers,
     COALESCE(rs.rooms_total, 0::bigint) AS rooms_total,
     COALESCE(rs.rooms_checked_in, 0::bigint) AS rooms_checked_in,
     COALESCE(rs.rooms_unassigned, 0::bigint) AS rooms_unassigned,
     COALESCE(rs.rooms_dirty, 0::bigint) AS rooms_dirty,
     COALESCE(rs.rooms_clean, 0::bigint) AS rooms_clean,
     COALESCE(ss.inhouse_count, 0::bigint) AS inhouse_rooms,
     ss.active_stay_id,
         CASE
             WHEN COALESCE(ss.checkout_requested_count, 0::bigint) > 0 THEN 'CHECKOUT_REQUESTED'::text
             WHEN b.status = 'CHECKED_IN'::text THEN 'CHECKED_IN'::text
             WHEN b.status = 'PARTIALLY_CHECKED_IN'::text THEN 'PARTIALLY_ARRIVED'::text
             WHEN b.status = 'CHECKED_OUT'::text THEN 'CHECKED_OUT'::text
             WHEN COALESCE(rs.rooms_total, 0::bigint) = 0 THEN 'NO_ROOMS'::text
             WHEN COALESCE(rs.rooms_checked_in, 0::bigint) = COALESCE(rs.rooms_total, 0::bigint) AND COALESCE(rs.rooms_total, 0::bigint) > 0 THEN 'CHECKED_IN'::text
             WHEN COALESCE(rs.rooms_checked_in, 0::bigint) > 0 THEN 'PARTIALLY_ARRIVED'::text
             WHEN COALESCE(rs.rooms_dirty, 0::bigint) > 0 THEN 'WAITING_HOUSEKEEPING'::text
             WHEN COALESCE(rs.rooms_unassigned, 0::bigint) > 0 THEN 'WAITING_ROOM_ASSIGNMENT'::text
             WHEN COALESCE(rs.rooms_clean, 0::bigint) = COALESCE(rs.rooms_total, 0::bigint) AND COALESCE(rs.rooms_total, 0::bigint) > 0 THEN 'READY_TO_CHECKIN'::text
             ELSE 'EXPECTED'::text
         END AS arrival_operational_state,
         CASE
             WHEN COALESCE(rs.rooms_clean, 0::bigint) = COALESCE(rs.rooms_total, 0::bigint) AND COALESCE(rs.rooms_total, 0::bigint) > 0 THEN true
             ELSE false
         END AS rooms_ready_for_arrival,
         CASE
             WHEN COALESCE(rs.rooms_total, 0::bigint) = 0 OR COALESCE(rs.rooms_checked_in, 0::bigint) = COALESCE(rs.rooms_total, 0::bigint) THEN 'NONE'::text
             WHEN COALESCE(rs.rooms_dirty, 0::bigint) > 0 THEN 'WAIT_HOUSEKEEPING'::text
             ELSE 'CHECKIN'::text
         END AS primary_action
    FROM bookings b
      LEFT JOIN room_states rs ON rs.booking_id = b.id
      LEFT JOIN stay_states ss ON ss.booking_id = b.id
   WHERE (b.status = ANY (ARRAY['CREATED'::text, 'CONFIRMED'::text, 'PRE_CHECKED_IN'::text, 'PARTIALLY_CHECKED_IN'::text, 'CHECKED_IN'::text]))
     AND (b.status <> ALL (ARRAY['CANCELLED'::text, 'NO_SHOW'::text]))
     AND public.vaiyu_is_hotel_member(b.hotel_id);

-- ---------- Composite views (inherit + explicit member filter, defense-in-depth) ----------

CREATE OR REPLACE VIEW public.v_owner_arrivals_dashboard WITH (security_invoker = false) AS
  WITH base AS (
          SELECT v_arrival_operational_state.booking_id,
             v_arrival_operational_state.hotel_id,
             v_arrival_operational_state.booking_code,
             v_arrival_operational_state.guest_name,
             v_arrival_operational_state.phone,
             v_arrival_operational_state.booking_status,
             v_arrival_operational_state.scheduled_checkin_at,
             v_arrival_operational_state.scheduled_checkout_at,
             v_arrival_operational_state.room_numbers,
             v_arrival_operational_state.rooms_total,
             v_arrival_operational_state.rooms_checked_in,
             v_arrival_operational_state.rooms_unassigned,
             v_arrival_operational_state.rooms_dirty,
             v_arrival_operational_state.rooms_clean,
             v_arrival_operational_state.inhouse_rooms,
             v_arrival_operational_state.active_stay_id,
             v_arrival_operational_state.arrival_operational_state,
             v_arrival_operational_state.rooms_ready_for_arrival,
             v_arrival_operational_state.primary_action
            FROM v_arrival_operational_state
         ), timers AS (
          SELECT base.booking_id,
             EXTRACT(epoch FROM now() - base.scheduled_checkin_at) / 60::numeric AS minutes_since_scheduled_arrival
            FROM base
         )
  SELECT b.booking_id,
     b.hotel_id,
     b.booking_code,
     b.booking_status,
     b.guest_name,
     b.phone,
     b.scheduled_checkin_at,
     b.scheduled_checkout_at,
     b.room_numbers,
     b.rooms_total,
     b.rooms_checked_in,
     b.rooms_unassigned,
     b.rooms_dirty,
     b.rooms_clean,
     b.inhouse_rooms,
     b.active_stay_id,
     b.arrival_operational_state,
     b.rooms_ready_for_arrival,
     b.primary_action,
     t.minutes_since_scheduled_arrival,
         CASE
             WHEN t.minutes_since_scheduled_arrival > 60::numeric THEN 'CRITICAL'::text
             WHEN t.minutes_since_scheduled_arrival > 30::numeric THEN 'HIGH'::text
             WHEN t.minutes_since_scheduled_arrival > 10::numeric THEN 'MEDIUM'::text
             ELSE 'LOW'::text
         END AS urgency_level,
     b.rooms_ready_for_arrival AS eligible_for_bulk_checkin
    FROM base b
      LEFT JOIN timers t ON t.booking_id = b.booking_id
   WHERE public.vaiyu_is_hotel_member(b.hotel_id);

CREATE OR REPLACE VIEW public.v_arrival_dashboard_rows WITH (security_invoker = false) AS
  SELECT a.booking_id,
     a.hotel_id,
     a.booking_code,
     a.booking_status,
     a.guest_name,
     a.phone,
     a.scheduled_checkin_at,
     a.scheduled_checkout_at,
     a.room_numbers,
     a.rooms_total,
     a.rooms_checked_in,
     a.rooms_unassigned,
     a.rooms_dirty,
     a.rooms_clean,
     a.inhouse_rooms,
     a.active_stay_id,
     a.arrival_operational_state,
     a.rooms_ready_for_arrival,
     a.primary_action,
     a.minutes_since_scheduled_arrival,
     a.urgency_level,
     a.eligible_for_bulk_checkin,
     COALESCE(p.payment_pending, false) AS payment_pending,
     COALESCE(p.pending_amount, 0::numeric) AS pending_amount,
     l.arrival_badge,
     COALESCE(l.vip_flag, false) AS vip_flag,
     hk.cleaning_minutes_remaining,
     COALESCE(p.total_amount, 0::numeric) AS total_amount,
     COALESCE(p.paid_amount, 0::numeric) AS paid_amount,
     b.adults_total,
     b.children_total,
     b.expected_arrival_at
    FROM v_owner_arrivals_dashboard a
      LEFT JOIN v_arrival_payment_state p ON p.booking_id = a.booking_id
      LEFT JOIN v_arrival_guest_labels l ON l.booking_id = a.booking_id
      LEFT JOIN bookings b ON b.id = a.booking_id
      LEFT JOIN ( SELECT br.booking_id,
             min(h.minutes_remaining) AS cleaning_minutes_remaining
            FROM booking_rooms br
              JOIN v_arrival_housekeeping_eta h ON h.room_id = br.room_id
           GROUP BY br.booking_id) hk ON hk.booking_id = a.booking_id
   WHERE public.vaiyu_is_hotel_member(a.hotel_id);

CREATE OR REPLACE VIEW public.v_arrival_dashboard_summary WITH (security_invoker = false) AS
  SELECT hotel_id,
     count(*) AS total_arrivals,
     count(*) FILTER (WHERE arrival_operational_state = ANY (ARRAY['CHECKED_IN'::text, 'PARTIALLY_ARRIVED'::text])) AS arrived,
     count(*) FILTER (WHERE rooms_ready_for_arrival) AS ready_to_checkin,
     count(*) FILTER (WHERE arrival_operational_state = 'WAITING_ROOM_ASSIGNMENT'::text) AS waiting_room_assignment,
     count(*) FILTER (WHERE payment_pending) AS payment_pending,
     count(*) FILTER (WHERE vip_flag) AS vip_today
    FROM v_arrival_dashboard_rows
   WHERE public.vaiyu_is_hotel_member(hotel_id)
   GROUP BY hotel_id;

-- ---------- Lock down grants: no anon, no PUBLIC ----------
DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'v_arrival_operational_state','v_arrival_dashboard_rows','v_arrival_dashboard_summary',
    'v_arrival_guest_labels','v_arrival_housekeeping_eta','v_arrival_payment_state',
    'v_arrival_priority','v_owner_arrivals_dashboard'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', v);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', v);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', v);
  END LOOP;
END $$;
