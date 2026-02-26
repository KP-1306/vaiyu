-- Migration: Update CSV Import for Multi-Room/Guest Schema (Enterprise Grade - Final + 5 Critical + 4 Mandatory + 3 Production Safety Fixes + 2 Batch Triggers)
-- Purpose:
-- 1. Extend import_rows to support grouping by booking_reference and room/guest sequencing.
-- 2. Add columns to booking_rooms (rate_plan, amount, room_seq).
-- 3. Add robust unique indices for idempotency (guests, rooms, notifications).
-- 4. Add RPC fetch_pending_booking_groups using robust locking (JOIN + SKIP LOCKED).
-- 5. Add RPC process_booking_group for transactional booking & guest creation (with guard check).
-- 6. Add Watchdog function for crash recovery (Improved).

-- ==============================================================================
-- 0. SCHEMA PREREQUISITES (FORCE CLEANUP)
-- ==============================================================================

-- A. Drop the function FIRST so it doesn't hold any stale plans
DROP FUNCTION IF EXISTS public.create_precheckin_token(UUID);

-- B. Clear ANY index/constraint related to booking_id to start fresh
ALTER TABLE public.precheckin_tokens DROP CONSTRAINT IF EXISTS uq_precheckin_booking;
ALTER TABLE public.precheckin_tokens DROP CONSTRAINT IF EXISTS precheckin_tokens_booking_id_key;
ALTER TABLE public.precheckin_tokens DROP CONSTRAINT IF EXISTS uq_precheckin_tokens_booking;

DROP INDEX IF EXISTS public.uq_precheckin_booking;
DROP INDEX IF EXISTS public.idx_precheckin_tokens_booking;
DROP INDEX IF EXISTS public.idx_precheckin_tokens_booking_unused;
DROP INDEX IF EXISTS public.idx_precheckin_tokens_expires;

-- C. Final cleanup of any lingering duplicates (Required for UNIQUE to succeed)
DELETE FROM public.precheckin_tokens a 
USING public.precheckin_tokens b 
WHERE a.booking_id = b.booking_id AND a.id < b.id;

-- D. Create the STRICT UNIQUE constraint
ALTER TABLE public.precheckin_tokens
ADD CONSTRAINT uq_precheckin_booking UNIQUE (booking_id);


-- ==============================================================================
-- 1. Schema Updates & Constraints
-- ==============================================================================

ALTER TABLE public.import_rows
DROP CONSTRAINT IF EXISTS import_rows_status_check;

ALTER TABLE public.import_rows
ADD CONSTRAINT import_rows_status_check
CHECK (status IN (
    'uploaded',
    'pending',
    'validating',
    'valid',
    'processing',
    'importing',
    'imported',
    'notified',
    'error'
));

ALTER TABLE public.import_rows
ALTER COLUMN status SET DEFAULT 'uploaded';

CREATE INDEX IF NOT EXISTS idx_import_rows_status_booking
ON public.import_rows(status, booking_reference);


-- 1.1 Add columns to import_rows
ALTER TABLE public.import_rows
ADD COLUMN IF NOT EXISTS booking_reference TEXT,
ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.import_batches(id),
ADD COLUMN IF NOT EXISTS hotel_id uuid REFERENCES public.hotels(id),
ADD COLUMN IF NOT EXISTS room_seq INT NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS guest_seq INT NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS primary_guest_flag BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'csv',
ADD COLUMN IF NOT EXISTS source_updated_at timestamptz,
ADD COLUMN IF NOT EXISTS source_hash text;

-- 1.7.1 Index for delta-sync readiness
CREATE INDEX IF NOT EXISTS idx_import_rows_source_updated
ON public.import_rows(source_updated_at);

-- SAFETY FIX-1: Populate NULL booking_reference before NOT NULL constraint
UPDATE public.import_rows
SET booking_reference = 'legacy_' || id
WHERE booking_reference IS NULL;

ALTER TABLE public.import_rows
ALTER COLUMN booking_reference SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_import_rows_booking_ref_status
ON public.import_rows(booking_reference, status);

-- MANDATORY FIX-2: Covering index for worker scan
DROP INDEX IF EXISTS idx_import_rows_pending;
CREATE INDEX idx_import_rows_pending
ON public.import_rows(booking_reference, id)
WHERE status = 'pending';

-- SAFETY FIX-2: Index for processing rows (Watchdog speed)
DROP INDEX IF EXISTS idx_import_rows_importing;
DROP INDEX IF EXISTS idx_import_rows_processing;
CREATE INDEX IF NOT EXISTS idx_import_rows_processing
ON public.import_rows(status)
WHERE status = 'processing';

-- 1.12 Batch Processing Index (Merged from fix_import_status)
CREATE INDEX IF NOT EXISTS idx_import_rows_process_queue
ON public.import_rows(batch_id, status)
WHERE status = 'pending';

-- 1.2 booking_rooms columns
ALTER TABLE public.booking_rooms
ADD COLUMN IF NOT EXISTS room_seq INT,
ADD COLUMN IF NOT EXISTS rate_plan_code TEXT,
ADD COLUMN IF NOT EXISTS amount_total NUMERIC(10,2),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 1.3 booking_rooms unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_room_seq
ON public.booking_rooms(booking_id, room_seq);

-- 1.4 guests unique index
-- SAFETY FIX: Clean up duplicates before creating index
DELETE FROM public.guests
WHERE id IN (
    SELECT id
    FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY hotel_id, mobile
                   ORDER BY updated_at DESC
               ) as rn
        FROM public.guests
        WHERE mobile IS NOT NULL
    ) t
    WHERE t.rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_mobile
ON public.guests(hotel_id, mobile)
WHERE mobile IS NOT NULL;

-- 1.5 bookings columns
ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS rooms_total INT DEFAULT 0;

-- 1.4.1 Normalized Mobile Architecture (Final Production)
-- Add generated column for robust matching
ALTER TABLE public.guests
ADD COLUMN IF NOT EXISTS mobile_normalized text
GENERATED ALWAYS AS (
    regexp_replace(COALESCE(mobile,''), '[^0-9]', '', 'g')
) STORED;

-- Fast lookup index (used by import + check-in)
CREATE INDEX IF NOT EXISTS idx_guests_mobile_norm_lookup
ON public.guests (hotel_id, mobile_normalized);

-- Dedup-safe unique constraint (only when value exists)
-- This guarantees same phone cannot create duplicate guests even with different formatting
CREATE UNIQUE INDEX IF NOT EXISTS uq_guests_mobile_norm
ON public.guests (hotel_id, mobile_normalized)
WHERE mobile_normalized <> '';

-- SAFETY FIX: Clean up duplicate emails before creating index
DELETE FROM public.guests
WHERE id IN (
    SELECT id
    FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY hotel_id, email
                   ORDER BY updated_at DESC
               ) as rn
        FROM public.guests
        WHERE email IS NOT NULL
    ) t
    WHERE t.rn > 1
);

-- Drop legacy check constraint to allow raw mobile numbers (e.g. +91...)
ALTER TABLE public.guests
DROP CONSTRAINT IF EXISTS guests_mobile_normalized;

CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_email
ON public.guests(hotel_id, email)
WHERE email IS NOT NULL;

-- 1.5 Notification Queue Table
-- Stores async notifications (SMS/Email) to be processed by a separate worker.
CREATE TABLE IF NOT EXISTS public.notification_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID REFERENCES public.bookings(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK (channel IN ('sms', 'email', 'whatsapp')),
    template_code TEXT NOT NULL,
    payload JSONB DEFAULT '{}'::jsonb,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    sent_at TIMESTAMPTZ,
    retry_count INT DEFAULT 0,
    next_attempt_at TIMESTAMPTZ DEFAULT now()
);

-- Index for worker polling (Original)
CREATE INDEX IF NOT EXISTS idx_notification_queue_pending
ON public.notification_queue(status, id)
WHERE status = 'pending';

-- Hardening 2: Optimization for retry polling
CREATE INDEX IF NOT EXISTS idx_notification_queue_retry
ON public.notification_queue(status, next_attempt_at)
WHERE status='pending';

-- RLS Policies
ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'notification_queue' 
        AND policyname = 'Service role manages notifications'
    ) THEN
        CREATE POLICY "Service role manages notifications"
        ON public.notification_queue
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;
END $$;

-- 1.5.1 Notification Worker RPCs (CLAIM Pattern)
CREATE OR REPLACE FUNCTION public.claim_pending_notifications(p_limit INT DEFAULT 50)
RETURNS SETOF public.notification_queue
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH picked AS (
        SELECT id
        FROM public.notification_queue
        WHERE (
            status = 'pending' 
            AND next_attempt_at <= now()
        )
        OR (
            status = 'processing'
            AND retry_count < 10
            AND next_attempt_at <= now() - interval '5 minutes'
        )
        ORDER BY next_attempt_at, id
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.notification_queue q
    SET status = 'processing',
        next_attempt_at = now() + interval '5 minutes'
    FROM picked
    WHERE q.id = picked.id
    RETURNING q.*;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_pending_notifications TO service_role;

CREATE OR REPLACE FUNCTION public.mark_notification_sent(p_id uuid)
RETURNS void
LANGUAGE sql
AS $$
UPDATE public.notification_queue
SET
    status = 'sent',
    sent_at = now(),
    error_message = NULL
WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION public.mark_notification_sent TO service_role;

CREATE OR REPLACE FUNCTION public.mark_notification_failed(
    p_id uuid,
    p_error text
)
RETURNS void
LANGUAGE sql
AS $$
UPDATE public.notification_queue
SET
    status = CASE WHEN retry_count >= 10 THEN 'failed' ELSE 'pending' END,
    retry_count = retry_count + 1,
    next_attempt_at = now() + (interval '2 minutes' * (retry_count + 1)),
    error_message = p_error
WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION public.mark_notification_failed TO service_role;

CREATE OR REPLACE FUNCTION public.fetch_pending_notifications(p_limit INT DEFAULT 50)
RETURNS SETOF public.notification_queue
LANGUAGE sql
AS $$
    SELECT * FROM public.claim_pending_notifications(p_limit);
$$;

GRANT EXECUTE ON FUNCTION public.fetch_pending_notifications TO service_role;

CREATE INDEX IF NOT EXISTS idx_notification_queue_booking
ON public.notification_queue(booking_id);

CREATE INDEX IF NOT EXISTS idx_notification_queue_claim
ON public.notification_queue(status, next_attempt_at, id);


-- 1.5 notification_queue unique index
-- SAFETY FIX: Clean up duplicates before creating index
DELETE FROM public.notification_queue
WHERE id IN (
    SELECT id
    FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY booking_id, template_code
                   ORDER BY created_at DESC
               ) as rn
        FROM public.notification_queue
        WHERE template_code = 'precheckin_link'
    ) t
    WHERE t.rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_precheckin
ON public.notification_queue(booking_id, template_code)
WHERE template_code = 'precheckin_link';

-- 1.6 Performance Indexes (Lookup Optimization)
-- Speeds up hotel resolution during heavy imports
CREATE INDEX IF NOT EXISTS idx_hotels_slug
ON public.hotels(slug);

-- Speeds up room_type ID resolution during heavy imports
CREATE INDEX IF NOT EXISTS idx_room_types_hotel_name
ON public.room_types(hotel_id, name);

-- Speeds up room ID resolution during heavy imports
CREATE INDEX IF NOT EXISTS idx_rooms_hotel_number
ON public.rooms(hotel_id, number);

-- 1.7 Production Validation Indexes (Idempotency & Speed)
-- Ensure bookings.code is unique for ON CONFLICT to work reliably
-- SAFETY FIX: Clean up duplicates before creating index
DELETE FROM public.bookings
WHERE id IN (
    SELECT id
    FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY code
                   ORDER BY updated_at DESC
               ) as rn
        FROM public.bookings
    ) t
    WHERE t.rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_code
ON public.bookings(code);

-- Optimize token lookup for worker (find unused tokens fast)
CREATE INDEX IF NOT EXISTS idx_precheckin_tokens_booking_unused
ON public.precheckin_tokens(booking_id)
WHERE used_at IS NULL;

-- 1.8 Booking Identity (Golden Rule)
-- Adds true external identity support for PMS/OTA integration
ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS external_source text,
ADD COLUMN IF NOT EXISTS external_reservation_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_external_identity
ON public.bookings(hotel_id, external_source, external_reservation_id)
WHERE external_reservation_id IS NOT NULL;

-- 1.9 Fix Booking Guest Relationship (MANDATORY FIX-5)
-- The bookings.guest_id was pointing to auth.users, but now we use public.guests
ALTER TABLE public.bookings
DROP CONSTRAINT IF EXISTS bookings_guest_id_fkey;

-- We need to ensure existing IDs are valid or NULL
-- In a real migration, we might backfill public.guests from auth.users here.
-- For now, we assume this is a fresh setup or compatible.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'bookings_guest_id_fkey'
        AND table_name = 'bookings'
    ) THEN
        ALTER TABLE public.bookings
        DROP CONSTRAINT bookings_guest_id_fkey;
    END IF;
END $$;

ALTER TABLE public.bookings
ADD CONSTRAINT bookings_guest_id_fkey
FOREIGN KEY (guest_id)
REFERENCES public.guests(id)
ON DELETE SET NULL;

-- 1.9 Ingestion Guard Performance (MANDATORY FIX-4)
-- Speeds up the NOT EXISTS check in ingest_booking
CREATE INDEX IF NOT EXISTS idx_import_rows_booking_active
ON public.import_rows(booking_reference)
WHERE status IN ('pending','processing');

-- 1.10 Idempotency Envelope (Enterprise Crash-Safety)
CREATE TABLE IF NOT EXISTS public.import_idempotency (
    booking_reference text PRIMARY KEY,
    locked_at timestamptz DEFAULT now(),
    processed_at timestamptz,
    status text DEFAULT 'processing'
);

CREATE INDEX IF NOT EXISTS idx_import_idempotency_processing
ON public.import_idempotency(status)
WHERE status='processing';

CREATE INDEX IF NOT EXISTS idx_import_idempotency_locked
ON public.import_idempotency(locked_at)
WHERE status='processing';


-- ==============================================================================
-- 2. Worker RPC: Fetch Pending Rows (Concurrency Safe)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.fetch_pending_rows(p_limit INT DEFAULT 100)
RETURNS SETOF public.import_rows
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT r.*
    FROM public.import_rows r
    JOIN public.import_batches b ON b.id = r.batch_id
    WHERE r.status = 'pending'
    AND b.status = 'processing' -- Only process if batch is confirmed
    ORDER BY r.id
    LIMIT p_limit
    FOR UPDATE OF r SKIP LOCKED; -- Lock the ROW, not the batch join
$$;

GRANT EXECUTE ON FUNCTION public.fetch_pending_rows TO service_role;


-- ==============================================================================
-- 3. Worker RPC: Create Single Pre-checkin Token (STRICT UNIQUE)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.create_precheckin_token(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token TEXT;
    v_expires_at TIMESTAMPTZ;
    v_checkin_date DATE;
    v_hotel_id UUID;
BEGIN
    -- Get scheduled checkin date and hotel_id
    SELECT scheduled_checkin_at, hotel_id INTO v_checkin_date, v_hotel_id
    FROM public.bookings
    WHERE id = p_booking_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booking not found';
    END IF;

    -- Default expiry: 23:59:59 on check-in day
    v_expires_at := (v_checkin_date::timestamp + interval '1 day' - interval '1 second');
    
    -- Fallback if checkin date is missing or invalid logic: 30 days
    IF v_expires_at IS NULL THEN
        v_expires_at := now() + INTERVAL '30 days';
    END IF;

    -- Hardening 3: Refresh token on conflict
    -- Using ON CONSTRAINT for unambiguous target matching
    INSERT INTO public.precheckin_tokens (booking_id, hotel_id, token, expires_at)
    VALUES (
        p_booking_id,
        v_hotel_id,
        translate(gen_random_uuid()::text, '-', '') || translate(gen_random_uuid()::text, '-', ''),
        v_expires_at
    )
    ON CONFLICT ON CONSTRAINT uq_precheckin_booking
    DO UPDATE SET 
        token = EXCLUDED.token,
        hotel_id = EXCLUDED.hotel_id,
        expires_at = EXCLUDED.expires_at,
        updated_at = now()
    RETURNING token INTO v_token;

    RETURN jsonb_build_object(
        'booking_id', p_booking_id,
        'token', v_token,
        'expires_at', v_expires_at
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_precheckin_token TO service_role;


-- ==============================================================================
-- 2. NOTE: fetch_pending_booking_groups removed (superseded by claim)
-- ==============================================================================

-- ==============================================================================
-- 2.1 RPC: Claim Pending Booking Groups (Atomic Worker Pattern)
-- ==============================================================================
-- ==============================================================================
-- 2.1 RPC: Claim Pending Booking Groups (Atomic Worker Pattern - Optimized)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.claim_pending_booking_groups(p_limit INT DEFAULT 20)
RETURNS TABLE (booking_reference TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH picked AS (
        SELECT ir.booking_reference
        FROM public.import_rows ir
        WHERE ir.status = 'pending'
        ORDER BY ir.id
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    ),
    claimed AS (
        UPDATE public.import_rows r
        SET status = 'processing',
            processed_at = now()
        FROM picked p
        WHERE r.booking_reference = p.booking_reference
        RETURNING r.booking_reference
    )
    SELECT DISTINCT claimed.booking_reference
    FROM claimed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_pending_booking_groups TO service_role;


-- ==============================================================================
-- 2.1 RPC: Guest Identity Resolution (Canonical & Idempotent)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.resolve_guest_identity(
    p_hotel_id uuid,
    p_name text,
    p_mobile text,
    p_email text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_guest_id uuid;
    v_mobile text;
    v_email text;
BEGIN
    -- Normalize inputs (Enterprise Standard)
    v_mobile := NULLIF(regexp_replace(trim(p_mobile), '[^0-9]', '', 'g'), '');
    v_email  := NULLIF(lower(trim(p_email)), '');

    -- Safety Guard: Prevent short numbers (garbage data like '0' or '123')
    IF length(v_mobile) < 6 THEN
       v_mobile := NULL;
    END IF;

    ---------------------------------------------------------
    -- 1. Try match by mobile (highest priority - Normalized)
    ---------------------------------------------------------
    IF v_mobile IS NOT NULL THEN
        SELECT id
        INTO v_guest_id
        FROM public.guests
        WHERE hotel_id = p_hotel_id
        AND mobile_normalized = v_mobile -- v_mobile is already normalized in DECLARE block
        LIMIT 1;

        IF v_guest_id IS NOT NULL THEN
            RETURN v_guest_id;
        END IF;
    END IF;

    ---------------------------------------------------------
    -- 2. Try match by email (secondary priority)
    ---------------------------------------------------------
    IF v_email IS NOT NULL THEN
        SELECT id
        INTO v_guest_id
        FROM public.guests
        WHERE hotel_id = p_hotel_id
        AND email = v_email
        LIMIT 1;

        IF v_guest_id IS NOT NULL THEN
            RETURN v_guest_id;
        END IF;
    END IF;

    ---------------------------------------------------------
    -- 3. Create new guest (idempotent safe)
    ---------------------------------------------------------
    INSERT INTO public.guests(
        hotel_id,
        full_name,
        mobile,
        email,
        created_at,
        updated_at
    )
    VALUES(
        p_hotel_id,
        COALESCE(p_name,'Guest'),
        p_mobile, -- Insert RAW mobile (normalized col handles the rest)
        v_email,
        now(),
        now()
    )
    ON CONFLICT (hotel_id, mobile_normalized) WHERE mobile_normalized <> ''
    DO UPDATE SET
        updated_at = now()
    RETURNING id INTO v_guest_id;

    -- Fallback: If conflict didn't trigger (e.g. mobile was null/empty) but email exists
    IF v_guest_id IS NULL AND v_email IS NOT NULL THEN
        SELECT id INTO v_guest_id
        FROM public.guests
        WHERE hotel_id = p_hotel_id
        AND email = v_email
        LIMIT 1;
    END IF;

    RETURN v_guest_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_guest_identity TO service_role;


-- ==============================================================================
-- 3. RPC: Process Booking Group (Transactional & Logic Fixes + Guard Check)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.process_booking_group(
    p_booking_reference TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_booking_id UUID;
    v_hotel_id UUID;
    v_primary_guest_id UUID;
    v_token TEXT;
    v_slug_hotel_id UUID;
    
    -- Variables from CTE
    v_guest_name TEXT;
    v_phone TEXT;
    v_email TEXT;
    v_checkin_date DATE;
    v_checkout_date DATE;
    v_adults_total INT;
    v_children_total INT;
    v_rooms_total INT;
    v_booking_status TEXT;
    v_row_data JSONB;
BEGIN
    -- CRITICAL FIX: Normalize booking reference early (prevent phantom duplicates)
    p_booking_reference := trim(p_booking_reference);

    -- SAFETY FIX: Prevent empty booking reference
    IF p_booking_reference IS NULL OR p_booking_reference = '' THEN
       RAISE EXCEPTION 'booking_reference missing';
    END IF;

    -- =========================================================
    -- IDEMPOTENCY GUARD (enterprise crash-safe)
    -- =========================================================
    BEGIN
        INSERT INTO public.import_idempotency(booking_reference,status)
        VALUES (p_booking_reference,'processing');
    EXCEPTION WHEN unique_violation THEN
        -- Allow retry if previous attempt stuck
        IF EXISTS (
            SELECT 1
            FROM public.import_idempotency
            WHERE booking_reference = p_booking_reference
            AND status = 'processing'
            AND locked_at < now() - interval '20 minutes'
        ) THEN
            UPDATE public.import_idempotency
            SET locked_at = now(),
                status = 'processing'
            WHERE booking_reference = p_booking_reference;
        ELSE
            -- Still mark rows as imported so batch counters update and UI completes
            UPDATE public.import_rows
            SET status = 'imported',
                processed_at = now()
            WHERE booking_reference = p_booking_reference
              AND status = 'processing';

            RETURN jsonb_build_object(
                'success', true,
                'message', 'Already processed (idempotent skip)'
            );
        END IF;
    END;

    ----------------------------------------------------------------
    -- 0. Optimization: Materialized CTE for Booking Rows
    ----------------------------------------------------------------
    -- Using a temporary table concept via CTE to avoid repeated scans
    WITH booking_rows AS (
        SELECT *
        FROM public.import_rows
        WHERE booking_reference = p_booking_reference
    ),
    agg AS (
        SELECT
            MIN((row_data->>'checkin_date')::date) AS checkin_date,
            MAX((row_data->>'checkout_date')::date) AS checkout_date,
            SUM(COALESCE((row_data->>'adults')::int, 1)) AS adults_total,
            SUM(COALESCE((row_data->>'children')::int, 0)) AS children_total,
            COUNT(DISTINCT COALESCE((row_data->>'room_seq')::int, 1)) AS rooms_total,
            MAX(row_data->>'booking_status') AS booking_status,
            -- Get primary row data for guest info
            (ARRAY_AGG(row_data ORDER BY primary_guest_flag DESC, id ASC))[1] as primary_data,
            (ARRAY_AGG(hotel_id ORDER BY primary_guest_flag DESC, id ASC))[1] as primary_hotel_id
        FROM booking_rows
    )
    SELECT 
        checkin_date, 
        checkout_date, 
        adults_total, 
        children_total, 
        rooms_total,
        booking_status,
        primary_data,
        primary_hotel_id
    INTO 
        v_checkin_date, 
        v_checkout_date, 
        v_adults_total, 
        v_children_total, 
        v_rooms_total,
        v_booking_status,
        v_row_data,
        v_hotel_id -- Initial hotel_id from row
    FROM agg;

    IF v_row_data IS NULL THEN
         RETURN jsonb_build_object('success', false, 'error', 'No rows found');
    END IF;

    -- SAFETY FIX: Enforce hotel_slug presence logic (same as before but using CTE data)
    IF (v_row_data->>'hotel_slug') IS NULL OR (v_row_data->>'hotel_slug') = '' THEN
       RAISE EXCEPTION 'hotel_slug missing in import row';
    END IF;

    -- CRITICAL FIX: Deterministic Hotel Lookup
    -- We can resolve hotel_id once here.
    -- CRITICAL FIX: Deterministic Hotel Lookup
    -- We can resolve hotel_id once here.
    SELECT id INTO v_slug_hotel_id FROM public.hotels WHERE slug = (v_row_data->>'hotel_slug');
    IF v_slug_hotel_id IS NOT NULL THEN
        v_hotel_id := v_slug_hotel_id;
    END IF;

    -- CRITICAL FIX: Guard against missing hotel
    IF v_hotel_id IS NULL THEN
       RAISE EXCEPTION 'Invalid hotel_slug in import';
    END IF;
    
    v_guest_name := v_row_data->>'guest_name';
    -- CRITICAL FIX-4: Normalize phone number (Enterprise Safe)
    v_phone := NULLIF(regexp_replace(trim(COALESCE(v_row_data->>'guest_phone', v_row_data->>'phone', '')), '[^0-9]', '', 'g'), '');
    v_email := NULLIF(trim(COALESCE(v_row_data->>'guest_email', v_row_data->>'email')), '');

    ----------------------------------------------------------------
    -- 2. Resovle / Create Primary Guest (Canonical Resolver)
    ----------------------------------------------------------------
    -- Uses the shared identity logic to find or create the guest idempotently.
    
    SELECT public.resolve_guest_identity(
        v_hotel_id,
        v_guest_name,
        v_phone,
        v_email
    )
    INTO v_primary_guest_id;

    ----------------------------------------------------------------
    -- 3. Create / Upsert Booking (Race Condition Guard)
    ----------------------------------------------------------------
    
    -- SAFETY GUARD: Lock booking reference deterministically
    PERFORM 1
    FROM public.bookings
    WHERE code = p_booking_reference
    FOR UPDATE;

    INSERT INTO public.bookings (
        code,
        hotel_id,
        guest_id,
        guest_name,
        phone,
        email,
        status,
        scheduled_checkin_at,
        scheduled_checkout_at,
        adults_total,
        children_total,
        rooms_total,
        source, 
        created_at,
        updated_at
    )
    VALUES (
        p_booking_reference,
        v_hotel_id,
        v_primary_guest_id,
        v_guest_name,
        v_phone,
        v_email,
        COALESCE(v_booking_status, 'CONFIRMED'),
        v_checkin_date,
        v_checkout_date,
        v_adults_total,
        v_children_total,
        v_rooms_total,
        'pms_sync',
        now(),
        now()
    )
    ON CONFLICT (code)
    DO UPDATE SET
        guest_id = COALESCE(EXCLUDED.guest_id, bookings.guest_id),
        guest_name = EXCLUDED.guest_name,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        status = EXCLUDED.status,
        scheduled_checkin_at = EXCLUDED.scheduled_checkin_at,
        scheduled_checkout_at = EXCLUDED.scheduled_checkout_at,
        adults_total = EXCLUDED.adults_total,
        children_total = EXCLUDED.children_total,
        rooms_total = EXCLUDED.rooms_total,
        updated_at = now()
    RETURNING id INTO v_booking_id;

    ----------------------------------------------------------------
    -- 4. Insert booking_rooms (Optimized & Deduped)
    ----------------------------------------------------------------
    -- Re-using source table pattern for clarity in DISTINCT ON logic, 
    -- as we must handle multiple rate plans/room types per booking group correctly.
    
    WITH resolved_rooms AS (
        SELECT
            ir.id AS row_id,
            v_booking_id AS booking_id,
            v_hotel_id AS hotel_id,
            COALESCE(
                (ir.row_data->>'room_type_id')::uuid,
                (SELECT id FROM public.room_types WHERE hotel_id = v_hotel_id AND (name = (ir.row_data->>'room_type') OR name = (ir.row_data->>'room_type_name') OR name = (ir.row_data->>'room_type_code') ) LIMIT 1)
            ) AS room_type_id,
             COALESCE(
                (ir.row_data->>'room_id')::uuid,
                 (SELECT id FROM public.rooms WHERE hotel_id = v_hotel_id AND number = (ir.row_data->>'room_number') LIMIT 1)
            ) AS room_id,
            -- CRITICAL FIX-1: Explicit table alias & dense_rank for uniqueness if missing
            COALESCE(ir.room_seq, (dense_rank() OVER (ORDER BY ir.room_seq NULLS LAST, ir.id))::int) AS effective_room_seq,
            
            COALESCE((ir.row_data->>'adults')::int, 1) AS adults,
            COALESCE((ir.row_data->>'children')::int, 0) AS children,
            ir.row_data->>'rate_plan' AS rate_plan_code,
            (ir.row_data->>'total_amount')::numeric AS amount_total
        FROM public.import_rows ir
        WHERE ir.booking_reference = p_booking_reference
    )
    INSERT INTO public.booking_rooms (
        booking_id,
        hotel_id,
        room_type_id,
        room_id,
        room_seq,
        adults,
        children,
        rate_plan_code,
        amount_total
    )
    SELECT DISTINCT ON (effective_room_seq)
        booking_id,
        hotel_id,
        room_type_id,
        room_id,
        effective_room_seq,
        adults,
        children,
        rate_plan_code,
        amount_total
    FROM resolved_rooms
    ORDER BY effective_room_seq, row_id -- stable sort for distinct
    ON CONFLICT (booking_id, room_seq)
    DO UPDATE SET
        adults = EXCLUDED.adults,
        children = EXCLUDED.children,
        amount_total = EXCLUDED.amount_total,
        updated_at = now();

    -- MANDATORY SYNC: Update rooms_total from actual room count
    UPDATE public.bookings
    SET rooms_total = (
        SELECT COUNT(*)
        FROM public.booking_rooms br
        WHERE br.booking_id = v_booking_id
    )
    WHERE id = v_booking_id;

    ----------------------------------------------------------------
    -- 5. Helper: Generate/Fetch precheckin token
    ----------------------------------------------------------------
    SELECT token
    INTO v_token
    FROM public.precheckin_tokens
    WHERE booking_id = v_booking_id
    AND used_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_token IS NULL THEN
        SELECT (public.create_precheckin_token(v_booking_id)->>'token') INTO v_token;
    END IF;

    ----------------------------------------------------------------
    -- 6. Notification Queue
    ----------------------------------------------------------------
    IF v_token IS NOT NULL AND (v_phone IS NOT NULL OR v_email IS NOT NULL) THEN
        INSERT INTO public.notification_queue (
            booking_id,
            channel,
            template_code,
            payload,
            status
        )
        VALUES (
            v_booking_id,
            CASE WHEN v_phone IS NOT NULL THEN 'whatsapp' ELSE 'email' END,
            'precheckin_link',
            jsonb_build_object(
                'token', v_token,
                'guest_name', v_guest_name,
                'link', 'https://vaiyu.co.in/precheckin/' || v_token
            ),
            'pending'
        )
        ON CONFLICT (booking_id, template_code) WHERE template_code = 'precheckin_link' DO NOTHING;
    END IF;

    ----------------------------------------------------------------
    -- 7. Completeness Guard (Partial Import Safety)
    ----------------------------------------------------------------
    
    -- Validate room completeness
    IF (
        SELECT COUNT(DISTINCT COALESCE(ir.room_seq::text, ir.id::text))
        FROM public.import_rows ir
        WHERE ir.booking_reference = p_booking_reference
    ) <>
    (
        SELECT COUNT(DISTINCT COALESCE(br.room_seq::text, br.id::text))
        FROM public.booking_rooms br
        WHERE br.booking_id = v_booking_id
    )
    THEN
        RAISE EXCEPTION 'Room ingestion incomplete, retry required';
    END IF;

    ----------------------------------------------------------------
    -- 8. Mark rows imported
    ----------------------------------------------------------------
    UPDATE public.import_rows
    SET status = 'imported',
        processed_at = now()
    WHERE booking_reference = p_booking_reference;

    -- Mark Idempotency Complete
    UPDATE public.import_idempotency
    SET status='completed',
        processed_at = now()
    WHERE booking_reference = p_booking_reference;

    RETURN jsonb_build_object(
        'success', true,
        'booking_id', v_booking_id,
        'token', v_token
    );

EXCEPTION WHEN OTHERS THEN
    UPDATE public.import_rows
    SET status = 'error',
        error_message = SQLERRM,
        processed_at = now()
    WHERE booking_reference = p_booking_reference;
    
    RETURN jsonb_build_object(
        'success', false,
        'booking_reference', p_booking_reference,
        'error', SQLERRM
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_booking_group TO service_role;

-- ==============================================================================
-- 4. Watchdog: Reset Stuck Rows (MANDATORY FIX-3: Crash Safety + Improved)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.reset_stuck_import_rows()
RETURNS void
LANGUAGE sql
AS $$
UPDATE public.import_rows
SET status = 'pending'
WHERE status = 'processing'
AND (
      processed_at IS NULL
      OR processed_at < now() - interval '15 minutes'
    );
$$;

GRANT EXECUTE ON FUNCTION public.reset_stuck_import_rows TO service_role;

-- ==============================================================================
-- 5. Unified Ingestion Wrapper (Enterprise Architecture)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.ingest_booking(
    p_payload jsonb,
    p_source text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_booking_reference text;
BEGIN
    v_booking_reference := trim(p_payload->>'booking_reference');

    IF v_booking_reference IS NULL OR v_booking_reference = '' THEN
       RAISE EXCEPTION 'booking_reference missing in payload';
    END IF;

    INSERT INTO public.import_rows(
        booking_reference,
        row_data,
        status,
        source
    )
    SELECT
        v_booking_reference,
        p_payload,
        'pending',
        p_source
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.import_rows
        WHERE booking_reference = v_booking_reference
        AND status IN ('pending', 'processing')
    );

    -- Workers process via cron — do not process inline to avoid transaction locks during bulk uploads
    RETURN jsonb_build_object(
        'success', true,
        'booking_reference', v_booking_reference
    );
END;
$$;

-- ==============================================================================
-- 6. Batch Statistics Triggers (Correction: Missing in previous version)
-- ==============================================================================

-- Robustness 3: Automatic batch progress update
CREATE OR REPLACE FUNCTION public.update_batch_counters()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_total INT;
    v_imported INT;
    v_errors INT;
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN

        SELECT
            COUNT(*) FILTER (WHERE r.status IN ('imported','notified')),
            COUNT(*) FILTER (WHERE r.status = 'error')
        INTO v_imported, v_errors
        FROM public.import_rows r
        WHERE r.batch_id = NEW.batch_id;

        SELECT COALESCE(b.total_rows,0)
        INTO v_total
        FROM public.import_batches b
        WHERE b.id = NEW.batch_id;

        UPDATE public.import_batches
        SET
            imported_rows = v_imported,
            error_rows = v_errors,
            status = CASE
                WHEN (v_imported + v_errors) >= v_total AND v_errors = (v_imported + v_errors)
                    THEN 'failed'
                WHEN (v_imported + v_errors) >= v_total
                    THEN 'completed'
                ELSE status
            END,
            completed_at = CASE
                WHEN (v_imported + v_errors) >= v_total
                     AND completed_at IS NULL
                THEN now()
                ELSE completed_at
            END
        WHERE id = NEW.batch_id;

    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_batch_counters ON public.import_rows;
CREATE TRIGGER trg_update_batch_counters
AFTER UPDATE OF status ON public.import_rows
FOR EACH ROW
EXECUTE FUNCTION public.update_batch_counters();

-- ==============================================================================
-- 7. Guest Auth Auto-Linking (Production Identity)
-- ==============================================================================

-- 7.1 Mapping Table (Auth ID <-> Guest ID)
CREATE TABLE IF NOT EXISTS public.guest_user_map (
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    guest_id uuid NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
    hotel_id uuid NOT NULL, -- Multi-tenant safety
    created_at timestamptz DEFAULT now(),
    CONSTRAINT guest_user_map_pkey PRIMARY KEY (user_id,hotel_id)
);

-- Index for fast guest lookup
CREATE INDEX IF NOT EXISTS idx_guest_user_map_guest
ON public.guest_user_map(guest_id);

-- Index for multi-tenant safety
CREATE INDEX IF NOT EXISTS idx_guest_user_map_hotel
ON public.guest_user_map(hotel_id, guest_id);

-- 7.2 Auto-link Function
CREATE OR REPLACE FUNCTION public.link_auth_user_to_guest()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_guest_record public.guests%ROWTYPE;
    v_phone text;
    v_email text;
BEGIN
    -- Normalize phone using same logic as generated column
    v_phone := regexp_replace(COALESCE(new.phone, ''), '[^0-9]', '', 'g');
    v_email := lower(trim(COALESCE(new.email, '')));

    -- 1. Try match by mobile (Normalized)
    IF v_phone <> '' THEN
        SELECT *
        INTO v_guest_record
        FROM public.guests
        WHERE mobile_normalized = v_phone
        ORDER BY created_at ASC -- Oldest guest record wins (Stable Identity)
        LIMIT 1; 
    END IF;

    -- 2. Fallback match by email
    IF v_guest_record IS NULL AND v_email <> '' THEN
        SELECT *
        INTO v_guest_record
        FROM public.guests
        WHERE email = v_email
        ORDER BY created_at ASC
        LIMIT 1;
    END IF;

    -- 3. If still not found, create minimal guest profile
    -- NOTE: Skipped for now because hotel_id is NOT NULL in current schema.
    -- To enable global guest creation, we need to nullable hotel_id or specific logic.
    /*
    IF v_guest_record IS NULL THEN
        -- ... logic to create guest ...
    END IF;
    */

    -- 4. Create mapping if guest found
    IF v_guest_record IS NOT NULL THEN
        INSERT INTO public.guest_user_map(user_id, guest_id, hotel_id)
        VALUES(new.id, v_guest_record.id, v_guest_record.hotel_id)
        ON CONFLICT (user_id) DO NOTHING;
    END IF;

    RETURN new;
END;
$$;

-- 7.3 Trigger on auth.users
-- Safe drop/create pattern
DROP TRIGGER IF EXISTS trg_link_auth_user_guest ON auth.users;

CREATE TRIGGER trg_link_auth_user_guest
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.link_auth_user_to_guest();


-- ==============================================================================
-- 4. Migration: Update Import Batches Status Constraint
-- ==============================================================================
ALTER TABLE public.import_batches
DROP CONSTRAINT IF EXISTS import_batches_status_check;

ALTER TABLE public.import_batches
ADD CONSTRAINT import_batches_status_check
CHECK (status IN ('uploaded', 'processing', 'completed', 'failed'));


-- ==============================================================================
-- 5. Runtime Cron Schedules (Stay Management Workers)
-- ==============================================================================
DO $$ 
DECLARE
    v_project_url TEXT := 'https://vsqiuwbmawygkxxjrxnt.supabase.co';
BEGIN
    -- Cleanup: Unschedule any previous variants of these jobs
    PERFORM cron.unschedule(jobname) FROM cron.job 
    WHERE jobname IN (
        'import-watchdog', 
        'process-import-rows-job', 
        'send-notifications-job', 
        'generate-reminders-job'
    );

    -- B. Schedule: Import Watchdog (Every 10 mins)
    PERFORM cron.schedule(
        'import-watchdog',
        '*/10 * * * *',
        $CMD$ SELECT public.reset_stuck_import_rows(); $CMD$
    );

    -- C. Schedule: Ingestion Worker (Every 1 min)
    PERFORM cron.schedule(
        'process-import-rows-job',
        '* * * * *',
        format($CMD$
        SELECT net.http_post(
            url := '%s/functions/v1/process-import-rows',
            headers := jsonb_build_object(
                'Content-Type','application/json'
            ),
            body := '{}'::jsonb
        );
        $CMD$, v_project_url)
    );

    -- D. Schedule: Notification Worker (Every 1 min)
    PERFORM cron.schedule(
        'send-notifications-job',
        '* * * * *',
        format($CMD$
        SELECT net.http_post(
            url := '%s/functions/v1/send-notifications',
            headers := jsonb_build_object(
                'Content-Type','application/json'
            ),
            body := '{}'::jsonb
        );
        $CMD$, v_project_url)
    );

    -- E. Schedule: Reminder Generator (Every 30 mins)
    PERFORM cron.schedule(
        'generate-reminders-job',
        '*/30 * * * *',
        format($CMD$
        SELECT net.http_post(
            url := '%s/functions/v1/generate-reminders',
            headers := jsonb_build_object(
                'Content-Type','application/json'
            ),
            body := '{}'::jsonb
        );
        $CMD$, v_project_url)
    );
END $$;


-- 1.7 Production Validation Indexes (Final)
CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_code ON public.bookings(code);
CREATE INDEX IF NOT EXISTS idx_precheckin_tokens_booking ON public.precheckin_tokens(booking_id);


-- ==============================================================================
-- 8. Delta-Sync Infrastructure (Enterprise PMS Integration)
-- ==============================================================================

-- 8.1 PMS Sync Watermark Table
-- Stores the last successful sync timestamp per hotel per source.
-- Used by delta-fetch workers to only pull changed bookings.
CREATE TABLE IF NOT EXISTS public.pms_sync_state (
    hotel_id UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    last_synced_at TIMESTAMPTZ,
    PRIMARY KEY (hotel_id, source)
);

-- 8.2 Business Identity Unique Index
-- Uses real business keys (not file position) for idempotent ingestion.
-- Supports: multi-room bookings, PMS re-exports, delta replays, retry safety.
DROP INDEX IF EXISTS uq_import_rows_ref_source;

CREATE UNIQUE INDEX IF NOT EXISTS uq_import_rows_identity
ON public.import_rows(booking_reference, room_seq, guest_seq, source);

-- 8.3 Supporting lookup index for fast group processing at scale
CREATE INDEX IF NOT EXISTS idx_import_rows_identity_lookup
ON public.import_rows(booking_reference, status);

