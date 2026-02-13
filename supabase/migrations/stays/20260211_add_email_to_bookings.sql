-- Migration: Standardize Bookings Table with Email Snapshot
-- Rationale: Bookings should snapshot guest contact details (Phone, Email, Name) at time of booking.
-- This ensures historical accuracy even if the guest profile changes later.

-- 1. Add email column
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS email TEXT;

-- 2. Backfill email from Guests table (Source of Truth)
UPDATE bookings b
SET email = g.email
FROM guests g
WHERE b.guest_id = g.id
AND b.email IS NULL;

-- 3. Update search_booking RPC to use b.email (Optimization & Standardization)
DROP FUNCTION IF EXISTS public.search_booking(TEXT, UUID, INT);

CREATE OR REPLACE FUNCTION public.search_booking(
  p_query TEXT,
  p_hotel_id UUID,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  code TEXT,
  status TEXT,
  guest_name TEXT,
  phone TEXT,
  email TEXT,
  scheduled_checkin_at TIMESTAMPTZ,
  scheduled_checkout_at TIMESTAMPTZ,
  room_type TEXT,
  room_type_id UUID,
  hotel_id UUID,
  source TEXT,
  adults INT,
  children INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  p_query := trim(p_query);

  IF length(p_query) < 2 THEN
     RAISE EXCEPTION 'Search query too short';
  END IF;

  p_limit := LEAST(GREATEST(p_limit,1),50);

  RETURN QUERY
  SELECT
    b.id,
    b.code,
    b.status::text,
    
    -- Priority: Booking Snapshot > Linked Guest > Default
    COALESCE(b.guest_name, g.full_name, 'Guest') as guest_name,
    COALESCE(b.phone, g.mobile) as phone,
    COALESCE(b.email, g.email) as email, 
    
    b.scheduled_checkin_at,
    b.scheduled_checkout_at,
    
    rt.name as room_type,
    rt.id as room_type_id,
    
    b.hotel_id,
    b.source::text,
    b.adults,
    b.children
    
  FROM bookings b
  LEFT JOIN guests g ON b.guest_id = g.id
  LEFT JOIN room_types rt ON b.room_type_id = rt.id

  WHERE
    b.hotel_id = p_hotel_id
    AND (
      b.code ILIKE '%' || p_query || '%'
      OR b.phone ILIKE '%' || p_query || '%'
      OR b.email ILIKE '%' || p_query || '%'
      OR g.mobile ILIKE '%' || p_query || '%'
      OR g.full_name ILIKE '%' || p_query || '%'
    )
    AND b.status IN ('CREATED', 'CONFIRMED')
  LIMIT p_limit;
END;
$$;
