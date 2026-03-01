-- ============================================================
-- STAY VIEWS (Enterprise-Grade)
-- Composable view pattern for guest-facing data layers
-- ============================================================

-- ============================================================
-- DROP existing views to handle column type changes
-- (PostgreSQL cannot change column types with CREATE OR REPLACE)
-- Order matters: drop dependent views first
-- ============================================================
DROP VIEW IF EXISTS public.v_guest_home_dashboard CASCADE;
DROP VIEW IF EXISTS public.v_guest_home_dashboard_base CASCADE;
DROP VIEW IF EXISTS public.user_recent_stays CASCADE;
DROP VIEW IF EXISTS public.v_guest_stay_hero CASCADE;
DROP VIEW IF EXISTS public.v_guest_stay_hero_base CASCADE;
DROP VIEW IF EXISTS public.user_stay_detail CASCADE;

-- ============================================================
-- LAYER 1: GUEST STAY HERO BASE VIEW (Unfiltered)
-- ============================================================
CREATE OR REPLACE VIEW public.v_guest_stay_hero_base AS
SELECT
  s.id AS stay_id,
  s.guest_id,
  s.hotel_id,
  s.booking_code,
  s.is_vip,
  s.is_active,
  
  -- Hotel info
  h.name AS hotel_name,
  h.slug AS hotel_slug,
  h.city AS hotel_city,
  h.phone AS hotel_phone,
  h.wa_display_number AS hotel_whatsapp,
  h.email AS hotel_email,
  
  -- Room info
  r.id AS room_id,
  r.number AS room_number,
  rt.name AS room_type,
  
  -- Raw status
  s.status AS stay_status,
  
  -- Lifecycle Phase Classification
  CASE
    WHEN s.status = 'arriving'::stay_status THEN 'UPCOMING'::text
    WHEN s.status = 'inhouse'::stay_status THEN 'ACTIVE'::text
    WHEN s.status = 'checked_out'::stay_status THEN 'COMPLETED'::text
    WHEN s.status = 'cancelled'::stay_status THEN 'CANCELLED'::text
    WHEN s.status = 'no_show'::stay_status THEN 'NO_SHOW'::text
    ELSE 'OTHER'::text
  END AS lifecycle_phase,
  
  -- Hero Title (UI-ready)
  CASE
    WHEN s.status = 'arriving'::stay_status THEN 'Your upcoming stay at '::text || h.name
    WHEN s.status = 'inhouse'::stay_status THEN 'Your stay at '::text || h.name
    WHEN s.status = 'checked_out'::stay_status THEN 'Your recent stay at '::text || h.name
    WHEN s.status = 'cancelled'::stay_status THEN 'Cancelled stay at '::text || h.name
    ELSE 'Stay at '::text || h.name
  END AS hero_title,
  
  -- Timestamps (Canonical)
  s.scheduled_checkin_at,
  s.scheduled_checkout_at,
  s.actual_checkin_at,
  s.actual_checkout_at,
  
  -- DISPLAY LOGIC
  COALESCE(s.actual_checkin_at, s.scheduled_checkin_at) AS display_checkin_at,
  
  CASE
    WHEN s.status = 'checked_out'::stay_status THEN COALESCE(s.actual_checkout_at, s.scheduled_checkout_at)
    ELSE s.scheduled_checkout_at
  END AS display_checkout_at,
  
  -- Helper labels for UI
  CASE
    WHEN s.status = 'inhouse'::stay_status AND s.actual_checkin_at IS NOT NULL THEN 'Checked-in'::text
    ELSE 'Check-in'::text
  END AS checkin_label,
  
  CASE
    WHEN s.status = 'inhouse'::stay_status THEN 'Checkout'::text
    ELSE 'Check-out'::text
  END AS checkout_label,
  
  -- CTA Logic (Frontend Flags)
  s.status = 'arriving'::stay_status AS can_checkin,
  s.status = 'inhouse'::stay_status AS can_request_service,
  s.status = 'inhouse'::stay_status AS can_express_checkout,
  s.status = 'inhouse'::stay_status AS can_order_food,
  s.status = ANY (ARRAY['inhouse'::stay_status, 'checked_out'::stay_status]) AS can_view_bill,
  s.status = 'checked_out'::stay_status AS can_download_invoice,
  s.status = 'checked_out'::stay_status AS can_book_again,
  s.status = 'arriving'::stay_status AS can_modify_booking,
  s.status = 'arriving'::stay_status AS can_cancel_booking,
  
  -- Status Badge Helpers
  CASE
    WHEN s.status = 'inhouse'::stay_status THEN 'success'::text
    WHEN s.status = 'arriving'::stay_status THEN 'warning'::text
    WHEN s.status = 'checked_out'::stay_status THEN 'neutral'::text
    WHEN s.status = 'cancelled'::stay_status THEN 'error'::text
    WHEN s.status = 'no_show'::stay_status THEN 'error'::text
    ELSE 'neutral'::text
  END AS badge_variant,
  
  CASE
    WHEN s.status = 'inhouse'::stay_status THEN '✓ Checked-in'::text
    WHEN s.status = 'arriving'::stay_status THEN 'Upcoming'::text
    WHEN s.status = 'checked_out'::stay_status THEN '✓ Completed'::text
    WHEN s.status = 'cancelled'::stay_status THEN 'Cancelled'::text
    WHEN s.status = 'no_show'::stay_status THEN 'No Show'::text
    ELSE NULL::text
  END AS badge_text,
  
  -- Standard Metadata
  s.created_at,
  s.updated_at

FROM stays s
JOIN hotels h ON h.id = s.hotel_id
JOIN rooms r ON r.id = s.room_id
LEFT JOIN room_types rt ON rt.id = r.room_type_id;

-- SECURITY: Only grant to service_role by default, but authenticated users need it for derived views
GRANT SELECT ON public.v_guest_stay_hero_base TO service_role;
GRANT SELECT ON public.v_guest_stay_hero_base TO authenticated;


-- ============================================================
-- LAYER 2: SCROPED HERO VIEW
-- ============================================================
CREATE OR REPLACE VIEW public.v_guest_stay_hero AS
SELECT
  stay_id,
  guest_id,
  hotel_id,
  booking_code,
  is_vip,
  is_active,
  hotel_name,
  hotel_slug,
  hotel_city,
  hotel_phone,
  hotel_whatsapp,
  hotel_email,
  room_id,
  room_number,
  room_type,
  stay_status,
  lifecycle_phase,
  hero_title,
  scheduled_checkin_at,
  scheduled_checkout_at,
  actual_checkin_at,
  actual_checkout_at,
  display_checkin_at,
  display_checkout_at,
  checkin_label,
  checkout_label,
  can_checkin,
  can_request_service,
  can_express_checkout,
  can_order_food,
  can_view_bill,
  can_download_invoice,
  can_book_again,
  can_modify_booking,
  can_cancel_booking,
  badge_variant,
  badge_text,
  created_at,
  updated_at
FROM
  public.v_guest_stay_hero_base h
WHERE
  guest_id = public.current_guest_id ()
  OR (
    EXISTS (
      SELECT 1
      FROM public.stay_guests sg
      WHERE sg.stay_id = h.stay_id
        AND sg.guest_id = public.current_guest_id ()
    )
  );

GRANT SELECT ON public.v_guest_stay_hero TO authenticated;


-- ============================================================
-- LAYER 3: GUEST HOME DASHBOARD BASE
-- ============================================================
CREATE OR REPLACE VIEW public.v_guest_home_dashboard_base AS
SELECT
  vh.stay_id,
  vh.guest_id,
  vh.hotel_id,
  vh.booking_code,
  vh.hotel_name,
  vh.hotel_city,
  vh.hotel_slug,
  vh.hotel_phone,
  vh.hotel_whatsapp,
  vh.hotel_email,
  vh.room_id,
  vh.room_number,
  vh.room_type,
  vh.stay_status,
  vh.lifecycle_phase,
  vh.display_checkin_at,
  vh.display_checkout_at,
  vh.checkin_label,
  vh.checkout_label,
  vh.hero_title,
  vh.badge_variant,
  vh.badge_text,
  vh.can_checkin,
  vh.can_request_service,
  vh.can_express_checkout,
  vh.can_order_food,
  vh.can_view_bill,
  vh.can_download_invoice,
  COALESCE(svc.active_count, 0) > 0 AS has_active_service_request,
  COALESCE(svc.active_count, 0) AS active_service_count,
  vh.can_view_bill AS has_bill,
  NULL::numeric AS bill_total,
  NULL::integer AS reward_points,
  NULL::text AS reward_tier,
  vh.is_vip,
  vh.is_active,
  vh.created_at,
  vh.updated_at
FROM
  public.v_guest_stay_hero_base vh
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::integer AS active_count
    FROM
      tickets t
    WHERE
      t.stay_id = vh.stay_id
      AND (
        t.status = ANY (ARRAY['NEW'::text, 'IN_PROGRESS'::text])
      )
  ) svc ON TRUE;

GRANT SELECT ON public.v_guest_home_dashboard_base TO service_role;


-- ============================================================
-- LAYER 4: GUEST HOME DASHBOARD (User-Scoped)
-- ============================================================
CREATE OR REPLACE VIEW public.v_guest_home_dashboard AS
SELECT
  stay_id,
  guest_id,
  hotel_id,
  booking_code,
  hotel_name,
  hotel_city,
  hotel_slug,
  hotel_phone,
  hotel_whatsapp,
  hotel_email,
  room_id,
  room_number,
  room_type,
  stay_status,
  lifecycle_phase,
  display_checkin_at,
  display_checkout_at,
  checkin_label,
  checkout_label,
  hero_title,
  badge_variant,
  badge_text,
  can_checkin,
  can_request_service,
  can_express_checkout,
  can_order_food,
  can_view_bill,
  can_download_invoice,
  has_active_service_request,
  active_service_count,
  has_bill,
  bill_total,
  reward_points,
  reward_tier,
  is_vip,
  is_active,
  created_at,
  updated_at
FROM
  public.v_guest_home_dashboard_base h
WHERE
  guest_id = public.current_guest_id ()
  OR (
    EXISTS (
      SELECT 1
      FROM public.stay_guests sg
      WHERE sg.stay_id = h.stay_id
        AND sg.guest_id = public.current_guest_id ()
    )
  );

GRANT SELECT ON public.v_guest_home_dashboard TO authenticated;


-- ============================================================
-- View: user_recent_stays
-- ============================================================
CREATE OR REPLACE VIEW public.user_recent_stays AS
SELECT
  stay_id AS id,
  guest_id,
  hotel_id,
  booking_code,
  is_vip,
  is_active,
  stay_status AS status,
  lifecycle_phase,
  lifecycle_phase AS stay_phase,
  hero_title,
  hotel_name,
  hotel_slug,
  hotel_city,
  hotel_phone,
  hotel_whatsapp,
  hotel_email,
  room_id,
  room_number,
  room_type,
  scheduled_checkin_at AS check_in,
  scheduled_checkout_at AS check_out,
  actual_checkin_at,
  actual_checkout_at,
  display_checkin_at,
  display_checkout_at,
  checkin_label,
  checkout_label,
  can_checkin,
  can_request_service,
  can_express_checkout,
  can_order_food,
  can_view_bill,
  can_download_invoice,
  can_book_again,
  can_modify_booking,
  can_cancel_booking,
  badge_variant,
  badge_text,
  NULL::numeric AS bill_total,
  created_at,
  updated_at
FROM
  public.v_guest_stay_hero;

GRANT SELECT ON public.user_recent_stays TO authenticated;


-- ============================================================
-- View: user_stay_detail
-- ============================================================
CREATE OR REPLACE VIEW public.user_stay_detail AS
SELECT
  s.id AS stay_id,
  s.guest_id AS user_id,
  s.hotel_id,
  s.scheduled_checkin_at AS checkin_at,
  s.scheduled_checkout_at AS checkout_at,
  s.actual_checkin_at,
  s.actual_checkout_at,
  s.status,
  s.source,
  s.booking_code,
  r.number AS room_number,
  h.name AS hotel_name,
  h.slug
FROM
  public.stays s
  JOIN public.hotels h ON h.id = s.hotel_id
  JOIN public.rooms r ON r.id = s.room_id
WHERE
  s.guest_id = public.current_guest_id ()
  OR (
    EXISTS (
      SELECT 1
      FROM public.stay_guests sg
      WHERE sg.stay_id = s.id
        AND sg.guest_id = public.current_guest_id ()
    )
  );

GRANT SELECT ON public.user_stay_detail TO authenticated;


-- ============================================================
-- PERFORMANCE INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_stays_guest_recent
ON public.stays (guest_id, scheduled_checkin_at DESC)
INCLUDE (status);

CREATE INDEX IF NOT EXISTS idx_tickets_stay_active
ON public.tickets (stay_id)
WHERE status IN ('NEW', 'IN_PROGRESS');
