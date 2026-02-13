-- Migration: Production Import Runtime
-- Purpose: Support scalable, concurrent CSV ingestion via Edge Functions & Workers.

-- 1. Notification Queue Table
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
    next_attempt_at TIMESTAMPTZ DEFAULT now() -- Hardening 1: For exponential backoff
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

-- Only service role should manage this queue usually, but we allow authenticated logic if needed.
CREATE POLICY "Service role manages notifications"
ON public.notification_queue
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);


-- Hardening 4: Notification Worker RPC with Recovery
-- Fetches pending items OR items stuck in 'processing' for > 5 mins.
CREATE OR REPLACE FUNCTION public.fetch_pending_notifications(p_limit INT DEFAULT 50)
RETURNS SETOF public.notification_queue
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT *
    FROM public.notification_queue
    WHERE (
        status = 'pending'
        AND next_attempt_at <= now()
    )
    OR (
        status = 'processing'
        AND next_attempt_at <= now() - interval '5 minutes'
    )
    ORDER BY next_attempt_at ASC, id ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_pending_notifications TO service_role;


-- 2. Worker RPC: Fetch Pending Rows (Concurrency Safe)
-- Uses FOR UPDATE SKIP LOCKED to allow multiple workers to fetch unique rows without collision.
-- Only picks rows where the parent batch is 'processing' (confirmed).
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


-- 3. Worker RPC: Create Single Pre-checkin Token
-- Encapsulates token generation logic for a single booking (Worker usage).
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
BEGIN
    -- Get scheduled checkin date to set expiry (e.g., 23:00 on check-in day)
    SELECT scheduled_checkin_at INTO v_checkin_date
    FROM public.bookings
    WHERE id = p_booking_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booking not found';
    END IF;

    -- Default expiry: Check-in date at 23:59 or 7 days from now if check-in is far/past?
    v_expires_at := (v_checkin_date::timestamp + INTERVAL '23 hours');
    
    -- Fallback if checkin date is missing or invalid logic: 30 days
    IF v_expires_at IS NULL THEN
        v_expires_at := now() + INTERVAL '30 days';
    END IF;

    -- Hardening 3: Refresh token on conflict
    INSERT INTO public.precheckin_tokens (booking_id, token, expires_at)
    VALUES (
        p_booking_id,
        encode(gen_random_bytes(32), 'hex'),
        v_expires_at
    )
    ON CONFLICT (booking_id) 
    DO UPDATE SET 
        token = EXCLUDED.token,
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

-- Hardening 5: Ensure precheckin_tokens uniqueness
-- Replaces standard index with UNIQUE index to support concurrent upserts
DROP INDEX IF EXISTS idx_precheckin_tokens_booking;
CREATE UNIQUE INDEX IF NOT EXISTS idx_precheckin_tokens_booking
ON public.precheckin_tokens(booking_id);

-- Migration: Update Import Batches Status Constraint
-- Ensure 'uploaded' is a valid state for preview support.
ALTER TABLE public.import_batches
DROP CONSTRAINT IF EXISTS import_batches_status_check;

ALTER TABLE public.import_batches
ADD CONSTRAINT import_batches_status_check
CHECK (status IN ('uploaded', 'processing', 'completed', 'failed'));
