-- 20260616000005_drip_triggers_resilient.sql
--
-- FIX: public lead capture (and lead status-change reactions) aborted when a
-- hotel had no matching drip_rule configured.
--
-- trg_drip_on_lead_insert / trg_drip_on_lead_event call subscribe_lead_to_drip,
-- which RAISEs 'RULE_NOT_FOUND' when the hotel has not configured the rule it
-- looks up (GENERAL_ENQUIRY / WALKIN_LOST / QUOTE_SENT). Because these run
-- inside AFTER INSERT triggers, that exception rolled back the entire lead /
-- lead_event INSERT. So the public enquiry form (create_lead_public ->
-- leads-public-capture) returned RULE_NOT_FOUND and the guest saw the generic
-- "Could not submit. Please try again shortly." for ANY hotel that hadn't been
-- seeded with drip rules (e.g. hotels created before the drip seed trigger, or
-- demo hotels). Confirmed locally: every hotel had 0 drip_rules, so 100% of
-- public enquiry submissions failed.
--
-- Drip enrollment is a best-effort marketing side-effect; it must NEVER block
-- lead capture, which is a business-critical action. subscribe_lead_to_drip
-- already tolerates a *disabled* rule (RETURN NULL, with the comment "triggers
-- shouldn't fail because a hotel disabled a rule"). This migration extends that
-- exact intent to a *missing* rule — and to any other unexpected drip error —
-- but enforces it at the TRIGGER boundary so the lead/event always persists.
--
-- subscribe_lead_to_drip itself is left STRICT (still RAISEs RULE_NOT_FOUND).
-- Its only non-trigger caller is the owner UI (web/src/services/dripService.ts),
-- where an explicit, user-chosen bad rule code is a real error worth surfacing.
-- Only the automatic trigger paths become best-effort.
--
-- Function bodies are reproduced verbatim from 20260526000005 (the sole prior
-- definition) with the PERFORM subscribe_lead_to_drip(...) calls wrapped in
-- per-call BEGIN/EXCEPTION subtransactions. The surrounding pause/cancel logic
-- is unchanged. CREATE OR REPLACE keeps the existing triggers wired.

-- ─── subscribe on insert (best-effort) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_drip_on_lead_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.status <> 'NEW' THEN RETURN NEW; END IF;
  -- Walk-ins follow the WALKIN_LOST rule when they later go LOST — don't
  -- start GENERAL_ENQUIRY for them.
  IF NEW.source = 'WALK_IN' THEN RETURN NEW; END IF;

  -- Best-effort: a missing/disabled rule (or any drip error) must not abort the
  -- lead INSERT. Swallow + log so the lead still saves and the enquiry succeeds.
  BEGIN
    PERFORM public.subscribe_lead_to_drip(NEW.id, 'GENERAL_ENQUIRY');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[drip] GENERAL_ENQUIRY subscribe skipped for lead % (hotel %): %',
      NEW.id, NEW.hotel_id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- ─── status-change reactions (best-effort subscribes) ──────────────────────
CREATE OR REPLACE FUNCTION public.trg_drip_on_lead_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_to    text;
  v_lead  record;
  v_pause_reason text;
BEGIN
  IF NEW.event_type <> 'STATUS_CHANGED' THEN RETURN NEW; END IF;
  v_to := NEW.payload->>'to';
  IF v_to IS NULL THEN RETURN NEW; END IF;

  SELECT id, hotel_id, source INTO v_lead FROM public.leads WHERE id = NEW.lead_id;
  IF v_lead.id IS NULL THEN RETURN NEW; END IF;

  -- Pause on engagement signals
  IF v_to IN ('QUALIFIED','WON','CONVERTED') THEN
    v_pause_reason := CASE v_to
      WHEN 'QUALIFIED' THEN 'LEAD_QUALIFIED'
      WHEN 'WON'       THEN 'LEAD_WON'
      WHEN 'CONVERTED' THEN 'LEAD_CONVERTED'
    END;
    UPDATE public.lead_drip_subscriptions
       SET status = 'PAUSED', paused_reason = v_pause_reason,
           next_step_idx = NULL, next_step_due_at = NULL
     WHERE lead_id = v_lead.id AND status = 'ACTIVE';
    INSERT INTO public.lead_drip_events (subscription_id, hotel_id, lead_id, event_type, payload)
    SELECT id, hotel_id, lead_id, 'PAUSED',
           jsonb_build_object('reason', v_pause_reason, 'trigger','status_change')
      FROM public.lead_drip_subscriptions
     WHERE lead_id = v_lead.id AND status = 'PAUSED' AND paused_reason = v_pause_reason;
  END IF;

  -- Cancel on LOST (any source). WALKIN_LOST subscribe runs after.
  IF v_to = 'LOST' THEN
    UPDATE public.lead_drip_subscriptions
       SET status = 'CANCELLED', cancelled_at = clock_timestamp(),
           next_step_idx = NULL, next_step_due_at = NULL
     WHERE lead_id = v_lead.id
       AND status IN ('ACTIVE','PAUSED','NO_CHANNEL');
    INSERT INTO public.lead_drip_events (subscription_id, hotel_id, lead_id, event_type, payload)
    SELECT id, hotel_id, lead_id, 'CANCELLED',
           jsonb_build_object('reason','LEAD_LOST','trigger','status_change')
      FROM public.lead_drip_subscriptions
     WHERE lead_id = v_lead.id AND status = 'CANCELLED' AND cancelled_at >= clock_timestamp() - interval '5 seconds';

    IF v_lead.source = 'WALK_IN' THEN
      BEGIN
        PERFORM public.subscribe_lead_to_drip(v_lead.id, 'WALKIN_LOST');
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[drip] WALKIN_LOST subscribe skipped for lead % (hotel %): %',
          v_lead.id, v_lead.hotel_id, SQLERRM;
      END;
    END IF;
  END IF;

  IF v_to = 'QUOTED' THEN
    -- A new quote supersedes general nudging. Pause GENERAL_ENQUIRY so the
    -- guest doesn't get both "still planning your stay?" and "following up
    -- on your quote" — overlapping drips look like spam.
    UPDATE public.lead_drip_subscriptions s
       SET status = 'PAUSED', paused_reason = 'SUPERSEDED_BY_QUOTE',
           next_step_idx = NULL, next_step_due_at = NULL
      FROM public.drip_rules r
     WHERE s.rule_id = r.id
       AND s.lead_id = v_lead.id
       AND s.status = 'ACTIVE'
       AND r.code = 'GENERAL_ENQUIRY';
    INSERT INTO public.lead_drip_events (subscription_id, hotel_id, lead_id, event_type, payload)
    SELECT s.id, s.hotel_id, s.lead_id, 'PAUSED',
           jsonb_build_object('reason','SUPERSEDED_BY_QUOTE','trigger','status_change')
      FROM public.lead_drip_subscriptions s
      JOIN public.drip_rules r ON r.id = s.rule_id
     WHERE s.lead_id = v_lead.id
       AND s.status = 'PAUSED'
       AND s.paused_reason = 'SUPERSEDED_BY_QUOTE'
       AND r.code = 'GENERAL_ENQUIRY';

    BEGIN
      PERFORM public.subscribe_lead_to_drip(v_lead.id, 'QUOTE_SENT');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[drip] QUOTE_SENT subscribe skipped for lead % (hotel %): %',
        v_lead.id, v_lead.hotel_id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;
