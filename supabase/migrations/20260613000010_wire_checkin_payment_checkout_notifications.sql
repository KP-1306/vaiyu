-- Wire the 3 remaining guest WhatsApp notifications: checkin_welcome,
-- payment_receipt (event-driven triggers) and checkout_reminder (scheduled
-- generator + cron). Completes the enqueue side of the WhatsApp catalog so that
-- once the Interakt templates are approved, every lifecycle moment fires with
-- zero further code.
--
-- All three: gated on the hotel having WhatsApp enabled + a reachable booking
-- phone, fully guarded so a notification problem can never roll back the
-- underlying checkin/payment, and enqueue the same notification_queue rows the
-- send-notifications worker already drains. Rows stay 'pending' (deferred) until
-- the matching template is approved — no premature/failed sends.

-- ─── 1. checkin_welcome — trigger on stays going in-house ────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_checkin_welcome()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_phone     text;
  v_name      text;
  v_enabled   boolean;
  v_provider  text;
  v_hotel     text;
  v_room      text;
BEGIN
  -- Only the in-house transition (WHEN clause already requires NEW.status =
  -- 'inhouse'); skip an UPDATE where it was already in-house (no transition).
  IF TG_OP = 'UPDATE' AND OLD.status = 'inhouse' THEN
    RETURN NEW;
  END IF;

  BEGIN
    IF NEW.booking_id IS NULL THEN RETURN NEW; END IF;

    SELECT b.phone, b.guest_name INTO v_phone, v_name
      FROM public.bookings b WHERE b.id = NEW.booking_id;
    IF COALESCE(btrim(v_phone), '') = '' THEN RETURN NEW; END IF;

    SELECT whatsapp_enabled, whatsapp_provider, name
      INTO v_enabled, v_provider, v_hotel
      FROM public.hotels WHERE id = NEW.hotel_id;
    IF NOT COALESCE(v_enabled, false) THEN RETURN NEW; END IF;

    SELECT number INTO v_room FROM public.rooms WHERE id = NEW.room_id;

    INSERT INTO public.notification_queue (
      booking_id, hotel_id, channel, provider, template_code, payload, status, next_attempt_at
    ) VALUES (
      NEW.booking_id, NEW.hotel_id, 'whatsapp', COALESCE(v_provider, 'INTERAKT'),
      'checkin_welcome',
      jsonb_build_object('phone', v_phone, 'guest_name', v_name,
                         'hotel_name', v_hotel, 'location', v_room),
      'pending', now()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_checkin_welcome failed for stay %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_checkin_welcome ON public.stays;
CREATE TRIGGER trg_enqueue_checkin_welcome
  AFTER INSERT OR UPDATE ON public.stays
  FOR EACH ROW
  WHEN (NEW.status = 'inhouse')
  EXECUTE FUNCTION public.enqueue_checkin_welcome();

-- ─── 2. payment_receipt — trigger on a completed incoming payment ────────────
CREATE OR REPLACE FUNCTION public.enqueue_payment_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_phone    text;
  v_name     text;
  v_enabled  boolean;
  v_provider text;
  v_hotel    text;
BEGIN
  -- Only positive, completed payments (not refunds/adjustments).
  IF NEW.status <> 'COMPLETED' OR COALESCE(NEW.amount, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  BEGIN
    IF NEW.booking_id IS NULL THEN RETURN NEW; END IF;

    SELECT b.phone, b.guest_name INTO v_phone, v_name
      FROM public.bookings b WHERE b.id = NEW.booking_id;
    IF COALESCE(btrim(v_phone), '') = '' THEN RETURN NEW; END IF;

    SELECT whatsapp_enabled, whatsapp_provider, name
      INTO v_enabled, v_provider, v_hotel
      FROM public.hotels WHERE id = NEW.hotel_id;
    IF NOT COALESCE(v_enabled, false) THEN RETURN NEW; END IF;

    INSERT INTO public.notification_queue (
      booking_id, hotel_id, channel, provider, template_code, payload, status, next_attempt_at
    ) VALUES (
      NEW.booking_id, NEW.hotel_id, 'whatsapp', COALESCE(v_provider, 'INTERAKT'),
      'payment_receipt',
      jsonb_build_object('phone', v_phone, 'guest_name', v_name, 'hotel_name', v_hotel,
                         'amount', NEW.amount, 'currency', COALESCE(NEW.currency, 'INR'),
                         'method', NEW.method),
      'pending', now()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_payment_receipt failed for payment %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_payment_receipt ON public.payments;
CREATE TRIGGER trg_enqueue_payment_receipt
  AFTER INSERT ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_payment_receipt();

-- ─── 3. checkout_reminder — scheduled generator + per-stay sent flag + cron ───
ALTER TABLE public.stays
  ADD COLUMN IF NOT EXISTS checkout_reminder_sent_at timestamptz;

COMMENT ON COLUMN public.stays.checkout_reminder_sent_at IS
  'Set by generate_checkout_reminders() when the day-of-checkout WhatsApp reminder is enqueued; prevents re-sending.';

-- Mirrors generate_precheckin_reminders: scan in-house stays whose checkout is
-- today (hotel tz) from 09:00, at WhatsApp-enabled hotels with a phone, enqueue
-- once, and stamp the flag atomically.
CREATE OR REPLACE FUNCTION public.generate_checkout_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  WITH targets AS (
    SELECT s.id AS stay_id, s.booking_id, s.hotel_id, s.room_id,
           b.phone, b.guest_name, h.name AS hotel_name,
           h.whatsapp_provider, h.default_checkout_time
    FROM public.stays s
    JOIN public.bookings b ON b.id = s.booking_id
    JOIN public.hotels   h ON h.id = s.hotel_id
    WHERE s.status = 'inhouse'
      AND s.checkout_reminder_sent_at IS NULL
      AND COALESCE(h.whatsapp_enabled, false)
      AND COALESCE(btrim(b.phone), '') <> ''
      AND (s.scheduled_checkout_at AT TIME ZONE h.timezone)::date
            = (now() AT TIME ZONE h.timezone)::date
      AND (now() AT TIME ZONE h.timezone)::time >= time '09:00'
    FOR UPDATE OF s
  ),
  inserted AS (
    INSERT INTO public.notification_queue (
      booking_id, hotel_id, channel, provider, template_code, payload, status, next_attempt_at
    )
    SELECT booking_id, hotel_id, 'whatsapp', COALESCE(whatsapp_provider, 'INTERAKT'),
           'checkout_reminder',
           jsonb_build_object('phone', phone, 'guest_name', guest_name,
                              'hotel_name', hotel_name,
                              'checkout_time', to_char(default_checkout_time, 'HH12:MI AM')),
           'pending', now()
    FROM targets
    RETURNING booking_id
  )
  UPDATE public.stays s
     SET checkout_reminder_sent_at = now()
   WHERE s.id IN (SELECT stay_id FROM targets);
END;
$$;

ALTER FUNCTION public.generate_checkout_reminders() OWNER TO postgres;

COMMENT ON FUNCTION public.generate_checkout_reminders() IS
  'Enqueues the day-of-checkout WhatsApp reminder (template_code checkout_reminder) once per in-house stay whose checkout is today, for WhatsApp-enabled hotels with a phone. Mirrors generate_precheckin_reminders. Scheduled hourly via pg_cron.';

-- Hourly cron (the time-of-day >= 09:00 gate inside the RPC bounds actual sends
-- to the morning of checkout). unschedule-if-exists keeps this idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate-checkout-reminders') THEN
    PERFORM cron.unschedule('generate-checkout-reminders');
  END IF;
  PERFORM cron.schedule(
    'generate-checkout-reminders',
    '7 * * * *',
    $cron$SELECT public.generate_checkout_reminders();$cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'could not schedule generate-checkout-reminders cron: %', SQLERRM;
END;
$$;
