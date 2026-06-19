-- ============================================================
-- VAiyu: Phase 2 B1 — authenticated cross-tenant scoping, owner financial views
-- ============================================================
-- Phase 1 (20260619000003) removed the anon grant. These views are still PLAIN,
-- so a LOGGED-IN user of hotel A could still read hotel B's revenue/occupancy via
-- a crafted API call. This closes that gap with NO UI slowdown: keep the views
-- plain (sub-ms planning — NOT security_invoker, which would re-introduce the
-- ~90-900ms RLS-expansion planning cost) and add an explicit manager-tier filter
-- vaiyu_can_view_hotel_analytics(hotel_id) (a single cheap EXISTS).
--
-- Audience = manager-tier: these feed the owner Overview/Revenue/Pickup/
-- Reputation pages, which are already owner/manager-gated. Bodies are verbatim
-- from pg_get_viewdef wrapped with the filter, so values are output-identical for
-- any hotel the caller is authorized to see. anon stays revoked (Phase 1).
-- ============================================================

CREATE OR REPLACE VIEW public.owner_hotel_occupancy_daily WITH (security_invoker = false) AS
SELECT _s.* FROM (
 WITH days AS (
         SELECT generate_series((now()::date - '29 days'::interval)::timestamp with time zone, now()::date::timestamp with time zone, '1 day'::interval) AS day_start
        )
 SELECT h.id AS hotel_id,
    h.slug AS hotel_slug,
    h.name AS hotel_name,
    h.rooms_total,
    d.day_start::date AS day,
    count(b.id) AS occupied_rooms,
        CASE
            WHEN COALESCE(h.rooms_total, 0) > 0 THEN round(count(b.id)::numeric / h.rooms_total::numeric * 100::numeric, 1)
            ELSE 0::numeric
        END AS occupancy_percent
   FROM hotels h
     CROSS JOIN days d
     LEFT JOIN bookings b ON b.hotel_id = h.id AND b.scheduled_checkin_at <= d.day_start AND b.scheduled_checkout_at > d.day_start
  GROUP BY h.id, h.slug, h.name, h.rooms_total, d.day_start
  ORDER BY h.slug, (d.day_start::date)
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);

CREATE OR REPLACE VIEW public.owner_hotel_occupancy_snapshot WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT h.id AS hotel_id,
    h.slug AS hotel_slug,
    h.name AS hotel_name,
    h.rooms_total,
    count(b.id) AS occupied_rooms,
        CASE
            WHEN COALESCE(h.rooms_total, 0) > 0 THEN round(count(b.id)::numeric / h.rooms_total::numeric * 100::numeric, 1)
            ELSE 0::numeric
        END AS occupancy_percent
   FROM hotels h
     LEFT JOIN bookings b ON b.hotel_id = h.id AND b.scheduled_checkin_at <= now() AND b.scheduled_checkout_at > now()
  GROUP BY h.id, h.slug, h.name, h.rooms_total
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);

CREATE OR REPLACE VIEW public.owner_hotel_revenue_daily WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT h.id AS hotel_id,
    h.slug AS hotel_slug,
    h.name AS hotel_name,
    date(o.completed_at) AS day,
    sum(o.line_total) AS total_revenue
   FROM hotels h
     JOIN owner_orders_completed o ON o.hotel_id = h.id
  GROUP BY h.id, h.slug, h.name, (date(o.completed_at))
  ORDER BY h.slug, (date(o.completed_at))
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);

CREATE OR REPLACE VIEW public.owner_hotel_revenue_daily_split WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT h.id AS hotel_id,
    h.slug AS hotel_slug,
    h.name AS hotel_name,
    date(o.completed_at) AS day,
    sum(
        CASE
            WHEN o.item_key ~~* 'room%'::text THEN o.line_total
            ELSE 0::numeric
        END) AS room_revenue,
    sum(
        CASE
            WHEN o.item_key ~~* 'fb%'::text OR o.item_key ~~* 'fnb%'::text OR o.item_key ~~* 'f&b%'::text THEN o.line_total
            ELSE 0::numeric
        END) AS fnb_revenue,
    sum(o.line_total) AS total_revenue
   FROM hotels h
     JOIN owner_orders_completed o ON o.hotel_id = h.id
  GROUP BY h.id, h.slug, h.name, (date(o.completed_at))
  ORDER BY h.slug, (date(o.completed_at))
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);

CREATE OR REPLACE VIEW public.owner_nps_30d WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT hotel_id,
    count(*)::integer AS total_responses,
    sum(
        CASE
            WHEN nps_score >= 9 THEN 1
            ELSE 0
        END)::integer AS promoters,
    sum(
        CASE
            WHEN nps_score >= 7 AND nps_score <= 8 THEN 1
            ELSE 0
        END)::integer AS passives,
    sum(
        CASE
            WHEN nps_score <= 6 THEN 1
            ELSE 0
        END)::integer AS detractors,
        CASE
            WHEN count(*) = 0 THEN NULL::numeric
            ELSE (sum(
            CASE
                WHEN nps_score >= 9 THEN 1
                ELSE 0
            END) - sum(
            CASE
                WHEN nps_score <= 6 THEN 1
                ELSE 0
            END))::numeric / count(*)::numeric * 100::numeric
        END AS nps_30d
   FROM reviews r
  WHERE created_at >= ((now() AT TIME ZONE 'utc'::text) - '30 days'::interval) AND nps_score IS NOT NULL
  GROUP BY hotel_id
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);

CREATE OR REPLACE VIEW public.owner_orders_completed WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT id,
    hotel_id,
    booking_code,
    item_key,
    qty,
    price,
    COALESCE(qty, 1)::numeric * COALESCE(price, 0::numeric) AS line_total,
    created_at,
    closed_at AS completed_at
   FROM orders o
  WHERE closed_at IS NOT NULL
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);

CREATE OR REPLACE VIEW public.owner_pickup_daily_v WITH (security_invoker = false) AS
SELECT _s.* FROM (
 WITH base AS (
         SELECT s.hotel_id,
            date_trunc('day'::text, COALESCE(s.created_at, s.scheduled_checkin_at))::date AS day,
            GREATEST(0, date_trunc('day'::text, s.scheduled_checkout_at)::date - date_trunc('day'::text, s.scheduled_checkin_at)::date) AS nights
           FROM stays s
          WHERE s.scheduled_checkin_at IS NOT NULL AND s.scheduled_checkout_at IS NOT NULL
        )
 SELECT hotel_id,
    day,
    sum(nights) AS nights_added,
    count(*) AS bookings_count
   FROM base
  GROUP BY hotel_id, day
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);

CREATE OR REPLACE VIEW public.owner_reputation_v0 WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT d.hotel_id,
    avg(
        CASE
            WHEN s.breached IS TRUE THEN 0
            ELSE 1
        END) AS sla_score
   FROM tickets t
     JOIN departments d ON d.id = t.service_department_id
     LEFT JOIN ticket_sla_state s ON s.ticket_id = t.id
  GROUP BY d.hotel_id
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);

CREATE OR REPLACE VIEW public.owner_revenue_daily_v WITH (security_invoker = false) AS
SELECT _s.* FROM (
 WITH charges_daily AS (
         SELECT fe.hotel_id,
            date_trunc('day'::text, fe.created_at)::date AS day,
            sum(fe.amount) FILTER (WHERE fe.entry_type = 'ROOM_CHARGE'::text) AS room_revenue,
            sum(fe.amount) FILTER (WHERE fe.entry_type = 'FOOD_CHARGE'::text) AS fnb_revenue,
            sum(fe.amount) FILTER (WHERE fe.entry_type = 'SERVICE_CHARGE'::text) AS service_revenue,
            sum(fe.amount) FILTER (WHERE fe.entry_type = 'TAX'::text) AS tax_amount,
            - sum(fe.amount) FILTER (WHERE fe.entry_type = ANY (ARRAY['PAYMENT'::text, 'REFUND'::text])) AS payments_received
           FROM folio_entries fe
          GROUP BY fe.hotel_id, (date_trunc('day'::text, fe.created_at)::date)
        ), rooms_sold_by_day AS (
         SELECT se.hotel_id,
            se.day,
            count(DISTINCT se.room_id)::integer AS rooms_sold
           FROM ( SELECT s.hotel_id,
                    s.room_id,
                    gs.d::date AS day
                   FROM stays s
                     CROSS JOIN LATERAL generate_series(date_trunc('day'::text, s.scheduled_checkin_at)::date::timestamp with time zone, (date_trunc('day'::text, s.scheduled_checkout_at) - '1 day'::interval)::date::timestamp with time zone, '1 day'::interval) gs(d)
                  WHERE s.scheduled_checkin_at IS NOT NULL AND s.scheduled_checkout_at IS NOT NULL) se
          GROUP BY se.hotel_id, se.day
        ), rooms_per_hotel AS (
         SELECT rooms.hotel_id,
            count(*)::integer AS rooms_available
           FROM rooms
          GROUP BY rooms.hotel_id
        )
 SELECT c.hotel_id,
    c.day,
    rph.rooms_available,
    COALESCE(rs.rooms_sold, 0) AS rooms_sold,
    COALESCE(c.room_revenue, 0.0) AS room_revenue,
    COALESCE(c.fnb_revenue, 0.0) AS fnb_revenue,
    COALESCE(c.service_revenue, 0.0) AS service_revenue,
    COALESCE(c.tax_amount, 0.0) AS tax_amount,
    COALESCE(c.room_revenue, 0.0) + COALESCE(c.fnb_revenue, 0.0) + COALESCE(c.service_revenue, 0.0) AS total_revenue,
    COALESCE(c.payments_received, 0.0) AS payments_received
   FROM charges_daily c
     LEFT JOIN rooms_per_hotel rph ON rph.hotel_id = c.hotel_id
     LEFT JOIN rooms_sold_by_day rs ON rs.hotel_id = c.hotel_id AND rs.day = c.day
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);


DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'owner_revenue_daily_v','owner_hotel_revenue_daily','owner_hotel_revenue_daily_split',
    'owner_hotel_occupancy_daily','owner_hotel_occupancy_snapshot','owner_orders_completed',
    'owner_pickup_daily_v','owner_nps_30d','owner_reputation_v0'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', v);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', v);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', v);
  END LOOP;
END $$;
