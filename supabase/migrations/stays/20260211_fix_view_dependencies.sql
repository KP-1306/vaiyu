-- Migration: Fix View Dependencies and Drop Legacy Column

-- 1. Drop dependent views (CASCADE handles the hierarchy, but explicit dropping is safer for clarity)
DROP VIEW IF EXISTS public.v_guest_home_dashboard CASCADE;
DROP VIEW IF EXISTS public.v_guest_home_dashboard_base CASCADE;
DROP VIEW IF EXISTS public.user_recent_stays CASCADE;
DROP VIEW IF EXISTS public.v_guest_stay_hero CASCADE;
DROP VIEW IF EXISTS public.v_guest_stay_hero_base CASCADE;

-- 2. Drop the legacy column from rooms
ALTER TABLE public.rooms DROP COLUMN IF EXISTS type;

-- 3. Recreate v_guest_stay_hero_base with JOIN to room_types
CREATE OR REPLACE VIEW public.v_guest_stay_hero_base AS
SELECT
  s.id                      AS stay_id,
  s.guest_id,
  s.hotel_id,
  s.booking_code,
  s.is_vip,
  s.is_active,
  
  -- Hotel info
  h.name                    AS hotel_name,
  h.slug                    AS hotel_slug,
  h.city                    AS hotel_city,
  
  -- Room info (Updated to use room_types)
  r.id                      AS room_id,
  r.number                  AS room_number,
  rt.name                   AS room_type, -- Fetched from room_types table
  
  -- Raw status (no ::text for index usage)
  s.status                  AS stay_status,
  
  -- Lifecycle Phase Classification
  CASE
    WHEN s.status = 'arriving' THEN 'UPCOMING'
    WHEN s.status = 'inhouse'  THEN 'ACTIVE'
    WHEN s.status = 'checked_out' THEN 'COMPLETED'
    WHEN s.status = 'cancelled' THEN 'CANCELLED'
    WHEN s.status = 'no_show' THEN 'NO_SHOW'
    ELSE 'OTHER'
  END AS lifecycle_phase,
  
  -- Hero Title
  CASE
    WHEN s.status = 'arriving'      THEN 'Your upcoming stay at ' || h.name
    WHEN s.status = 'inhouse'       THEN 'Your stay at ' || h.name
    WHEN s.status = 'checked_out'   THEN 'Your recent stay at ' || h.name
    WHEN s.status = 'cancelled'     THEN 'Cancelled stay at ' || h.name
    ELSE 'Stay at ' || h.name
  END AS hero_title,
  
  -- Timestamps
  s.scheduled_checkin_at,
  s.scheduled_checkout_at,
  s.actual_checkin_at,
  s.actual_checkout_at,
  
  COALESCE(s.actual_checkin_at, s.scheduled_checkin_at) AS display_checkin_at,
  
  CASE
    WHEN s.status = 'checked_out'
      THEN COALESCE(s.actual_checkout_at, s.scheduled_checkout_at)
    ELSE s.scheduled_checkout_at
  END AS display_checkout_at,
  
  -- Display Labels
  CASE
    WHEN s.status = 'inhouse' AND s.actual_checkin_at IS NOT NULL THEN 'Checked-in'
    ELSE 'Check-in'
  END AS checkin_label,
  
  CASE
    WHEN s.status = 'inhouse' THEN 'Checkout'
    ELSE 'Check-out'
  END AS checkout_label,
  
  -- CTA Helpers
  (s.status = 'arriving')                     AS can_checkin,
  (s.status = 'inhouse')                      AS can_request_service,
  (s.status = 'inhouse')                      AS can_express_checkout,
  (s.status = 'inhouse')                      AS can_order_food,
  (s.status IN ('inhouse', 'checked_out'))    AS can_view_bill,
  (s.status = 'checked_out')                  AS can_download_invoice,
  (s.status = 'checked_out')                  AS can_book_again,
  (s.status = 'arriving')                     AS can_modify_booking,
  (s.status = 'arriving')                     AS can_cancel_booking,
  
  -- Status Badge Helpers
  CASE
    WHEN s.status = 'inhouse' THEN 'success'
    WHEN s.status = 'arriving' THEN 'warning'
    WHEN s.status = 'checked_out' THEN 'neutral'
    WHEN s.status = 'cancelled' THEN 'error'
    WHEN s.status = 'no_show' THEN 'error'
    ELSE 'neutral'
  END AS badge_variant,
  
  CASE
    WHEN s.status = 'inhouse' THEN '✓ Checked-in'
    WHEN s.status = 'arriving' THEN 'Upcoming'
    WHEN s.status = 'checked_out' THEN '✓ Completed'
    WHEN s.status = 'cancelled' THEN 'Cancelled'
    WHEN s.status = 'no_show' THEN 'No Show'
    ELSE NULL
  END AS badge_text,
  
  -- Metadata
  s.created_at,
  s.updated_at

FROM public.stays s
JOIN public.hotels h ON h.id = s.hotel_id
JOIN public.rooms r ON r.id = s.room_id
LEFT JOIN public.room_types rt ON rt.id = r.room_type_id; -- Join with room_types

-- SECURITY: Only grant to service_role
GRANT SELECT ON public.v_guest_stay_hero_base TO service_role;


-- 4. Recreate v_guest_stay_hero
CREATE OR REPLACE VIEW public.v_guest_stay_hero AS
SELECT *
FROM public.v_guest_stay_hero_base
WHERE guest_id = auth.uid();

GRANT SELECT ON public.v_guest_stay_hero TO authenticated;


-- 5. Recreate user_recent_stays
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
FROM public.v_guest_stay_hero;

GRANT SELECT ON public.user_recent_stays TO authenticated;


-- 6. Recreate v_guest_home_dashboard_base
CREATE OR REPLACE VIEW public.v_guest_home_dashboard_base AS
SELECT
  vh.stay_id,
  vh.guest_id,
  vh.hotel_id,
  vh.booking_code,
  vh.hotel_name,
  vh.hotel_city,
  vh.hotel_slug,
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
  (COALESCE(svc.active_count, 0) > 0) AS has_active_service_request,
  COALESCE(svc.active_count, 0) AS active_service_count,
  vh.can_view_bill AS has_bill,
  NULL::numeric AS bill_total,
  NULL::integer AS reward_points,
  NULL::text AS reward_tier,
  vh.is_vip,
  vh.is_active,
  vh.created_at,
  vh.updated_at
FROM public.v_guest_stay_hero_base vh
LEFT JOIN LATERAL (
  SELECT COUNT(*)::integer AS active_count
  FROM public.tickets t
  WHERE t.stay_id = vh.stay_id
    AND t.status IN ('NEW', 'IN_PROGRESS')
) svc ON TRUE;

GRANT SELECT ON public.v_guest_home_dashboard_base TO service_role;


-- 7. Recreate v_guest_home_dashboard
CREATE OR REPLACE VIEW public.v_guest_home_dashboard AS
SELECT *
FROM public.v_guest_home_dashboard_base
WHERE guest_id = auth.uid();

GRANT SELECT ON public.v_guest_home_dashboard TO authenticated;
