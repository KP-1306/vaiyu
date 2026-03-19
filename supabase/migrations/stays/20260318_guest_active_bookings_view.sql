-- ============================================================
-- View: v_guest_active_bookings
-- Purpose: Aggregate active journeys (Confirmed Bookings + Active Stays)
-- Logic: 
--   1. Confirmed bookings without stays = Upcoming 'arriving'
--   2. Active stays = Checked-in 'inhouse'
-- ============================================================

DROP VIEW IF EXISTS public.v_guest_active_bookings CASCADE;

CREATE OR REPLACE VIEW public.v_guest_active_bookings AS
-- ============================================================
-- PART 1: ARRIVING (Confirmed Bookings with NO stay records yet)
-- ============================================================
SELECT
    b.id AS booking_id,
    b.hotel_id,
    b.code AS booking_code,
    b.status::text AS booking_status, -- Added for future-proofing
    h.name AS hotel_name,
    h.slug AS hotel_slug,
    h.city AS hotel_city,
    h.phone AS hotel_phone,
    h.wa_display_number AS hotel_whatsapp,
    h.email AS hotel_email,
    NULL::uuid AS primary_stay_id,
    COALESCE(rs.room_numbers, 'Unassigned') AS room_numbers_display,
    COALESCE(rs.room_ids, '{}'::uuid[]) AS room_ids,
    COALESCE(rs.room_types, '{}'::text[]) AS room_types,
    COALESCE(rs.room_count, 0)::bigint AS room_count,
    '[]'::jsonb AS rooms_detail,
    'arriving'::stay_status AS status,
    b.scheduled_checkin_at AS checkin_min,
    b.scheduled_checkin_at AS checkin_max,
    b.scheduled_checkout_at AS checkout_min,
    b.scheduled_checkout_at AS checkout_max,
    false AS has_mixed_schedule,
    COALESCE(
        CEIL(EXTRACT(EPOCH FROM (b.scheduled_checkout_at - b.scheduled_checkin_at)) / 86400),
        0
    ) AS total_nights,
    b.scheduled_checkin_at AS check_in,
    b.scheduled_checkout_at AS check_out,
    COALESCE(ps.total_amount, 0) AS total_amount,
    COALESCE(ps.paid_amount, 0) AS paid_amount,
    COALESCE(ps.total_amount, 0) - COALESCE(ps.paid_amount, 0) AS outstanding_balance,
    b.guest_id,
    b.updated_at AS last_updated,
    pt.token AS precheckin_token,
    pt.expires_at AS precheckin_expires_at,
    pt.used_at AS precheckin_used_at
FROM public.bookings b
JOIN public.hotels h ON h.id = b.hotel_id
LEFT JOIN LATERAL (
    SELECT 
        STRING_AGG(r.number, ', ' ORDER BY r.number) AS room_numbers,
        ARRAY_AGG(DISTINCT r.id) AS room_ids,
        ARRAY_AGG(DISTINCT rt.name) AS room_types,
        COUNT(DISTINCT r.id) AS room_count
    FROM public.booking_rooms br
    JOIN public.rooms r ON r.id = br.room_id
    LEFT JOIN public.room_types rt ON rt.id = r.room_type_id
    WHERE br.booking_id = b.id
) rs ON TRUE
LEFT JOIN LATERAL (
    SELECT token, expires_at, used_at
    FROM public.precheckin_tokens pt
    WHERE pt.booking_id = b.id
    ORDER BY pt.created_at DESC
    LIMIT 1
) pt ON TRUE
LEFT JOIN LATERAL (
    SELECT total_amount, paid_amount
    FROM public.v_arrival_payment_state ps
    WHERE ps.booking_id = b.id
    LIMIT 1
) ps ON TRUE
WHERE b.status IN ('CONFIRMED', 'PRE_CHECKED_IN', 'PARTIALLY_CHECKED_IN')
  AND b.guest_id = current_guest_id()
  -- Crucial: Only show if no stay records exist yet
  AND NOT EXISTS (SELECT 1 FROM public.stays s WHERE s.booking_id = b.id)

UNION ALL

-- ============================================================
-- PART 2: ACTIVE STAYS (Current In-house Journeys)
-- ============================================================
SELECT
  s.booking_id,
  s.hotel_id,
  b.code AS booking_code,
  b.status::text AS booking_status, -- Added for future-proofing
  h.name AS hotel_name,
  h.slug AS hotel_slug,
  h.city AS hotel_city,
  h.phone AS hotel_phone,
  h.wa_display_number AS hotel_whatsapp,
  h.email AS hotel_email,
  COALESCE(
    (ARRAY_AGG(s.id ORDER BY s.created_at)
      FILTER (WHERE s.status = 'inhouse'))[1],
    (ARRAY_AGG(s.id ORDER BY s.created_at))[1]
  ) AS primary_stay_id,
  STRING_AGG(DISTINCT r.number, ', ' ORDER BY r.number) AS room_numbers_display,
  ARRAY_AGG(DISTINCT r.id) AS room_ids,
  ARRAY_REMOVE(ARRAY_AGG(DISTINCT rt.name), NULL) AS room_types,
  COUNT(DISTINCT s.id)::bigint AS room_count,
  COALESCE(rooms.rooms_detail, '[]'::jsonb) AS rooms_detail,
  'inhouse'::stay_status AS status,
  MIN(s.scheduled_checkin_at) AS checkin_min,
  MAX(s.scheduled_checkin_at) AS checkin_max,
  MIN(s.scheduled_checkout_at) AS checkout_min,
  MAX(s.scheduled_checkout_at) AS checkout_max,
  (
    MIN(s.scheduled_checkin_at) != MAX(s.scheduled_checkin_at)
    OR
    MIN(s.scheduled_checkout_at) != MAX(s.scheduled_checkout_at)
  ) AS has_mixed_schedule,
  COALESCE(
    CEIL(EXTRACT(EPOCH FROM (MAX(s.scheduled_checkout_at) - MIN(s.scheduled_checkin_at))) / 86400),
    0
  ) AS total_nights,
  MIN(s.scheduled_checkin_at) AS check_in,
  MAX(s.scheduled_checkout_at) AS check_out,
  COALESCE(ps.total_amount, 0) AS total_amount,
  COALESCE(ps.paid_amount, 0) AS paid_amount,
  COALESCE(ps.total_amount, 0) - COALESCE(ps.paid_amount, 0) AS outstanding_balance,
  s.guest_id,
  MAX(s.updated_at) AS last_updated,
  MAX(pt.token) AS precheckin_token,
  MAX(pt.expires_at) AS precheckin_expires_at,
  MAX(pt.used_at) AS precheckin_used_at
FROM public.stays s
JOIN public.bookings b ON b.id = s.booking_id
JOIN public.hotels h ON h.id = s.hotel_id
JOIN public.rooms r ON r.id = s.room_id
LEFT JOIN public.room_types rt ON rt.id = r.room_type_id
LEFT JOIN LATERAL (
  SELECT token, expires_at, used_at
  FROM public.precheckin_tokens pt
  WHERE pt.booking_id = s.booking_id
  ORDER BY pt.created_at DESC
  LIMIT 1
) pt ON TRUE
LEFT JOIN LATERAL (
  SELECT total_amount, paid_amount
  FROM public.v_arrival_payment_state ps
  WHERE ps.booking_id = s.booking_id
  LIMIT 1
) ps ON TRUE
LEFT JOIN (
  SELECT
    t.booking_id,
    t.guest_id,
    JSONB_AGG(room_obj ORDER BY room_number) AS rooms_detail
  FROM (
      SELECT DISTINCT
        s2.booking_id,
        s2.guest_id,
        r2.number AS room_number,
        JSONB_BUILD_OBJECT(
          'id', s2.id,
          'room_id', r2.id,
          'number', r2.number,
          'status', s2.status,
          'type', rt2.name,
          'check_in', s2.scheduled_checkin_at,
          'check_out', s2.scheduled_checkout_at
        ) AS room_obj
      FROM public.stays s2
      JOIN public.rooms r2 ON r2.id = s2.room_id
      LEFT JOIN public.room_types rt2 ON rt2.id = r2.room_type_id
      WHERE s2.status = 'inhouse'
  ) t
  GROUP BY t.booking_id, t.guest_id
) rooms 
  ON rooms.booking_id = s.booking_id 
  AND rooms.guest_id = s.guest_id
WHERE s.status = 'inhouse'
  AND s.guest_id = current_guest_id()
GROUP BY 
  s.booking_id, 
  s.hotel_id, 
  b.code, 
  b.status,
  h.id, 
  h.name, 
  h.slug, 
  h.city, 
  h.phone, 
  h.wa_display_number, 
  h.email, 
  s.guest_id,
  ps.total_amount,
  ps.paid_amount,
  rooms.rooms_detail;

-- ============================================================
-- Performance Index
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_stays_guest_active_lookup
ON public.stays (guest_id, status, booking_id)
WHERE status = 'inhouse';

-- ============================================================
-- Permissions
-- ============================================================

GRANT SELECT ON public.v_guest_active_bookings TO authenticated;
GRANT SELECT ON public.v_guest_active_bookings TO service_role;

-- ============================================================
-- Documentation
-- ============================================================

COMMENT ON VIEW public.v_guest_active_bookings IS 
'Aggregated view of active journeys: Confirmed future bookings (bookings) and currently checked-in stays (stays).';