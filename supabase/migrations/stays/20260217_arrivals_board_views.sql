-- Enterprise Arrival Operational State Engine
-- ============================================================

-- ── 1. Schema Updates & Supporting Tables ──

-- Create Enum Type (Idempotent)
DO $$ BEGIN
    CREATE TYPE housekeeping_status_enum AS ENUM ('clean', 'dirty', 'pickup', 'inspected', 'out_of_order');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Safer ENUM conversion logic
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS housekeeping_status TEXT;
ALTER TABLE rooms ALTER COLUMN housekeeping_status DROP DEFAULT;
UPDATE rooms SET housekeeping_status = 'clean' WHERE housekeeping_status IS NULL;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name='rooms' 
        AND column_name='housekeeping_status' 
        AND udt_name='housekeeping_status_enum'
    ) THEN
        ALTER TABLE rooms 
        ALTER COLUMN housekeeping_status TYPE housekeeping_status_enum 
        USING COALESCE(housekeeping_status::text, 'clean')::housekeeping_status_enum;
    END IF;
END $$;

ALTER TABLE rooms ALTER COLUMN housekeeping_status SET DEFAULT 'clean'::housekeeping_status_enum;
ALTER TABLE rooms ALTER COLUMN housekeeping_status SET NOT NULL;
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_housekeeping_status_check;

-- Ensure index for housekeeping status
CREATE INDEX IF NOT EXISTS idx_rooms_hk_status ON rooms(housekeeping_status);

-- Ensure Guest table has VIP/Loyalty columns
ALTER TABLE guests ADD COLUMN IF NOT EXISTS vip_flag BOOLEAN DEFAULT false;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS loyalty_tier TEXT DEFAULT 'standard';

-- ── 2. New Enterprise Tables (Stubs & Logs) ──

-- Folios Table (Updated to hotel-scoped accounting)
CREATE TABLE IF NOT EXISTS folios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id UUID NOT NULL REFERENCES hotels(id),
    booking_id UUID REFERENCES bookings(id),
    status TEXT DEFAULT 'OPEN', -- OPEN, CLOSED
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Housekeeping Tasks Table
CREATE TABLE IF NOT EXISTS housekeeping_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES rooms(id),
    status TEXT DEFAULT 'pending', -- pending, in_progress, completed
    estimated_completion_at TIMESTAMPTZ,
    assigned_to UUID,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Housekeeping Audit Log
CREATE TABLE IF NOT EXISTS housekeeping_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id UUID NOT NULL,
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    old_status housekeeping_status_enum,
    new_status housekeeping_status_enum NOT NULL,
    changed_by UUID, -- auth.uid() or NULL for system
    changed_at TIMESTAMPTZ DEFAULT now(),
    notes TEXT
);

-- Arrival Audit Log
CREATE TABLE IF NOT EXISTS arrival_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id UUID NOT NULL,
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL, 
    old_value TEXT,
    new_value TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    performed_by UUID, -- auth.uid()
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT arrival_events_type_check CHECK (event_type IN ('STATUS_CHANGE', 'ROOM_ASSIGNED', 'ROOM_UNASSIGNED', 'ROOM_REASSIGNED', 'CHECKIN', 'CANCEL', 'NO_SHOW'))
);

-- Enable RLS
ALTER TABLE folios ENABLE ROW LEVEL SECURITY;
ALTER TABLE housekeeping_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE housekeeping_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE arrival_events ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT, INSERT, UPDATE ON folios TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON housekeeping_tasks TO authenticated, service_role;
GRANT SELECT, INSERT ON housekeeping_events TO authenticated, service_role;
GRANT SELECT, INSERT ON arrival_events TO authenticated, service_role;

-- ── 3. Performance Indexes ──

CREATE INDEX IF NOT EXISTS idx_hk_events_room ON housekeeping_events(room_id);
CREATE INDEX IF NOT EXISTS idx_hk_events_hotel ON housekeeping_events(hotel_id);
CREATE INDEX IF NOT EXISTS idx_arrival_events_booking ON arrival_events(booking_id);
CREATE INDEX IF NOT EXISTS idx_arrival_events_hotel ON arrival_events(hotel_id);
CREATE INDEX IF NOT EXISTS idx_folios_booking_id ON folios(booking_id);
CREATE INDEX IF NOT EXISTS idx_housekeeping_tasks_room_id ON housekeeping_tasks(room_id);

CREATE INDEX IF NOT EXISTS idx_booking_rooms_booking_id ON booking_rooms(booking_id);
CREATE INDEX IF NOT EXISTS idx_stays_booking_id_status ON stays(booking_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_arrival_status ON bookings(hotel_id, status, scheduled_checkin_at);

-- ── 4. Core Views: Arrival Engine ──

-- Foundation View: Calculates operational readiness
CREATE OR REPLACE VIEW v_arrival_operational_state AS
WITH room_states AS (
    SELECT
        br.booking_id,
        STRING_AGG(r.number, ', ') AS room_numbers,
        COUNT(*) AS rooms_total,
        COUNT(*) FILTER (WHERE br.status = 'checked_in') AS rooms_checked_in,
        COUNT(*) FILTER (WHERE br.room_id IS NULL) AS rooms_unassigned,
        COUNT(*) FILTER (WHERE br.room_id IS NOT NULL AND r.housekeeping_status = 'dirty') AS rooms_dirty,
        COUNT(*) FILTER (WHERE br.room_id IS NOT NULL AND r.housekeeping_status IN ('clean', 'inspected', 'pickup')) AS rooms_clean
    FROM booking_rooms br
    LEFT JOIN rooms r ON r.id = br.room_id
    GROUP BY br.booking_id
),
stay_states AS (
    SELECT booking_id, COUNT(*) FILTER (WHERE status = 'inhouse') AS inhouse_count
    FROM stays GROUP BY booking_id
)
SELECT
    b.id AS booking_id,
    b.hotel_id,
    b.code AS booking_code,
    b.guest_name,
    b.phone,
    b.status AS booking_status,
    b.scheduled_checkin_at,
    b.scheduled_checkout_at,
    rs.room_numbers,
    COALESCE(rs.rooms_total, 0) as rooms_total,
    COALESCE(rs.rooms_checked_in, 0) as rooms_checked_in,
    COALESCE(rs.rooms_unassigned, 0) as rooms_unassigned,
    COALESCE(rs.rooms_dirty, 0) as rooms_dirty,
    COALESCE(rs.rooms_clean, 0) as rooms_clean,
    COALESCE(ss.inhouse_count, 0) AS inhouse_rooms,
    CASE
        -- 1. OVERRIDE: Booking is strictly already checked in
        WHEN b.status = 'CHECKED_IN' THEN 'CHECKED_IN'
        WHEN b.status = 'PARTIALLY_CHECKED_IN' THEN 'PARTIALLY_ARRIVED'
        
        -- 2. OPERATIONAL STATE
        WHEN COALESCE(rs.rooms_total, 0) = 0 THEN 'NO_ROOMS'
        WHEN COALESCE(rs.rooms_checked_in, 0) = COALESCE(rs.rooms_total, 0) AND COALESCE(rs.rooms_total, 0) > 0 THEN 'CHECKED_IN'
        WHEN COALESCE(rs.rooms_checked_in, 0) > 0 THEN 'PARTIALLY_ARRIVED'
        WHEN COALESCE(rs.rooms_dirty, 0) > 0 THEN 'WAITING_HOUSEKEEPING'
        WHEN COALESCE(rs.rooms_unassigned, 0) > 0 THEN 'WAITING_ROOM_ASSIGNMENT'
        WHEN COALESCE(rs.rooms_clean, 0) = COALESCE(rs.rooms_total, 0) AND COALESCE(rs.rooms_total, 0) > 0 THEN 'READY_TO_CHECKIN'
        ELSE 'EXPECTED'
    END AS arrival_operational_state,
    CASE
        WHEN COALESCE(rs.rooms_clean, 0) = COALESCE(rs.rooms_total, 0) AND COALESCE(rs.rooms_total, 0) > 0 THEN true
        ELSE false
    END AS rooms_ready_for_arrival,
    CASE
        -- Edge: No rooms or already checked in
        WHEN COALESCE(rs.rooms_total, 0) = 0 OR COALESCE(rs.rooms_checked_in, 0) = COALESCE(rs.rooms_total, 0) THEN 'NONE'
        
        -- Blocker: Housekeeping
        WHEN COALESCE(rs.rooms_dirty, 0) > 0 THEN 'WAIT_HOUSEKEEPING'
        
        -- Default to Check-In (Even if unassigned, flow handles it)
        ELSE 'CHECKIN'
    END AS primary_action
FROM bookings b
LEFT JOIN room_states rs ON rs.booking_id = b.id
LEFT JOIN stay_states ss ON ss.booking_id = b.id
WHERE b.status IN ('CREATED', 'CONFIRMED', 'PRE_CHECKED_IN', 'PARTIALLY_CHECKED_IN', 'CHECKED_IN')
AND b.status NOT IN ('CANCELLED', 'NO_SHOW');

-- UI-Facing View: Adds Urgency & Formatting
DROP VIEW IF EXISTS v_owner_arrivals_dashboard CASCADE;
CREATE OR REPLACE VIEW v_owner_arrivals_dashboard AS
WITH base AS ( SELECT * FROM v_arrival_operational_state ),
timers AS (
    SELECT booking_id, EXTRACT(EPOCH FROM (now() - scheduled_checkin_at))/60 AS minutes_since_scheduled_arrival
    FROM base
)
SELECT
    b.booking_id,
    b.hotel_id,
    b.booking_code,
    b.booking_status,
    b.guest_name,
    b.phone,
    b.scheduled_checkin_at,
    b.scheduled_checkout_at,
    b.room_numbers,
    b.rooms_total,
    b.rooms_checked_in,
    b.rooms_unassigned,
    b.rooms_dirty,
    b.rooms_clean,
    b.inhouse_rooms,
    b.arrival_operational_state,
    b.rooms_ready_for_arrival,
    b.primary_action,
    t.minutes_since_scheduled_arrival,
    CASE
        WHEN t.minutes_since_scheduled_arrival > 60 THEN 'CRITICAL'
        WHEN t.minutes_since_scheduled_arrival > 30 THEN 'HIGH'
        WHEN t.minutes_since_scheduled_arrival > 10 THEN 'MEDIUM'
        ELSE 'LOW'
    END AS urgency_level,
    b.rooms_ready_for_arrival AS eligible_for_bulk_checkin
FROM base b
LEFT JOIN timers t ON t.booking_id = b.booking_id;

-- ── 5. Enterprise Data Contract Views ──

-- Payment Status Layer (Updated to use folio_entries ledger)
CREATE OR REPLACE VIEW v_arrival_payment_state AS
SELECT
    b.id AS booking_id,
    COALESCE(SUM(fe.amount) FILTER (WHERE fe.entry_type IN ('ROOM_CHARGE', 'FOOD_CHARGE', 'SERVICE_CHARGE', 'TAX')), 0) AS total_amount,
    COALESCE(SUM(fe.amount) FILTER (WHERE fe.entry_type IN ('PAYMENT')), 0) - COALESCE(SUM(fe.amount) FILTER (WHERE fe.entry_type IN ('REFUND')), 0) AS paid_amount,
    (COALESCE(SUM(fe.amount) FILTER (WHERE fe.entry_type IN ('ROOM_CHARGE', 'FOOD_CHARGE', 'SERVICE_CHARGE', 'TAX')), 0) - 
     (COALESCE(SUM(fe.amount) FILTER (WHERE fe.entry_type IN ('PAYMENT')), 0) - COALESCE(SUM(fe.amount) FILTER (WHERE fe.entry_type IN ('REFUND')), 0))) AS pending_amount,
    CASE 
        WHEN (COALESCE(SUM(fe.amount) FILTER (WHERE fe.entry_type IN ('ROOM_CHARGE', 'FOOD_CHARGE', 'SERVICE_CHARGE', 'TAX')), 0) - 
             (COALESCE(SUM(fe.amount) FILTER (WHERE fe.entry_type IN ('PAYMENT')), 0) - COALESCE(SUM(fe.amount) FILTER (WHERE fe.entry_type IN ('REFUND')), 0))) > 0 
        THEN true 
        ELSE false 
    END AS payment_pending
FROM bookings b
LEFT JOIN folio_entries fe ON fe.booking_id = b.id
GROUP BY b.id;

-- Guest / Booking Labels Layer
CREATE OR REPLACE VIEW v_arrival_guest_labels AS
SELECT
    b.id AS booking_id,
    g.vip_flag,
    g.loyalty_tier,
    b.source AS booking_source,
    CASE
        WHEN g.vip_flag THEN 'VIP'
        WHEN b.source::text IN ('booking.com','expedia','airbnb') THEN 'OTA'
        ELSE 'DIRECT'
    END AS arrival_badge
FROM bookings b
LEFT JOIN guests g ON g.id = b.guest_id;

-- Housekeeping ETA Layer (Aggregated by Room)
CREATE OR REPLACE VIEW v_arrival_housekeeping_eta AS
SELECT
    room_id,
    MIN(estimated_completion_at) AS estimated_completion_at,
    MIN(EXTRACT(EPOCH FROM (estimated_completion_at - now()))/60) AS minutes_remaining
FROM housekeeping_tasks
WHERE status = 'in_progress'
GROUP BY room_id;

-- Final Unified Row View (UI Consumes This)
CREATE OR REPLACE VIEW v_arrival_dashboard_rows AS
SELECT
    a.*,
    COALESCE(p.payment_pending, false) as payment_pending,
    COALESCE(p.pending_amount, 0) as pending_amount,
    l.arrival_badge,
    COALESCE(l.vip_flag, false) as vip_flag,
    hk.cleaning_minutes_remaining
FROM v_owner_arrivals_dashboard a
LEFT JOIN v_arrival_payment_state p ON p.booking_id = a.booking_id
LEFT JOIN v_arrival_guest_labels l ON l.booking_id = a.booking_id
LEFT JOIN (
    SELECT 
        br.booking_id,
        MIN(h.minutes_remaining) AS cleaning_minutes_remaining
    FROM booking_rooms br
    JOIN v_arrival_housekeeping_eta h ON h.room_id = br.room_id
    GROUP BY br.booking_id
) hk ON hk.booking_id = a.booking_id;

-- Dashboard Summary Counters
CREATE OR REPLACE VIEW v_arrival_dashboard_summary AS
SELECT
    hotel_id,
    COUNT(*) AS total_arrivals,
    COUNT(*) FILTER (WHERE arrival_operational_state IN ('CHECKED_IN', 'PARTIALLY_ARRIVED')) AS arrived,
    COUNT(*) FILTER (WHERE rooms_ready_for_arrival) AS ready_to_checkin,
    COUNT(*) FILTER (WHERE arrival_operational_state='WAITING_ROOM_ASSIGNMENT') AS waiting_room_assignment,
    COUNT(*) FILTER (WHERE payment_pending) AS payment_pending,
    COUNT(*) FILTER (WHERE vip_flag) AS vip_today
FROM v_arrival_dashboard_rows
GROUP BY hotel_id;

-- Grants for Views
GRANT SELECT ON v_arrival_operational_state TO authenticated, service_role;
GRANT SELECT ON v_owner_arrivals_dashboard TO authenticated, service_role;
GRANT SELECT ON v_arrival_payment_state TO authenticated, service_role;
GRANT SELECT ON v_arrival_guest_labels TO authenticated, service_role;
GRANT SELECT ON v_arrival_housekeeping_eta TO authenticated, service_role;
GRANT SELECT ON v_arrival_dashboard_rows TO authenticated, service_role;
GRANT SELECT ON v_arrival_dashboard_summary TO authenticated, service_role;

-- ── 6. Triggers & Functions ──

-- Log Housekeeping Changes
CREATE OR REPLACE FUNCTION log_housekeeping_change()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.housekeeping_status IS DISTINCT FROM NEW.housekeeping_status) THEN
        INSERT INTO housekeeping_events (hotel_id, room_id, old_status, new_status, changed_by)
        VALUES (NEW.hotel_id, NEW.id, OLD.housekeeping_status, NEW.housekeeping_status, COALESCE(auth.uid(), NULL));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_log_housekeeping_change ON rooms;
CREATE TRIGGER trg_log_housekeeping_change
AFTER UPDATE ON rooms
FOR EACH ROW
EXECUTE FUNCTION log_housekeeping_change();

-- Log Booking Status Changes
CREATE OR REPLACE FUNCTION log_booking_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.status IS DISTINCT FROM NEW.status) THEN
        INSERT INTO arrival_events (hotel_id, booking_id, event_type, old_value, new_value, performed_by)
        VALUES (NEW.hotel_id, NEW.id, 'STATUS_CHANGE', OLD.status, NEW.status, COALESCE(auth.uid(), NULL));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_log_booking_status ON bookings;
CREATE TRIGGER trg_log_booking_status
AFTER UPDATE ON bookings
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION log_booking_status_change();

-- Log Room Assignment Changes
CREATE OR REPLACE FUNCTION log_room_assignment_change()
RETURNS TRIGGER AS $$
DECLARE
    v_hotel_id UUID;
BEGIN
    SELECT hotel_id INTO v_hotel_id FROM bookings WHERE id = COALESCE(NEW.booking_id, OLD.booking_id);
    IF (OLD.room_id IS NULL AND NEW.room_id IS NOT NULL) THEN
        INSERT INTO arrival_events (hotel_id, booking_id, event_type, new_value, performed_by)
        VALUES (v_hotel_id, NEW.booking_id, 'ROOM_ASSIGNED', NEW.room_id::text, COALESCE(auth.uid(), NULL));
    ELSIF (OLD.room_id IS NOT NULL AND NEW.room_id IS NULL) THEN
        INSERT INTO arrival_events (hotel_id, booking_id, event_type, old_value, performed_by)
        VALUES (v_hotel_id, OLD.booking_id, 'ROOM_UNASSIGNED', OLD.room_id::text, COALESCE(auth.uid(), NULL));
    ELSIF (OLD.room_id IS DISTINCT FROM NEW.room_id) THEN
        INSERT INTO arrival_events (hotel_id, booking_id, event_type, old_value, new_value, performed_by)
        VALUES (v_hotel_id, NEW.booking_id, 'ROOM_REASSIGNED', OLD.room_id::text, NEW.room_id::text, COALESCE(auth.uid(), NULL));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_log_room_assignment ON booking_rooms;
CREATE TRIGGER trg_log_room_assignment
AFTER UPDATE ON booking_rooms
FOR EACH ROW
WHEN (OLD.room_id IS DISTINCT FROM NEW.room_id)
EXECUTE FUNCTION log_room_assignment_change();

