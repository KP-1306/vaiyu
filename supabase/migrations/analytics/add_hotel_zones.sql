-- 1. Create the hotel_zones table
CREATE TABLE hotel_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  hotel_id UUID NOT NULL
    REFERENCES hotels(id) ON DELETE CASCADE,

  -- Human readable name
  -- Examples: "Lobby", "Swimming Pool", "Floor 2 Corridor"
  name TEXT NOT NULL,

  -- Classification of zone (CRITICAL for future-proofing)
  zone_type TEXT NOT NULL CHECK (
    zone_type IN (
      'FLOOR',          -- Floor 1, Floor 2
      'FACILITY',       -- Lobby, Pool, Gym, Spa
      'OUTDOOR',        -- Parking, Garden
      'BACK_OF_HOUSE',  -- Laundry, Store Room
      'CORRIDOR',       -- Floor corridors
      'HOTEL_WIDE'      -- Entire Hotel
    )
  ),

  -- Optional physical metadata
  floor INT,            -- Nullable (Lobby may be floor 0)
  wing TEXT,            -- Optional (East Wing, Tower B)

  -- For hierarchy / future expansion
  parent_zone_id UUID
    REFERENCES hotel_zones(id) ON DELETE SET NULL,

  is_active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (hotel_id, name)
); 

-- 2. Add zone_id to tickets (Nullable)
ALTER TABLE tickets 
ADD COLUMN IF NOT EXISTS zone_id UUID REFERENCES hotel_zones(id) ON DELETE SET NULL;

-- 3. Optional performance index for hierarchy queries
CREATE INDEX IF NOT EXISTS idx_hotel_zones_parent
ON public.hotel_zones (parent_zone_id);

-- 4. Optional index for analytics by type
CREATE INDEX IF NOT EXISTS idx_hotel_zones_type
ON public.hotel_zones (hotel_id, zone_type)
WHERE is_active = true;

-- 5 Enable RLS
ALTER TABLE hotel_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to hotel_zones" ON hotel_zones
FOR SELECT USING (true);


-- 2️⃣ INSERT: Seed zones for your hotel
-- Hotel ID: 139c6002-bdd7-4924-9db4-16f14e283d89

-- 🏨 Core Facilities
INSERT INTO public.hotel_zones (hotel_id, name, zone_type)
VALUES
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Lobby', 'FACILITY'),
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Swimming Pool', 'FACILITY'),
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Gym', 'FACILITY'),
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Spa', 'FACILITY')
ON CONFLICT DO NOTHING;

-- 🚗 Outdoor Areas
INSERT INTO public.hotel_zones (hotel_id, name, zone_type)
VALUES
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Parking', 'OUTDOOR'),
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Garden', 'OUTDOOR')
ON CONFLICT DO NOTHING;

-- 🧺 Back of House
INSERT INTO public.hotel_zones (hotel_id, name, zone_type)
VALUES
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Laundry', 'BACK_OF_HOUSE'),
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Store Room', 'BACK_OF_HOUSE')
ON CONFLICT DO NOTHING;

-- 🏢 Floors (parent zones)
INSERT INTO public.hotel_zones (hotel_id, name, zone_type, floor)
VALUES
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Floor 1', 'FLOOR', 1),
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Floor 2', 'FLOOR', 2),
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Floor 3', 'FLOOR', 3)
ON CONFLICT DO NOTHING;

-- 🚶 Corridors (children of floors)
INSERT INTO public.hotel_zones (hotel_id, name, zone_type, floor, parent_zone_id)
SELECT
  hz.hotel_id,
  hz.name || ' Corridor',
  'CORRIDOR',
  hz.floor,
  hz.id
FROM public.hotel_zones hz
WHERE hz.hotel_id = '139c6002-bdd7-4924-9db4-16f14e283d89'
  AND hz.zone_type = 'FLOOR'
ON CONFLICT DO NOTHING;

-- 🏨 Entire Hotel (important for pest control, audits, etc.)
INSERT INTO public.hotel_zones (hotel_id, name, zone_type)
VALUES
('139c6002-bdd7-4924-9db4-16f14e283d89', 'Entire Hotel', 'HOTEL_WIDE')
ON CONFLICT DO NOTHING;
