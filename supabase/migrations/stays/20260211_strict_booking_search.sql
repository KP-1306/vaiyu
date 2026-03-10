-- Migration: Strict Booking Search (Exact Match)
-- Updated to include guest count and source for Booking Details screen.

GRANT EXECUTE ON FUNCTION search_booking(TEXT, UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION search_booking(TEXT, UUID, INT) TO anon;
