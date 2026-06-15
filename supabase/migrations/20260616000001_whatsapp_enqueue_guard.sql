-- 20260616000001_whatsapp_enqueue_guard.sql
--
-- PROBLEM (observed in prod 2026-06-16):
--   notification_queue had 36 permanently-failed WhatsApp rows —
--     • 29 with error_message = 'WHATSAPP_DISABLED_FOR_HOTEL'
--     • 7  with error_message = 'Hotel WhatsApp ID not configured'
--   all retry_count = 11, status = 'failed'. Root cause confirmed in code:
--   the post-checkout enqueue in checkout_stay() (and the legacy precheckin
--   enqueue) INSERT a channel='whatsapp' row whenever the guest has a phone,
--   WITHOUT checking hotels.whatsapp_enabled. Every hotel is currently
--   whatsapp_enabled=false, so each such row is dispatched, throws
--   WHATSAPP_DISABLED_FOR_HOTEL, and dead-letters after 10 retries.
--
--   The newer enqueue triggers (enqueue_checkin_welcome / _payment_receipt /
--   generate_checkout_reminders, added 20260613000010) ALREADY gate on
--   whatsapp_enabled in-function. This migration brings the OLDER inline
--   enqueues (post_checkout, precheckin) up to the same standard WITHOUT
--   rewriting those large, recently-hardened RPCs.
--
-- FIX:
--   A single BEFORE INSERT guard on notification_queue. For a booking-linked
--   WhatsApp row, if the booking's hotel has whatsapp_enabled = false, the
--   insert is skipped (the row would 100% fail at dispatch otherwise, with no
--   send). This is behaviourally equivalent to "dispatch then fail" minus the
--   dead-letter noise. When a hotel later enables WhatsApp, future rows enqueue
--   normally — there is intentionally no backlog to replay (deferred rows
--   permanently fail after 48 attempts anyway, see 20260602001004).
--
-- SAFETY / SCOPE (deliberately conservative — "don't break anything"):
--   • Only acts on channel = 'whatsapp'. Email + every other channel: untouched.
--   • Only acts on booking-linked rows (booking_id IS NOT NULL). Lead/drip and
--     quote rows (lead_id-based) are left exactly as today — no interaction with
--     the drip state machine.
--   • Fail-OPEN: if the hotel can't be resolved, the row enqueues as before.
--     A row is dropped ONLY when whatsapp_enabled is positively false.
--   • Idempotent (CREATE OR REPLACE + DROP TRIGGER IF EXISTS).

CREATE OR REPLACE FUNCTION public.guard_whatsapp_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_hotel_id uuid;
  v_enabled  boolean;
BEGIN
  -- Non-WhatsApp channels pass straight through.
  IF NEW.channel IS DISTINCT FROM 'whatsapp' THEN
    RETURN NEW;
  END IF;

  -- Only guard booking lifecycle rows. Lead/drip/quote rows are out of scope.
  IF NEW.booking_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT hotel_id INTO v_hotel_id
    FROM public.bookings
   WHERE id = NEW.booking_id;

  -- Fail open: unknown hotel → keep current behaviour (enqueue).
  IF v_hotel_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT whatsapp_enabled INTO v_enabled
    FROM public.hotels
   WHERE id = v_hotel_id;

  -- Drop ONLY when WhatsApp is positively disabled for the hotel.
  IF NOT COALESCE(v_enabled, false) THEN
    RETURN NULL;  -- cancels this INSERT (BEFORE INSERT FOR EACH ROW)
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.guard_whatsapp_enqueue() OWNER TO postgres;

COMMENT ON FUNCTION public.guard_whatsapp_enqueue() IS
  'BEFORE INSERT guard on notification_queue: skips booking-linked WhatsApp rows '
  'when the booking''s hotel has whatsapp_enabled=false (they would dead-letter '
  'with WHATSAPP_DISABLED_FOR_HOTEL otherwise). Fail-open for unknown hotels; '
  'never touches email or lead/drip rows. See 20260616000001.';

DROP TRIGGER IF EXISTS trg_guard_whatsapp_enqueue ON public.notification_queue;
CREATE TRIGGER trg_guard_whatsapp_enqueue
  BEFORE INSERT ON public.notification_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_whatsapp_enqueue();
