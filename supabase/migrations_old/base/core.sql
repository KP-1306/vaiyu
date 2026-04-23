-- ============================================================
-- CORE SCHEMA (Hotels, Rooms, Users)
-- ============================================================

-- 1. Custom Enums
-- ============================================================

CREATE TYPE public.housekeeping_status_enum AS ENUM ('clean', 'dirty', 'pickup', 'inspected', 'out_of_order', 'in_progress');
CREATE TYPE public.room_operational_status AS ENUM ('vacant', 'occupied', 'maintenance', 'out_of_order');


-- 2. Hotels
-- ============================================================
CREATE TABLE IF NOT EXISTS hotels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  currency TEXT DEFAULT 'INR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_hotels_updated
BEFORE UPDATE ON hotels
FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- 3. Room Types
-- ============================================================
CREATE TABLE IF NOT EXISTS public.room_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  name text NOT NULL,              -- Deluxe, Suite
  description text,
  base_occupancy int DEFAULT 2,
  max_occupancy int DEFAULT 3,
  created_at timestamptz DEFAULT now()
);


-- 4. Rooms
-- ============================================================
CREATE TABLE public.rooms (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL,
  number text NOT NULL,
  floor text NULL,
  status public.room_operational_status NOT NULL DEFAULT 'vacant'::room_operational_status,
  housekeeping_status public.housekeeping_status_enum NOT NULL DEFAULT 'clean'::housekeeping_status_enum,
  room_type_id uuid NOT NULL,
  wing text null,
  is_out_of_order boolean null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint rooms_pkey primary key (id),
  constraint rooms_hotel_id_number_key unique (hotel_id, number),
  constraint rooms_hotel_id_fkey foreign KEY (hotel_id) references hotels (id) on delete CASCADE,
  constraint rooms_room_type_fk foreign KEY (room_type_id, hotel_id) references room_types (id, hotel_id) on update CASCADE on delete RESTRICT
) TABLESPACE pg_default;

-- Triggers for Rooms
CREATE TRIGGER trg_rooms_updated
BEFORE UPDATE ON rooms
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Housekeeping Audit Log Trigger
CREATE OR REPLACE FUNCTION log_housekeeping_change()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.housekeeping_status IS DISTINCT FROM NEW.housekeeping_status) THEN
        -- Insertion handled by housekeeping_events table if it exists in later migrations
        -- This function is a stub that later migrations can override or supplement
        NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_log_housekeeping_change
AFTER UPDATE ON rooms
FOR EACH ROW EXECUTE FUNCTION log_housekeeping_change();

-- Optimized Indexes
CREATE INDEX IF NOT EXISTS idx_rooms_hotel_status ON public.rooms (hotel_id, housekeeping_status);
CREATE INDEX IF NOT EXISTS idx_rooms_hotel_floor ON public.rooms (hotel_id, floor);
CREATE INDEX IF NOT EXISTS idx_rooms_hotel ON public.rooms (hotel_id);
CREATE INDEX IF NOT EXISTS idx_rooms_hotel_number ON public.rooms (hotel_id, number);
CREATE INDEX IF NOT EXISTS idx_rooms_hk_board ON public.rooms (hotel_id, housekeeping_status, room_type_id, is_out_of_order);
CREATE INDEX IF NOT EXISTS idx_rooms_room_type ON public.rooms (room_type_id);
CREATE INDEX IF NOT EXISTS idx_rooms_hk_status ON public.rooms (housekeeping_status);
CREATE INDEX IF NOT EXISTS idx_rooms_roomtype_hotel ON public.rooms (room_type_id, hotel_id);


-- 5. Profiles (Staff/User base)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_profiles_updated
BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- 4. Guests
-- ============================================================
CREATE TABLE IF NOT EXISTS guests (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_guests_updated
BEFORE UPDATE ON guests
FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- 5. Realtime Configuration
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'tickets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE tickets;
  END IF;
END $$;
