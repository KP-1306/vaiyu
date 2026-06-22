-- ============================================================================
-- Fix generate_precheckin_reminders(): FOR UPDATE on the nullable side of a join
-- ============================================================================
-- Both CTEs LEFT JOIN precheckin_tokens (nullable) then apply a bare FOR UPDATE,
-- which locks EVERY table in the FROM — including the nullable LEFT JOIN side.
-- Postgres rejects this at execution: "FOR UPDATE cannot be applied to the
-- nullable side of an outer join", so the RPC has failed 100% of the time and the
-- T-1-day + arrival-morning precheckin reminders were NEVER generated (discovered
-- via va_admin_http_failures: generate-reminders returned HTTP 400 every */30 run
-- while its cron showed 'succeeded'). The intent is only to lock the booking rows
-- being updated, so scope the lock with FOR UPDATE OF b. Definition is otherwise
-- identical to the deployed version.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.generate_precheckin_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
          AND ( (b.phone IS NOT NULL AND b.phone <> '') OR (b.email IS NOT NULL AND b.email <> '') )
        FOR UPDATE OF b
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
        RETURNING booking_id
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
          AND ( (b.phone IS NOT NULL AND b.phone <> '') OR (b.email IS NOT NULL AND b.email <> '') )
        FOR UPDATE OF b
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
$function$;
