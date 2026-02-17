-- ============================================================
-- GUEST CHECK-IN SYSTEM SCHEMA
-- ============================================================

-- 1. Ensure Guests Table Exists (New requirement)
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

-- 1b. Update Guests Table (Idempotent)
ALTER TABLE guests ADD COLUMN IF NOT EXISTS nationality TEXT;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS dob DATE;

-- Critical: Ensure mobile exists (schema sync for existing guests table)
ALTER TABLE guests ADD COLUMN IF NOT EXISTS mobile TEXT;
UPDATE guests SET mobile = phone WHERE mobile IS NULL AND phone IS NOT NULL;

-- 1c. Ensure Stays has guest_id (Critical Fix - Using DO block to be explicit)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stays' AND column_name='guest_id') THEN
    ALTER TABLE stays ADD COLUMN guest_id UUID REFERENCES guests(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- 1d. Update Bookings Table (Critical for RPCs)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';

-- 2. Check-in Sessions (Kiosk State)
-- ============================================================
CREATE TYPE checkin_session_status AS ENUM ('active', 'completed', 'abandoned', 'expired');

CREATE TABLE IF NOT EXISTS checkin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  
  device_id TEXT, -- Optional identifier for the kiosk/device
  
  status checkin_session_status NOT NULL DEFAULT 'active',
  
  -- Session data can be stored here temporarily if needed
  state_data JSONB DEFAULT '{}'::jsonb,
  
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkin_sessions_hotel_status 
ON checkin_sessions(hotel_id, status);

-- 3. Guest Identity Documents (KYC)
-- ============================================================
CREATE TYPE guest_document_type AS ENUM ('passport', 'aadhaar', 'driving_license', 'other');
CREATE TYPE verification_status AS ENUM ('pending', 'verified', 'rejected');

CREATE TABLE IF NOT EXISTS guest_id_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  
  document_type guest_document_type NOT NULL,
  document_number TEXT,
  
  front_image_url TEXT,
  back_image_url TEXT,
  
  issuing_country TEXT,
  expiry_date DATE,
  
  -- Verification Audit
  verification_status verification_status NOT NULL DEFAULT 'pending',
  verified_by UUID REFERENCES hotel_members(id),
  verified_at TIMESTAMPTZ,
  rejection_reason TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Ensure one document per type per guest
  CONSTRAINT uq_guest_id_doc_type UNIQUE (guest_id, document_type)
);

-- Critical: Ensure guest_id exists in guest_id_documents if table already existed without it
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='guest_id_documents' AND column_name='guest_id') THEN
    ALTER TABLE guest_id_documents ADD COLUMN guest_id UUID REFERENCES guests(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_guest_docs_guest_id ON guest_id_documents(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_docs_status ON guest_id_documents(verification_status);

-- 4. Check-in Events (Audit Log)
-- ============================================================
CREATE TYPE checkin_event_type AS ENUM (
  'STARTED',
  'ID_VERIFIED',
  'PAYMENT_COLLECTED', 
  'ROOM_ASSIGNED',
  'COMPLETED',
  'ABANDONED' -- If tracking via events
);

CREATE TABLE IF NOT EXISTS checkin_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stay_id UUID REFERENCES stays(id) ON DELETE SET NULL, -- Can be null if abandoned before stay creation
  session_id UUID REFERENCES checkin_sessions(id) ON DELETE SET NULL,
  
  event_type checkin_event_type NOT NULL,
  
  meta JSONB DEFAULT '{}'::jsonb, -- Snapshot of details
  
  actor_id UUID, -- Who performed the action (could be guest via kiosk, or staff)
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkin_events_stay_id ON checkin_events(stay_id);
CREATE INDEX IF NOT EXISTS idx_checkin_events_session_id ON checkin_events(session_id);

-- 5. RLS Policies
-- ============================================================

-- Enable RLS
ALTER TABLE checkin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_id_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkin_events ENABLE ROW LEVEL SECURITY;

-- Policies (Simplified for now, expecting service role or authenticated staff access)

-- Checkin Sessions: Authenticated can create/read (Kiosk is authenticated user or anon with special logic?)
-- Assuming authenticated staff/kiosk-service-user for now.
CREATE POLICY "Authenticated users can manage checkin sessions" 
ON checkin_sessions FOR ALL TO authenticated USING (true);
CREATE POLICY "Anon can create checkin sessions" 
ON checkin_sessions FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can read own checkin session"
ON checkin_sessions FOR SELECT TO anon USING (true); -- Requires careful logic in real app, often just ID check

-- Documents: Strictly controlled
CREATE POLICY "Staff can view all documents" 
ON guest_id_documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff/System can upload documents" 
ON guest_id_documents FOR INSERT TO authenticated WITH CHECK (true);
-- Anon might need insert permission if directly uploading from kiosk without auth
CREATE POLICY "Anon can upload documents" 
ON guest_id_documents FOR INSERT TO anon WITH CHECK (true);

-- Events
CREATE POLICY "Staff can view events" 
ON checkin_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff/System can log events" 
ON checkin_events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Anon can log events" 
ON checkin_events FOR INSERT TO anon WITH CHECK (true);

-- 6. Performance Indices
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_bookings_search
ON bookings (hotel_id, status, code, phone);

CREATE INDEX IF NOT EXISTS idx_stays_booking_id
ON stays (booking_id);

CREATE INDEX IF NOT EXISTS idx_stays_room_time
ON stays (room_id, scheduled_checkin_at, scheduled_checkout_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stays_booking_active
ON stays (booking_id)
WHERE status IN ('arriving', 'inhouse');

CREATE UNIQUE INDEX IF NOT EXISTS uq_guests_mobile_hotel
ON guests (hotel_id, mobile)
WHERE mobile IS NOT NULL;

-- Functional Index for Normalized Search
CREATE INDEX IF NOT EXISTS idx_guests_mobile_norm
ON guests (hotel_id, regexp_replace(mobile, '[^0-9]', '', 'g'));

ALTER TABLE guests
ADD CONSTRAINT guests_mobile_normalized
CHECK (mobile = regexp_replace(mobile, '[^0-9]', '', 'g')) NOT VALID;

ALTER TABLE guests VALIDATE CONSTRAINT guests_mobile_normalized;

CREATE INDEX IF NOT EXISTS idx_stays_room_status_time
ON stays (room_id, status, scheduled_checkin_at, scheduled_checkout_at);

CREATE INDEX IF NOT EXISTS idx_profiles_email
ON profiles (email);

-- 7. Extensions & TRGM Indices (Search Performance)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_bookings_code_trgm
ON bookings USING gin (code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_bookings_phone_trgm
ON bookings USING gin (phone gin_trgm_ops);

CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_doc_unique
ON guest_id_documents (guest_id, document_type);

-- 8. Final Production Integrity
-- ============================================================
-- Note: 'bookings_checkedin_requires_stay' constraint is NOT created.
-- (Cleanup block removed to prevent 'does not exist' errors on some Postgres versions)

CREATE OR REPLACE FUNCTION trg_check_booking_stay_integrity()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'CHECKED_IN' THEN
    IF NOT EXISTS (SELECT 1 FROM stays s WHERE s.booking_id = NEW.id) THEN
       RAISE EXCEPTION 'Booking cannot be marked CHECKED_IN without an associated stay record.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_booking_checkin ON bookings;
CREATE TRIGGER validate_booking_checkin
BEFORE INSERT OR UPDATE ON bookings
FOR EACH ROW
EXECUTE FUNCTION trg_check_booking_stay_integrity();

CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_code
ON bookings (code);

CREATE INDEX IF NOT EXISTS idx_checkin_sessions_expiry
ON checkin_sessions (expires_at)
WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_checkin_events_created_at
ON checkin_events (created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_device_active_session
ON checkin_sessions (hotel_id, device_id)
WHERE status = 'active';

-- Operational View
CREATE OR REPLACE VIEW v_active_checkins AS
SELECT hotel_id, count(*) active_sessions
FROM checkin_sessions
WHERE status='active'
GROUP BY hotel_id;

-- 9. Critical Integrity & Security (Final Layer)
-- ============================================================

-- 9. Critical Integrity & Security (Final Layer)
-- ============================================================

-- A. Room Overlap Protection
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE stays
ADD CONSTRAINT stays_no_overlap
EXCLUDE USING gist (
  room_id WITH =,
  tstzrange(scheduled_checkin_at, scheduled_checkout_at, '[)') WITH &&
)
WHERE (status IN ('arriving', 'inhouse'));

-- B. Audit Integrity
ALTER TABLE checkin_events
ADD CONSTRAINT fk_checkin_actor
FOREIGN KEY (actor_id)
REFERENCES hotel_members(id)
ON DELETE SET NULL;

-- C. Secure Session Access
DROP POLICY IF EXISTS "Anon can read own checkin session" ON checkin_sessions;

CREATE POLICY "Anon can read own checkin session"
ON checkin_sessions FOR SELECT TO anon
USING (
  current_setting('request.jwt.claim.session_id', true) IS NOT NULL
  AND id = current_setting('request.jwt.claim.session_id', true)::uuid
);

-- D. Automated Timestamps
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp ON checkin_sessions;
CREATE TRIGGER set_timestamp
BEFORE UPDATE ON checkin_sessions
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS set_timestamp ON guest_id_documents;
CREATE TRIGGER set_timestamp
BEFORE UPDATE ON guest_id_documents
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- E. Booking Integrity (Prevent Direct Updates)
DROP POLICY IF EXISTS booking_status_update_restricted ON bookings;
DROP POLICY IF EXISTS booking_status_update_service ON bookings;

CREATE POLICY booking_status_update_restricted
ON bookings
FOR UPDATE
TO authenticated
USING (false);

CREATE POLICY booking_status_update_service
ON bookings
FOR UPDATE
TO service_role
USING (true)
WITH CHECK (true);

-- F. Booking Deletion Protection & Validation
ALTER TABLE stays
DROP CONSTRAINT IF EXISTS stays_booking_id_fkey,
ADD CONSTRAINT stays_booking_id_fkey
FOREIGN KEY (booking_id)
REFERENCES bookings(id)
ON DELETE RESTRICT;

-- (Removed VALIDATE CONSTRAINT bookings_checkedin_requires_stay)

-- G. Stay Lifecycle Protection
ALTER TABLE stays
ADD CONSTRAINT stays_status_valid
CHECK (status IN ('arriving','inhouse','checked_out','cancelled')) NOT VALID;

ALTER TABLE stays VALIDATE CONSTRAINT stays_status_valid;

ALTER TABLE stays
ADD CONSTRAINT stays_time_valid
CHECK (scheduled_checkout_at > scheduled_checkin_at);

-- H. Event Insert Protection
CREATE POLICY checkin_events_insert_service
ON checkin_events
FOR INSERT
TO service_role
WITH CHECK (true);

-- I. Final Integrity (Source Enum & Session Expiry)
-- Safe Migration for Enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_source') THEN
     CREATE TYPE booking_source AS ENUM ('manual','walk_in','pms_sync','ota');
  END IF;
END$$;

ALTER TABLE bookings
ALTER COLUMN source DROP DEFAULT;

UPDATE bookings
SET source = 'manual'
WHERE source IS NULL
   OR source NOT IN ('manual','walk_in','pms_sync','ota');

ALTER TABLE bookings
ALTER COLUMN source TYPE booking_source
USING source::booking_source;

ALTER TABLE bookings
ALTER COLUMN source SET DEFAULT 'manual';

ALTER TABLE checkin_sessions
ADD CONSTRAINT checkin_session_expiry_valid
CHECK (expires_at > started_at);

DROP INDEX IF EXISTS uq_guest_doc_unique;
CREATE UNIQUE INDEX uq_guest_doc_unique
ON guest_id_documents (guest_id, document_type)
WHERE document_type IS NOT NULL;
