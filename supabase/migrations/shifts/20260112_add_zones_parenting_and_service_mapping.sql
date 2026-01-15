-- ============================================================
-- Hotel Zones (Final, Future-Proof)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.hotel_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  hotel_id UUID NOT NULL
    REFERENCES hotels(id) ON DELETE CASCADE,

  name TEXT NOT NULL,

  -- Zoning model
  zone_type TEXT NOT NULL CHECK (
    zone_type IN (
      'FLOOR',
      'FACILITY',
      'CORRIDOR',
      'OUTDOOR',
      'BACK_OF_HOUSE',
      'HOTEL_WIDE'
    )
  ),

  -- Hierarchy (Floor → Corridor → Room / Facility)
  parent_zone_id UUID
    REFERENCES hotel_zones(id) ON DELETE SET NULL,

  floor INT,
  wing TEXT,

  is_active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (hotel_id, name)
);

CREATE INDEX IF NOT EXISTS idx_hotel_zones_hotel
  ON hotel_zones(hotel_id);

CREATE INDEX IF NOT EXISTS idx_hotel_zones_parent
  ON hotel_zones(parent_zone_id);

-- ============================================================
-- Seed Zones (Core + Facilities + BOH + Outdoor)
-- ============================================================

-- FLOOR LEVEL
INSERT INTO hotel_zones (hotel_id, name, zone_type, floor)
VALUES
(:hotel_id, 'Ground Floor', 'FLOOR', 0),
(:hotel_id, 'First Floor', 'FLOOR', 1),
(:hotel_id, 'Second Floor', 'FLOOR', 2);

-- FACILITIES
INSERT INTO hotel_zones (hotel_id, name, zone_type)
VALUES
(:hotel_id, 'Lobby', 'FACILITY'),
(:hotel_id, 'Reception / Front Desk', 'FACILITY'),
(:hotel_id, 'Restaurant', 'FACILITY'),
(:hotel_id, 'Gym / Fitness Center', 'FACILITY'),
(:hotel_id, 'Steam / Sauna', 'FACILITY'),
(:hotel_id, 'Swimming Pool', 'FACILITY'),
(:hotel_id, 'Spa', 'FACILITY'),
(:hotel_id, 'Conference Hall', 'FACILITY'),
(:hotel_id, 'Yoga / Activity Room', 'FACILITY');

-- CORRIDORS
INSERT INTO hotel_zones (hotel_id, name, zone_type)
VALUES
(:hotel_id, 'Guest Corridors', 'CORRIDOR'),
(:hotel_id, 'Service Corridors', 'CORRIDOR');

-- BACK OF HOUSE
INSERT INTO hotel_zones (hotel_id, name, zone_type)
VALUES
(:hotel_id, 'Housekeeping Store', 'BACK_OF_HOUSE'),
(:hotel_id, 'Laundry', 'BACK_OF_HOUSE'),
(:hotel_id, 'Maintenance Room', 'BACK_OF_HOUSE'),
(:hotel_id, 'Electrical / Utility Room', 'BACK_OF_HOUSE'),
(:hotel_id, 'Staff Locker Room', 'BACK_OF_HOUSE'),

(:hotel_id, 'Staff Cafeteria', 'BACK_OF_HOUSE');

-- OUTDOOR
INSERT INTO hotel_zones (hotel_id, name, zone_type)
VALUES
(:hotel_id, 'Parking Area', 'OUTDOOR'),
(:hotel_id, 'Garden / Lawn', 'OUTDOOR'),
(:hotel_id, 'Rooftop', 'OUTDOOR');

-- HOTEL WIDE
INSERT INTO hotel_zones (hotel_id, name, zone_type)
VALUES
(:hotel_id, 'Entire Hotel', 'HOTEL_WIDE');

-- ============================================================
-- Parent Zone Wiring
-- ============================================================

-- Corridors belong to floors
UPDATE hotel_zones
SET parent_zone_id = (
  SELECT id FROM hotel_zones
  WHERE hotel_id = :hotel_id
    AND name = 'Ground Floor'
)
WHERE hotel_id = :hotel_id
  AND name = 'Guest Corridors';

-- Facilities belong to ground floor
UPDATE hotel_zones
SET parent_zone_id = (
  SELECT id FROM hotel_zones
  WHERE hotel_id = :hotel_id
    AND name = 'Ground Floor'
)
WHERE hotel_id = :hotel_id
  AND name IN ('Lobby', 'Reception / Front Desk', 'Restaurant');

-- Back of house → Entire Hotel
UPDATE hotel_zones
SET parent_zone_id = (
  SELECT id FROM hotel_zones
  WHERE hotel_id = :hotel_id
    AND name = 'Entire Hotel'
)
WHERE hotel_id = :hotel_id
  AND zone_type = 'BACK_OF_HOUSE';



-- ============================================================
-- Service ↔ Zone Type Compatibility
-- ============================================================

CREATE TABLE IF NOT EXISTS service_zone_compatibility (
  service_code TEXT NOT NULL,
  zone_type TEXT NOT NULL,

  PRIMARY KEY (service_code, zone_type),

  CHECK (
    zone_type IN (
      'FLOOR',
      'FACILITY',
      'CORRIDOR',
      'OUTDOOR',
      'BACK_OF_HOUSE',
      'HOTEL_WIDE'
    )
  )
);
-- ============================================================
-- Housekeeping
-- ============================================================
INSERT INTO service_zone_compatibility VALUES
('HOUSEKEEPING_CLEANING', 'FLOOR'),
('HOUSEKEEPING_CLEANING', 'CORRIDOR'),
('HOUSEKEEPING_CLEANING', 'FACILITY'),

('TOWEL_REQUEST', 'FLOOR'),
('TOWEL_REQUEST', 'FACILITY'),

('TRASH_REMOVAL', 'FLOOR'),
('TRASH_REMOVAL', 'BACK_OF_HOUSE');

-- ============================================================
-- Kitchen / F&B
-- ============================================================
INSERT INTO service_zone_compatibility VALUES
('ROOM_SERVICE', 'FLOOR'),
('ROOM_SERVICE', 'FACILITY'),

('MINIBAR_REFILL', 'FLOOR'),

('BANQUET_SERVICE', 'FACILITY');

-- ============================================================
-- Maintenance
-- ============================================================
INSERT INTO service_zone_compatibility VALUES
('ELECTRICAL_ISSUE', 'FLOOR'),
('ELECTRICAL_ISSUE', 'FACILITY'),
('ELECTRICAL_ISSUE', 'BACK_OF_HOUSE'),

('PLUMBING_ISSUE', 'FLOOR'),
('PLUMBING_ISSUE', 'FACILITY'),

('AC_ISSUE', 'FLOOR'),
('AC_ISSUE', 'FACILITY');

-- ============================================================
-- Hotel-wide
-- ============================================================
INSERT INTO service_zone_compatibility VALUES
('PEST_CONTROL', 'HOTEL_WIDE'),
('FIRE_DRILL', 'HOTEL_WIDE'),
('EMERGENCY_CLEANING', 'HOTEL_WIDE');
