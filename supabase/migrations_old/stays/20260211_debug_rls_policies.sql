-- Migration: Ensure Guests Can View Their Own Stays (Comprehensive Fix)
-- Debugging RLS visibility issues

-- 1. Allow Guests to view their own profile in 'public.guests'
ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Guests can view own profile" ON public.guests;
CREATE POLICY "Guests can view own profile"
ON public.guests
FOR SELECT
USING (
  id = auth.uid()
);

-- 2. Allow Guests to view their own stays
ALTER TABLE public.stays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Guests can view own stays" ON public.stays;
CREATE POLICY "Guests can view own stays"
ON public.stays
FOR SELECT
USING (
  guest_id = auth.uid()
);

-- 3. Allow Guests to view the Hotel details for their stay
DROP POLICY IF EXISTS "Everyone can view hotels" ON public.hotels;
CREATE POLICY "Everyone can view hotels"
ON public.hotels
FOR SELECT
USING (true);

-- 4. Allow Guests to view Rooms (CRITICAL MISSING PIECE)
-- Since view joins on rooms, if rooms are hidden, the row disappears.
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Everyone can view rooms" ON public.rooms;
CREATE POLICY "Everyone can view rooms"
ON public.rooms
FOR SELECT
USING (true);

-- 5. Allow Guests to view Room Types (Repeated for safety)
ALTER TABLE public.room_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Everyone can view room types" ON public.room_types;
CREATE POLICY "Everyone can view room types"
ON public.room_types
FOR SELECT
USING (true);
