-- Securely resolve stay details by booking code (bypassing RLS)
CREATE OR REPLACE FUNCTION resolve_stay_by_code(p_code TEXT)
RETURNS TABLE (
  stay_id UUID,
  hotel_id UUID,
  room_id UUID,
  zone_id UUID,
  guest_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id as stay_id,
    s.hotel_id,
    s.room_id,
    CAST(NULL as UUID) as zone_id, -- Stays don't currently link to zones directly in the provided schema, but returning null for compatibility
    s.guest_id
  FROM stays s
  WHERE s.booking_code = p_code
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_stay_by_code(TEXT) TO public;
GRANT EXECUTE ON FUNCTION resolve_stay_by_code(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION resolve_stay_by_code(TEXT) TO anon;
