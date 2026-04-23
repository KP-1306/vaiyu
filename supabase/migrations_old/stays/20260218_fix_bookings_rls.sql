-- Secure Bookings and Stays (Emergency Fix)
-- ============================================================

-- 1. Enable RLS on Bookings (Was missing)
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- 2. Policy: Guests can view their own bookings
DROP POLICY IF EXISTS "Guests can view own bookings" ON bookings;
CREATE POLICY "Guests can view own bookings"
ON bookings
FOR SELECT
USING (
  guest_id = auth.uid()
);

-- 3. Policy: Service Role full access
DROP POLICY IF EXISTS "Service role full access bookings" ON bookings;
CREATE POLICY "Service role full access bookings"
ON bookings
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 4. Re-verify Stays RLS (Ensure it's enabled and correct)
ALTER TABLE stays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Guests can view own stays" ON stays;
CREATE POLICY "Guests can view own stays"
ON stays
FOR SELECT
USING (
  guest_id = auth.uid()
);

DROP POLICY IF EXISTS "Service role full access stays" ON stays;
CREATE POLICY "Service role full access stays"
ON stays
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
