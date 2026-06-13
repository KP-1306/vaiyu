-- WhatsApp notification when a guest's service request is completed.
--
-- When staff complete a guest-raised service request (resolve_ticket sets
-- tickets.status = 'COMPLETED'), the guest gets a WhatsApp message: "your
-- request is done". This is the outbound counterpart to the inbound
-- service-request flow already wired through the notification_queue +
-- send-notifications worker + Interakt template registry.
--
-- STAGED, NOT LIVE — by design. The whole outbound WhatsApp layer is built but
-- dormant: every entry in interakt-templates.ts is a placeholder until its
-- Meta/Interakt template is approved. This migration completes the *code* path
-- (enqueue trigger) so that the moment the `service_request_completed` template
-- is approved and switched from placeholder to real def, notifications flow
-- with zero further code. Until then, enqueued rows defer hourly (the worker's
-- INTERAKT_TEMPLATE_NOT_CONFIGURED path) — fail-safe, never lost, never sent
-- wrong.
--
-- Scope/guards (operator reality):
--   • Only GUEST-originated requests (created_by_type = 'GUEST') — staff/system
--     tickets are internal and never message a guest.
--   • Only the COMPLETED transition (OLD <> COMPLETED) — never on re-saves.
--   • Only hotels with WhatsApp enabled — no dormant rows for the 10 hotels not
--     on WhatsApp.
--   • Only when a reachable phone exists on the booking — no unsendable rows.
--   • Enqueue is fully guarded (EXCEPTION … RAISE WARNING) so a notification
--     problem can NEVER roll back the staff member's ticket completion.

CREATE OR REPLACE FUNCTION public.enqueue_service_request_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_booking_id uuid;
  v_phone      text;
  v_guest_name text;
  v_enabled    boolean;
  v_provider   text;
  v_location   text;
BEGIN
  -- The WHEN clause already restricts to GUEST tickets hitting COMPLETED for
  -- the first time. Everything below is wrapped so it can never break the
  -- ticket UPDATE that fired this trigger.
  BEGIN
    -- A guest request is tied to a stay; the stay's booking carries the phone.
    IF NEW.stay_id IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT b.id, b.phone, b.guest_name
      INTO v_booking_id, v_phone, v_guest_name
      FROM public.stays s
      JOIN public.bookings b ON b.id = s.booking_id
     WHERE s.id = NEW.stay_id;

    IF v_booking_id IS NULL OR COALESCE(btrim(v_phone), '') = '' THEN
      RETURN NEW;  -- no reachable guest phone → nothing to enqueue
    END IF;

    -- Only enqueue for hotels actually on WhatsApp. provider drives dispatch
    -- (the worker's Interakt branch vs META_DIRECT legacy branch).
    SELECT whatsapp_enabled, whatsapp_provider
      INTO v_enabled, v_provider
      FROM public.hotels
     WHERE id = NEW.hotel_id;

    IF NOT COALESCE(v_enabled, false) THEN
      RETURN NEW;
    END IF;

    -- Room number for message context (NULL for zone/common-area requests).
    SELECT r.number INTO v_location
      FROM public.rooms r
     WHERE r.id = NEW.room_id;

    INSERT INTO public.notification_queue (
      booking_id, hotel_id, channel, provider, template_code, payload,
      status, next_attempt_at
    ) VALUES (
      v_booking_id,
      NEW.hotel_id,
      'whatsapp',
      COALESCE(v_provider, 'INTERAKT'),
      'service_request_completed',
      jsonb_build_object(
        'phone',             v_phone,
        'guest_name',        v_guest_name,
        'service_title',     NEW.title,
        'location',          v_location,
        'ticket_display_id', NEW.display_id
      ),
      'pending',
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    -- Notification failure must never roll back ticket completion.
    RAISE WARNING 'enqueue_service_request_completed failed for ticket %: %',
      NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_service_request_completed() IS
  'AFTER UPDATE trigger fn: enqueues a WhatsApp service_request_completed notification when a GUEST ticket transitions to COMPLETED, for WhatsApp-enabled hotels with a reachable booking phone. Fully guarded so it never blocks ticket resolution.';

DROP TRIGGER IF EXISTS trg_enqueue_service_request_completed ON public.tickets;
CREATE TRIGGER trg_enqueue_service_request_completed
  AFTER UPDATE OF status ON public.tickets
  FOR EACH ROW
  WHEN (
    NEW.status = 'COMPLETED'
    AND OLD.status IS DISTINCT FROM 'COMPLETED'
    AND NEW.created_by_type = 'GUEST'
  )
  EXECUTE FUNCTION public.enqueue_service_request_completed();
