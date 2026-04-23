-- ============================================================
-- FAIL-SAFE SCHEMA RECOVERY: STAYS & BOOKINGS
-- ============================================================
-- This script ensures the 'stays' and 'bookings' tables exist and match the desired schema.
-- It is idempotent and safe to run on existing databases.

-- 1. Ensure Dependencies Exist (Guests, Hotels, Rooms)
-- ============================================================
CREATE TABLE IF NOT EXISTS guests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT,
  mobile TEXT,
  nationality TEXT,
  address TEXT,
  dob DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. STAYS TABLE RECOVERY
-- ============================================================
CREATE TABLE IF NOT EXISTS stays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  
  source TEXT NOT NULL DEFAULT 'walk_in',
  status stay_status NOT NULL DEFAULT 'arriving',
  
  scheduled_checkin_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scheduled_checkout_at TIMESTAMPTZ NOT NULL,
  actual_checkin_at TIMESTAMPTZ,
  actual_checkout_at TIMESTAMPTZ,
  
  booking_code TEXT,
  is_vip BOOLEAN NOT NULL DEFAULT false,
  vip_level TEXT,
  has_open_complaint BOOLEAN NOT NULL DEFAULT false,
  needs_courtesy_call BOOLEAN NOT NULL DEFAULT false,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Constraints defined inline for new tables
  CONSTRAINT stay_checkout_after_checkin CHECK (scheduled_checkout_at > scheduled_checkin_at),
  CONSTRAINT stays_actual_time_order CHECK (
      (actual_checkin_at IS NULL) OR (actual_checkout_at IS NULL) OR (actual_checkout_at > actual_checkin_at)
  ),
  CONSTRAINT stays_source_check CHECK (source IN ('walk_in', 'pms_sync', 'manual', 'arrival_checkin'))
);

-- 2b. Sync Columns (If table existed but was missing columns)
DO $$
BEGIN
    -- guest_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stays' AND column_name='guest_id') THEN
        ALTER TABLE stays ADD COLUMN guest_id UUID REFERENCES guests(id) ON DELETE RESTRICT;
    END IF;
    -- source
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stays' AND column_name='source') THEN
        ALTER TABLE stays ADD COLUMN source TEXT NOT NULL DEFAULT 'walk_in';
    END IF;
    -- status
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stays' AND column_name='status') THEN
        ALTER TABLE stays ADD COLUMN status stay_status NOT NULL DEFAULT 'arriving';
    END IF;
    -- booking_code
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stays' AND column_name='booking_code') THEN
        ALTER TABLE stays ADD COLUMN booking_code TEXT;
    END IF;
    -- generated column is_active (Postgres 12+)
    -- Note: Generated columns are hard to add conditionally via DO block without dynamic SQL, keeping simple for now. 
    -- Assuming if table exists, major schema structure is likely there or we'd drop/recreate in a real disastrous recovery.
END $$;


-- 2c. Sync Indices (Stays)
CREATE INDEX IF NOT EXISTS stays_guest_id_idx ON stays(guest_id);
CREATE INDEX IF NOT EXISTS stays_guest_active_idx ON stays(guest_id, status, scheduled_checkin_at);
CREATE INDEX IF NOT EXISTS stays_hotel_status_idx ON stays(hotel_id, status, scheduled_checkin_at);
CREATE INDEX IF NOT EXISTS stays_checkin_partition_idx ON stays(scheduled_checkin_at);
CREATE UNIQUE INDEX IF NOT EXISTS stays_booking_code_unique ON stays(booking_code) WHERE booking_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stays_guest_recent ON stays(guest_id, scheduled_checkin_at DESC) INCLUDE (status);
CREATE INDEX IF NOT EXISTS idx_stays_booking_id ON stays(booking_id);
CREATE INDEX IF NOT EXISTS idx_stays_hotel_active ON stays(hotel_id, status) WHERE status IN ('arriving', 'inhouse');
CREATE INDEX IF NOT EXISTS idx_stays_created_recent ON stays(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS stays_booking_open ON stays(booking_id) WHERE status IN ('arriving', 'inhouse') AND booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stays_room_time_lookup ON stays(room_id, scheduled_checkin_at, scheduled_checkout_at);


-- 3. BOOKINGS TABLE RECOVERY
-- ============================================================
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  guest_id UUID REFERENCES auth.users(id), -- Note: User schema used auth.users here, keeping it.
  guest_profile_id UUID REFERENCES profiles(id),
  
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('CREATED','CONFIRMED','CANCELLED','NO_SHOW','CHECKED_IN','COMPLETED')),
  source TEXT,
  
  guest_name TEXT,
  phone TEXT,
  
  scheduled_checkin_at TIMESTAMPTZ NOT NULL,
  scheduled_checkout_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT bookings_checkout_after_checkin CHECK (scheduled_checkout_at > scheduled_checkin_at)
);

-- 3b. Sync Columns (Bookings)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bookings' AND column_name='source') THEN
        ALTER TABLE bookings ADD COLUMN source TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bookings' AND column_name='guest_id') THEN
         ALTER TABLE bookings ADD COLUMN guest_id UUID REFERENCES auth.users(id);
    END IF;
END $$;

-- 3c. Sync Indices (Bookings)
CREATE INDEX IF NOT EXISTS bookings_phone_idx ON bookings(phone);
CREATE INDEX IF NOT EXISTS idx_bookings_guest_id ON bookings(guest_id);
CREATE INDEX IF NOT EXISTS bookings_guest_profile_idx ON bookings(guest_profile_id);
CREATE INDEX IF NOT EXISTS bookings_guest_profile_status_idx ON bookings(guest_profile_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_hotel_checkin ON bookings(hotel_id, scheduled_checkin_at);
CREATE INDEX IF NOT EXISTS idx_bookings_status_checkin ON bookings(status, scheduled_checkin_at);
CREATE INDEX IF NOT EXISTS idx_bookings_phone_hotel ON bookings(hotel_id, phone);


-- 4. Triggers
-- ============================================================
-- Stays: validate_stay_room_hotel
DROP TRIGGER IF EXISTS validate_stay_room_hotel ON stays;
CREATE TRIGGER validate_stay_room_hotel
BEFORE INSERT OR UPDATE ON stays
FOR EACH ROW EXECUTE FUNCTION trg_validate_stay_room_hotel();

-- Bookings: trg_touch_kpis
DROP TRIGGER IF EXISTS trg_bookings_touch_kpis ON bookings;
CREATE TRIGGER trg_bookings_touch_kpis
AFTER INSERT OR DELETE OR UPDATE ON bookings
FOR EACH ROW EXECUTE FUNCTION trg_touch_kpis();

-- Bookings: updated_at
DROP TRIGGER IF EXISTS trg_bookings_updated_at ON bookings;
CREATE TRIGGER trg_bookings_updated_at
BEFORE UPDATE ON bookings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
