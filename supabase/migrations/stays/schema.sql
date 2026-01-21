-- ============================================================
-- STAYS (Guests in Rooms)
-- ============================================================

-- 1. Enums
-- ============================================================
DO $$ BEGIN
  CREATE TYPE stay_status AS ENUM (
    'arriving',
    'inhouse',
    'departed',
    'cancelled',
    'no_show'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;


-- 2. Stays Table
-- ============================================================
CREATE TABLE IF NOT EXISTS stays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  
  source TEXT NOT NULL DEFAULT 'walk_in' CHECK (source IN ('walk_in', 'pms_sync', 'manual')),
  status stay_status NOT NULL DEFAULT 'arriving',
  
  check_in_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  check_out_end TIMESTAMPTZ,
  
  booking_code TEXT,
  
  is_vip BOOLEAN NOT NULL DEFAULT false,
  vip_level TEXT,
  has_open_complaint BOOLEAN NOT NULL DEFAULT false,
  needs_courtesy_call BOOLEAN NOT NULL DEFAULT false,
  
  -- Computed Active State
  is_active BOOLEAN GENERATED ALWAYS AS (
    status IN ('arriving', 'inhouse')
  ) STORED,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT stay_checkout_after_checkin CHECK (
    check_out_end IS NULL OR check_out_end > check_in_start
  )
);

-- Indices
CREATE UNIQUE INDEX IF NOT EXISTS stays_booking_code_unique 
ON stays (booking_code) WHERE booking_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS stays_unique_open 
ON stays (guest_id, hotel_id) WHERE status IN ('arriving', 'inhouse');

CREATE INDEX IF NOT EXISTS stays_lookup_idx ON stays (guest_id, hotel_id, status, check_in_start);
CREATE INDEX IF NOT EXISTS stays_guest_id_idx ON stays (guest_id);
CREATE INDEX IF NOT EXISTS stays_check_in_start_idx ON stays (check_in_start);
CREATE INDEX IF NOT EXISTS stays_room_id_idx ON stays (room_id);

-- Triggers (Standard)
CREATE TRIGGER trg_stays_updated
BEFORE UPDATE ON stays
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3. Validation Trigger (Room belongs to Hotel)
-- ============================================================
CREATE OR REPLACE FUNCTION trg_validate_stay_room_hotel()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM rooms r
    WHERE r.id = NEW.room_id
      AND r.hotel_id = NEW.hotel_id
  ) THEN
    RAISE EXCEPTION
      'Room % does not belong to hotel %',
      NEW.room_id, NEW.hotel_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_stay_room_hotel ON stays;
CREATE TRIGGER validate_stay_room_hotel
BEFORE INSERT OR UPDATE ON stays
FOR EACH ROW
EXECUTE FUNCTION trg_validate_stay_room_hotel();


-- 4. Secure Resolution RPC
-- ============================================================
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
    CAST(NULL as UUID) as zone_id, 
    s.guest_id
  FROM stays s
  WHERE s.booking_code = p_code
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_stay_by_code(TEXT) TO public;
GRANT EXECUTE ON FUNCTION resolve_stay_by_code(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION resolve_stay_by_code(TEXT) TO anon;
