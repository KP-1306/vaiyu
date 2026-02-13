-- Migration: Strict Booking Search (Exact Match)
-- Updated to include guest count and source for Booking Details screen.

DROP FUNCTION IF EXISTS public.search_booking(TEXT, UUID, INT);

CREATE OR REPLACE FUNCTION public.search_booking(
  p_query TEXT,
  p_hotel_id UUID,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  booking_id UUID,
  booking_code TEXT,
  status TEXT,
  guest_name TEXT,
  phone TEXT,
  email TEXT,
  scheduled_checkin_at TIMESTAMPTZ,
  scheduled_checkout_at TIMESTAMPTZ,
  room_type TEXT,
  hotel_id UUID,
  adults INT,
  children INT,
  source TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  p_query := trim(p_query);

  IF length(p_query) < 3 THEN
     RAISE EXCEPTION 'Search query too short';
  END IF;

  -- Limit Protection
  p_limit := LEAST(GREATEST(p_limit,1),50);

  RETURN QUERY
  SELECT
    b.id,
    b.code,
    b.status,
    b.guest_name,
    b.phone,
    p.email, -- via profile if linked
    b.scheduled_checkin_at,
    b.scheduled_checkout_at,
    rt.name AS room_type, -- Fetch real room type name
    b.hotel_id,
    b.adults,
    b.children,
    b.source
  FROM bookings b
  LEFT JOIN profiles p ON b.guest_profile_id = p.id
  LEFT JOIN room_types rt ON b.room_type_id = rt.id
  WHERE b.hotel_id = p_hotel_id
  AND (
    -- Strict Exact Match
    b.code = p_query
    OR b.phone = p_query
    OR p.email = p_query
    -- Optional: Allow case-insensitive for code/email
    OR lower(b.code) = lower(p_query)
    OR lower(p.email) = lower(p_query)
  )
  AND b.status IN ('CREATED', 'CONFIRMED')
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION search_booking(TEXT, UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION search_booking(TEXT, UUID, INT) TO anon;
