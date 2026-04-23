-- Migration for Room Inventory & Pricing Schema

-- 1. Create rate_plans table
CREATE TABLE IF NOT EXISTS public.rate_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  name text NOT NULL,                -- BAR, Corporate, Promo
  cancellation_policy text,
  meal_plan text,                    -- EP / CP / MAP / AP
  refundable boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 2. Create rate_plan_prices table
CREATE TABLE IF NOT EXISTS public.rate_plan_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_plan_id uuid NOT NULL REFERENCES public.rate_plans(id) ON DELETE CASCADE,
  room_type_id uuid NOT NULL REFERENCES public.room_types(id) ON DELETE CASCADE,
  price numeric(10,2) NOT NULL,
  valid_from date,
  valid_to date
);

-- 3. Alter bookings table
DO $$ BEGIN
  ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS room_type_id uuid NULL REFERENCES public.room_types(id),
  ADD COLUMN IF NOT EXISTS rate_plan_id uuid NULL REFERENCES public.rate_plans(id),
  ADD COLUMN IF NOT EXISTS adults int DEFAULT 1,
  ADD COLUMN IF NOT EXISTS children int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS estimated_total_amount numeric(10,2) NULL;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

-- 4. Create booking_charges table
CREATE TABLE IF NOT EXISTS public.booking_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  charge_type text NOT NULL, -- ROOM_RENT / TAX / EXTRA_BED / BREAKFAST
  description text,
  amount numeric(10,2) NOT NULL,
  currency text DEFAULT 'INR',
  created_at timestamptz DEFAULT now()
);

-- 5. Insert Default Room Types (Idempotent)
-- Note: Assuming hotel_id '139c6002-bdd7-4924-9db4-16f14e283d89' exists or this is for specific deployment.
INSERT INTO public.room_types (hotel_id, name, description, base_occupancy, max_occupancy)
VALUES
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Standard', 'Basic standard category', 2, 2),
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Deluxe', 'Larger upgraded category', 2, 3),
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Executive', 'Premium business category', 2, 3),
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Superior', 'Enhanced comfort category', 2, 3),
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Premium', 'High-end premium category', 2, 3),
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Family', 'Family stay category', 3, 5),
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Twin', 'Two separate beds', 2, 2),
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Double', 'Single double bed', 2, 2),
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Studio', 'Studio layout category', 2, 3),
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Junior Suite', 'Entry-level suite', 2, 3),
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Suite', 'Luxury suite', 2, 4),
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Executive Suite', 'Premium executive suite', 2, 4),
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Presidential Suite', 'Top-tier luxury suite', 2, 6),
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Accessible', 'Accessibility enabled category', 2, 2),
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Connecting', 'Interconnected rooms', 2, 4),
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Dormitory', 'Shared dormitory category', 4, 10)
ON CONFLICT DO NOTHING;

-- Log Index
CREATE INDEX IF NOT EXISTS idx_rooms_room_type ON public.rooms(room_type_id);

-- Drop old column (Optional: Commented out for safety, uncomment when ready)
-- ALTER TABLE public.rooms DROP COLUMN IF EXISTS type;
