-- ============================================================
-- KIOSK: Identity Proof Pre-fill
-- ============================================================

-- Updated search_booking to return identity_proof from guest_id_documents
-- This allows the Kiosk (GuestKYC.tsx) to pre-fill the ID details if they exist.

CREATE OR REPLACE FUNCTION search_booking(
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
  identity_proof JSONB
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
    b.status,
    b.guest_name,
    b.phone,
    p.email,
    b.scheduled_checkin_at,
    b.scheduled_checkout_at,
    NULL::text, -- Room Type (Placeholder if needed, or join)
    b.hotel_id,
    (SELECT jsonb_build_object(
        'type', gid.document_type,
        'number', gid.document_number,
        'front_image', gid.front_image_url,
        'back_image', gid.back_image_url
     )
     FROM guest_id_documents gid
     WHERE gid.guest_id = b.guest_id
     ORDER BY gid.updated_at DESC LIMIT 1
    ) AS identity_proof
  FROM bookings b
  LEFT JOIN profiles p ON b.guest_profile_id = p.id
  WHERE b.hotel_id = p_hotel_id
  AND (
    b.code ILIKE '%' || p_query || '%'
    OR b.phone ILIKE '%' || p_query || '%'
    OR p.email ILIKE '%' || p_query || '%'
  )
  AND b.status IN ('CREATED', 'CONFIRMED')
  LIMIT p_limit;
END;
$$;
