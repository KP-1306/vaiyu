-- Migration: Enable RLS for Room Types
-- Essential for guest views to join against room_types

-- 1. Enable RLS
ALTER TABLE public.room_types ENABLE ROW LEVEL SECURITY;

-- 2. Create Policy: Allow Public Read (Authenticated & Anon)
-- Guests need to see room type names (e.g. "Deluxe")
CREATE POLICY "Everyone can view room types"
ON public.room_types
FOR SELECT
USING (true);

-- 3. Create Policy: Allow Staff/Service Role to Manage (Optional but good practice)
-- Service role bypasses RLS anyway, but this is for staff interfaces if needed later
CREATE POLICY "Staff can manage room types"
ON public.room_types
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.hotel_members hm
    WHERE hm.user_id = auth.uid()
    AND hm.hotel_id = room_types.hotel_id
  )
);
