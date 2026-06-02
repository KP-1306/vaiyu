-- Follow-up Radar — make Lead-CRM auto-create triggers fail-soft.
--
-- Phase 2 (20260526000003) introduced AFTER INSERT triggers on `leads` and
-- `lead_events` that call _auto_create_follow_up. Those triggers run inside
-- the same transaction as the lead operation — so if follow-up creation
-- ever throws (constraint violation, deadlock, etc.), the entire lead
-- operation rolls back. That's an unacceptable coupling for a non-critical
-- feature: a bug in Follow-up Radar must not block lead capture or status
-- transitions.
--
-- Fix: wrap the PERFORM calls inside EXCEPTION WHEN OTHERS THEN log + swallow.
-- The lead operation always succeeds. Failed follow-up creation is logged
-- via RAISE WARNING (visible in Supabase logs); operator can later backfill
-- via the sync_follow_ups_from_leads RPC.

CREATE OR REPLACE FUNCTION public.trg_follow_up_on_lead_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_title text;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;

  v_title := 'Follow up with ' || COALESCE(NEW.contact_name, 'new enquiry');

  BEGIN
    PERFORM public._auto_create_follow_up(
      NEW.hotel_id,
      NEW.id,
      'DIRECT_ENQUIRY',
      v_title,
      CASE
        WHEN NEW.requested_check_in IS NOT NULL AND NEW.requested_check_out IS NOT NULL
          THEN 'Stay: ' || NEW.requested_check_in::text || ' → ' || NEW.requested_check_out::text
        ELSE 'New enquiry — first reply pending.'
      END,
      'lead-' || NEW.id::text,
      'AUTO_LEAD_CREATED'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'follow_up auto-create failed for lead %: % (SQLSTATE %)',
      NEW.id, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_follow_up_on_lead_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_to   text;
  v_lead record;
BEGIN
  IF NEW.event_type <> 'STATUS_CHANGED' THEN RETURN NEW; END IF;

  v_to := NEW.payload->>'to';

  SELECT id, hotel_id, contact_name INTO v_lead
    FROM public.leads WHERE id = NEW.lead_id;
  IF v_lead.id IS NULL THEN RETURN NEW; END IF;

  BEGIN
    IF v_to = 'QUOTED' THEN
      PERFORM public._auto_create_follow_up(
        v_lead.hotel_id,
        v_lead.id,
        'QUOTE_SENT',
        'Nudge ' || COALESCE(v_lead.contact_name, 'guest') || ' on the quote',
        'Quote sent. Follow up if no response within 48 hours.',
        'quote-' || v_lead.id::text,
        'AUTO_LEAD_QUOTED'
      );
    END IF;

    IF v_to = 'CONVERTED' THEN
      UPDATE public.follow_ups SET
        status         = 'ADDRESSED',
        addressed_at   = clock_timestamp(),
        addressed_note = 'Auto-resolved: lead converted to booking.',
        updated_at     = clock_timestamp()
      WHERE lead_id = v_lead.id
        AND status NOT IN ('ADDRESSED')
        AND dismissed_at IS NULL;

      INSERT INTO public.follow_up_events (follow_up_id, hotel_id, event_type, payload, actor_id)
      SELECT id, hotel_id, 'AUTO_RESOLVED',
             jsonb_build_object('trigger', 'lead_converted'), NULL
        FROM public.follow_ups
       WHERE lead_id = v_lead.id
         AND status = 'ADDRESSED'
         AND addressed_note = 'Auto-resolved: lead converted to booking.';
    END IF;

    IF v_to = 'LOST' THEN
      UPDATE public.follow_ups SET
        dismissed_at     = clock_timestamp(),
        dismissed_reason = 'Auto-dismissed: lead marked as lost.',
        updated_at       = clock_timestamp()
      WHERE lead_id = v_lead.id
        AND dismissed_at IS NULL;

      INSERT INTO public.follow_up_events (follow_up_id, hotel_id, event_type, payload, actor_id)
      SELECT id, hotel_id, 'AUTO_DISMISSED',
             jsonb_build_object('trigger', 'lead_lost'), NULL
        FROM public.follow_ups
       WHERE lead_id = v_lead.id
         AND dismissed_reason = 'Auto-dismissed: lead marked as lost.';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'follow_up trigger failed for lead % event % → %: % (SQLSTATE %)',
      v_lead.id, NEW.event_type, v_to, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_follow_up_on_lead_insert IS
  'Fail-soft trigger: a bug in follow_up creation must never roll back a lead INSERT. Failures are logged via RAISE WARNING; operators can backfill via sync_follow_ups_from_leads.';

COMMENT ON FUNCTION public.trg_follow_up_on_lead_event IS
  'Fail-soft trigger: a bug in follow_up creation must never roll back a lead status transition. Failures are logged via RAISE WARNING; operators can backfill via sync_follow_ups_from_leads.';
