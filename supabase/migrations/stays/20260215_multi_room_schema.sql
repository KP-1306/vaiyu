-- ============================================================
-- MULTI-ROOM / MULTI-GUEST MIGRATION
--
-- This script prepares the database for complex bookings:
-- 1. Adds total occupancy to bookings
-- 2. Creates booking_rooms (Inventory Units)
-- 3. Creates booking_room_guests (Guest Assignment)
-- 4. Links Stays to Rooms
-- 5. Backfills existing data
-- ============================================================

-- MIGRATION 1 — Booking header totals
-- Why: Booking must store total occupancy for pricing, analytics, and fast queries.
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS adults_total integer DEFAULT 1,
ADD COLUMN IF NOT EXISTS children_total integer DEFAULT 0;

-- MIGRATION 2 — booking_rooms (reservation inventory unit)
-- Why: One booking can reserve multiple rooms; later a physical room gets assigned.
CREATE TABLE IF NOT EXISTS booking_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,

  room_type_id uuid NOT NULL REFERENCES room_types(id),
  room_id uuid NULL REFERENCES rooms(id),

  adults integer NOT NULL DEFAULT 1,
  children integer NOT NULL DEFAULT 0,

  status text NOT NULL DEFAULT 'reserved',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_rooms_booking_id
ON booking_rooms (booking_id);

CREATE INDEX IF NOT EXISTS idx_booking_rooms_room_id
ON booking_rooms (room_id);

-- Operational Index: Helps arrival dashboards, room assignment boards, PMS sync
CREATE INDEX IF NOT EXISTS idx_booking_rooms_hotel_status
ON booking_rooms (hotel_id, status);

-- MIGRATION 3 — booking_room_guests
-- Why: Each reserved room may contain multiple guests; required for pre-check-in and compliance.
CREATE TABLE IF NOT EXISTS booking_room_guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_room_id uuid NOT NULL REFERENCES booking_rooms(id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
  is_primary boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  
  -- Prevent duplicate guests per room
  CONSTRAINT uq_booking_room_guest UNIQUE (booking_room_id, guest_id)
);

CREATE INDEX IF NOT EXISTS idx_booking_room_guests_room
ON booking_room_guests (booking_room_id);

CREATE INDEX IF NOT EXISTS idx_booking_room_guests_guest
ON booking_room_guests (guest_id);

-- MIGRATION 4 — stays must belong to booking_room
-- Why: Stay must represent room occupancy, not entire booking.
ALTER TABLE stays
ADD COLUMN IF NOT EXISTS booking_room_id uuid
REFERENCES booking_rooms(id);

CREATE INDEX IF NOT EXISTS idx_stays_booking_room_id
ON stays (booking_room_id);

-- MIGRATION 5 — stay_guests mapping
-- Why: Multiple guests can stay in one room; required for service attribution and compliance.
CREATE TABLE IF NOT EXISTS stay_guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stay_id uuid NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
  is_primary boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),

  -- Prevent duplicate guests per stay
  CONSTRAINT uq_stay_guest UNIQUE (stay_id, guest_id)
);

CREATE INDEX IF NOT EXISTS idx_stay_guests_stay
ON stay_guests (stay_id);

CREATE INDEX IF NOT EXISTS idx_stay_guests_guest
ON stay_guests (guest_id);

-- MIGRATION 6 — Backfill existing bookings into booking_rooms
-- Why: Keep current production data working.
INSERT INTO booking_rooms (booking_id, hotel_id, room_type_id, room_id, adults, children)
SELECT
  id,
  hotel_id,
  room_type_id,
  room_id,
  adults,
  children
FROM bookings
WHERE room_type_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM booking_rooms WHERE booking_id = bookings.id); -- Idempotency check

-- MIGRATION 7 — Backfill stays booking_room_id
-- Why: Existing stays must be linked to booking_rooms.
UPDATE stays s
SET booking_room_id = br.id
FROM booking_rooms br
WHERE s.booking_id = br.booking_id
AND (s.room_id = br.room_id OR br.room_id IS NULL)
AND s.booking_room_id IS NULL;


-- MIGRATION 8 — Data Integrity Trigger
-- Ensure booking_room belongs to same hotel as stay
CREATE OR REPLACE FUNCTION check_stay_booking_room_hotel()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.booking_room_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM booking_rooms br
      WHERE br.id = NEW.booking_room_id
      AND br.hotel_id = NEW.hotel_id
    ) THEN
      RAISE EXCEPTION 'Booking Room must belong to the same Hotel as the Stay';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_stay_booking_room_hotel ON stays;
CREATE TRIGGER trg_check_stay_booking_room_hotel
BEFORE INSERT OR UPDATE ON stays
FOR EACH ROW
EXECUTE FUNCTION check_stay_booking_room_hotel();


-- MIGRATION 9 — Future phase (do NOT drop immediately)
/*
Later, after application changes:

bookings.room_id         → deprecated
bookings.room_type_id    → deprecated
bookings.adults          → deprecated
bookings.children        → deprecated
Drop only when all reads use booking_rooms.
*/

-- ============================================================
-- MIGRATION 10 — Safety Constraints
-- ============================================================

-- 1. Prevent duplicate booking_rooms for the same slot (handles NULL room_id)
-- Note: Postgres treats NULLs as distinct, so we must coalesce for uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_room_unique
ON booking_rooms (booking_id, room_type_id, COALESCE(room_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 2. Ensure a booking_room can belong to only one active stay
CREATE UNIQUE INDEX IF NOT EXISTS uq_stays_active_booking_room
ON stays (booking_room_id)
WHERE status IN ('arriving','inhouse');

-- 3. Ensure only one primary guest per booking room
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_room_primary_guest
ON booking_room_guests (booking_room_id)
WHERE is_primary = true;

-- 4. Ensure only one primary guest per stay
CREATE UNIQUE INDEX IF NOT EXISTS uq_stay_primary_guest
ON stay_guests (stay_id)
WHERE is_primary = true;

-- 5. Ensure booking_room.hotel_id always matches the booking
CREATE OR REPLACE FUNCTION check_booking_room_hotel()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.id = NEW.booking_id
    AND b.hotel_id = NEW.hotel_id
  ) THEN
    RAISE EXCEPTION 'Booking Room must belong to the same Hotel as the Booking';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_booking_room_hotel ON booking_rooms;
CREATE TRIGGER trg_check_booking_room_hotel
BEFORE INSERT OR UPDATE ON booking_rooms
FOR EACH ROW
EXECUTE FUNCTION check_booking_room_hotel();

