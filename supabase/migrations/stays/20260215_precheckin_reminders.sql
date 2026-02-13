-- Migration: Pre-checkin Reminders
-- Purpose: Add tracking columns and generation logic for T-1 and Arrival Morning reminders.

-- 1. Add tracking columns to Bookings
ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS precheckin_reminder1_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS precheckin_reminder2_sent_at TIMESTAMPTZ;

-- 2. Create Reminder Generator RPC
CREATE OR REPLACE FUNCTION public.generate_precheckin_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

    ------------------------------------------------------------------
    -- T-1 DAY REMINDER (Safe Atomic Update with Multi-Channel)
    ------------------------------------------------------------------
    WITH targets_1 AS (
        SELECT b.id, b.phone, b.email, t.token
        FROM public.bookings b
        JOIN public.hotels h ON h.id = b.hotel_id
        LEFT JOIN public.precheckin_tokens t ON t.booking_id = b.id
        WHERE b.status IN ('CREATED','CONFIRMED')
          AND b.precheckin_reminder1_sent_at IS NULL
          AND (b.scheduled_checkin_at AT TIME ZONE h.timezone)::date =
              ((now() AT TIME ZONE h.timezone)::date + 1)
          AND b.status NOT IN ('CHECKED_IN', 'CANCELLED', 'NO_SHOW', 'COMPLETED')
          AND NOT EXISTS (
              SELECT 1 FROM public.stays s WHERE s.booking_id = b.id
          )
          -- Filter: Must have at least one valid channel
          AND ( (b.phone IS NOT NULL AND b.phone <> '') OR (b.email IS NOT NULL AND b.email <> '') )
        FOR UPDATE
    ),
    channels_1 AS (
        SELECT id, 'whatsapp' as channel, token
        FROM targets_1 WHERE phone IS NOT NULL AND phone <> ''
        UNION ALL
        SELECT id, 'email' as channel, token
        FROM targets_1 WHERE email IS NOT NULL AND email <> ''
    ),
    inserted_1 AS (
        INSERT INTO public.notification_queue (
            booking_id, channel, template_code, payload, status
        )
        SELECT 
            id, channel, 'precheckin_reminder_1', 
            jsonb_build_object('booking_id', id, 'token', token), 'pending'
        FROM channels_1
        RETURNING booking_id -- Returns one row per inserted notification
    )
    UPDATE public.bookings b
    SET precheckin_reminder1_sent_at = now()
    WHERE b.id IN (SELECT DISTINCT booking_id FROM inserted_1);

    ------------------------------------------------------------------
    -- ARRIVAL MORNING REMINDER (Safe Atomic Update with Multi-Channel)
    ------------------------------------------------------------------
    WITH targets_2 AS (
        SELECT b.id, b.phone, b.email, t.token
        FROM public.bookings b
        JOIN public.hotels h ON h.id = b.hotel_id
        LEFT JOIN public.precheckin_tokens t ON t.booking_id = b.id
        WHERE b.status IN ('CREATED','CONFIRMED')
          AND b.precheckin_reminder2_sent_at IS NULL
          AND (b.scheduled_checkin_at AT TIME ZONE h.timezone)::date =
              (now() AT TIME ZONE h.timezone)::date
          AND (now() AT TIME ZONE h.timezone)::time >= time '06:00'
          AND b.status NOT IN ('CHECKED_IN', 'CANCELLED', 'NO_SHOW', 'COMPLETED')
          AND NOT EXISTS (
              SELECT 1 FROM public.stays s WHERE s.booking_id = b.id
          )
          -- Filter: Must have at least one valid channel
          AND ( (b.phone IS NOT NULL AND b.phone <> '') OR (b.email IS NOT NULL AND b.email <> '') )
        FOR UPDATE
    ),
    channels_2 AS (
        SELECT id, 'whatsapp' as channel, token
        FROM targets_2 WHERE phone IS NOT NULL AND phone <> ''
        UNION ALL
        SELECT id, 'email' as channel, token
        FROM targets_2 WHERE email IS NOT NULL AND email <> ''
    ),
    inserted_2 AS (
        INSERT INTO public.notification_queue (
            booking_id, channel, template_code, payload, status
        )
        SELECT 
            id, channel, 'precheckin_reminder_2', 
            jsonb_build_object('booking_id', id, 'token', token), 'pending'
        FROM channels_2
        RETURNING booking_id
    )
    UPDATE public.bookings b
    SET precheckin_reminder2_sent_at = now()
    WHERE b.id IN (SELECT DISTINCT booking_id FROM inserted_2);

END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_precheckin_reminders TO service_role;

-- 3. Hardening: Duplicate Protection Index (Safety)
-- Now includes channel to allow both WA and Email for same reminder
DROP INDEX IF EXISTS uq_notification_precheckin_reminders;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_precheckin_reminders
ON public.notification_queue(booking_id, template_code, channel)
WHERE template_code IN ('precheckin_reminder_1','precheckin_reminder_2');

-- 4. Optimization: Faster Reminder Scanning (Performance)
CREATE INDEX IF NOT EXISTS idx_bookings_reminder1_pending
ON public.bookings(hotel_id, scheduled_checkin_at)
WHERE precheckin_reminder1_sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_reminder2_pending
ON public.bookings(hotel_id, scheduled_checkin_at)
WHERE precheckin_reminder2_sent_at IS NULL;
