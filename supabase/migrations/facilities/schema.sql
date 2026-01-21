-- ============================================================
-- FACILITIES & ZONING
-- ============================================================

-- 1. Enhance Hotel Zones (Hierarchy & Types)
-- ============================================================

-- Add new columns if they don't exist (Idempotent)
ALTER TABLE hotel_zones ADD COLUMN IF NOT EXISTS zone_type TEXT;
ALTER TABLE hotel_zones ADD COLUMN IF NOT EXISTS parent_zone_id UUID REFERENCES hotel_zones(id) ON DELETE SET NULL;

-- Add Constraint
DO $$ BEGIN
  ALTER TABLE hotel_zones ADD CONSTRAINT hotel_zones_zone_type_check 
  CHECK (zone_type IN ('FLOOR','FACILITY','CORRIDOR','OUTDOOR','BACK_OF_HOUSE','HOTEL_WIDE'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS idx_hotel_zones_parent ON hotel_zones(parent_zone_id);


-- 2. Service <-> Zone Compatibility
-- ============================================================
CREATE TABLE IF NOT EXISTS service_zone_compatibility (
  service_code TEXT NOT NULL,
  zone_type TEXT NOT NULL,
  PRIMARY KEY (service_code, zone_type),
  CHECK (zone_type IN ('FLOOR','FACILITY','CORRIDOR','OUTDOOR','BACK_OF_HOUSE','HOTEL_WIDE'))
);

-- 3. Seed Compatibility Data
-- ============================================================
INSERT INTO service_zone_compatibility (service_code, zone_type) VALUES
('HOUSEKEEPING_CLEANING', 'FLOOR'), ('HOUSEKEEPING_CLEANING', 'CORRIDOR'), ('HOUSEKEEPING_CLEANING', 'FACILITY'),
('TOWEL_REQUEST', 'FLOOR'), ('TOWEL_REQUEST', 'FACILITY'),
('TRASH_REMOVAL', 'FLOOR'), ('TRASH_REMOVAL', 'BACK_OF_HOUSE'),
('ROOM_SERVICE', 'FLOOR'), ('ROOM_SERVICE', 'FACILITY'),
('MINIBAR_REFILL', 'FLOOR'),
('BANQUET_SERVICE', 'FACILITY'),
('ELECTRICAL_ISSUE', 'FLOOR'), ('ELECTRICAL_ISSUE', 'FACILITY'), ('ELECTRICAL_ISSUE', 'BACK_OF_HOUSE'),
('PLUMBING_ISSUE', 'FLOOR'), ('PLUMBING_ISSUE', 'FACILITY'),
('AC_ISSUE', 'FLOOR'), ('AC_ISSUE', 'FACILITY'),
('PEST_CONTROL', 'HOTEL_WIDE'), ('FIRE_DRILL', 'HOTEL_WIDE'), ('EMERGENCY_CLEANING', 'HOTEL_WIDE')
ON CONFLICT DO NOTHING;
