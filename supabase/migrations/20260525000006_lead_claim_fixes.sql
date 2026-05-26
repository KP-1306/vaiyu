-- Lead claim RPCs — bug fixes caught during Day 3 smoke testing
--
-- Two issues fixed:
--
-- 1. release_claim used `IF v_updated IS NULL` to detect that the UPDATE
--    didn't match any row. But Postgres treats a record with all-NULL fields
--    as IS NULL, so the successful UPDATE (which sets claimed_by and
--    claimed_at to NULL via RETURNING) was indistinguishable from a missed
--    UPDATE. Effect: claim got cleared in DB but the RPC reported
--    `released: false` and skipped the CLAIM_RELEASED event — silent data
--    integrity break.
--
--    Fix: gate on a boolean computed from the row read BEFORE the UPDATE.
--    If the caller holds the claim, we run the UPDATE and write the event.
--    If not, we no-op cleanly.
--
-- 2. claim_lead and force_release_claim used now() for setting claimed_at.
--    now() returns transaction-start time, so multiple claim operations in
--    one transaction produced identical timestamps. The lead_events table
--    already uses clock_timestamp() per migration 000004 — claim timestamps
--    should be consistent with that. Switched all SET claimed_at = now() to
--    clock_timestamp(). Predicate comparisons against claimed_at now use
--    clock_timestamp() too for symmetry.

-- ─── release_claim — boolean-gated release ────────────────────────────────

CREATE OR REPLACE FUNCTION public.release_claim(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_lead            record;
  v_should_release  boolean;
  v_status          jsonb;
BEGIN
  SELECT id, hotel_id, deleted_at, claimed_by, claimed_at
    INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
  IF v_lead.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'LEAD_DELETED'; END IF;

  IF NOT public.vaiyu_is_hotel_member(v_lead.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- Decision is made from the pre-read row, not from UPDATE result.
  -- Caller must currently hold the claim.
  v_should_release := (v_lead.claimed_by IS NOT NULL AND v_lead.claimed_by = auth.uid());

  IF NOT v_should_release THEN
    v_status := public._build_claim_status_jsonb(v_lead.claimed_by, v_lead.claimed_at);
    RETURN v_status || jsonb_build_object('ok', true, 'released', false);
  END IF;

  -- Belt-and-suspenders: add claimed_by = auth.uid() to the UPDATE WHERE so
  -- a concurrent force_release between our SELECT and UPDATE doesn't cause
  -- us to wipe a different holder's claim.
  UPDATE public.leads
     SET claimed_by = NULL, claimed_at = NULL
   WHERE id = p_lead_id
     AND claimed_by = auth.uid();

  IF NOT FOUND THEN
    -- Lost a race to a concurrent force_release. Return current state honestly.
    SELECT claimed_by, claimed_at
      INTO v_lead FROM public.leads WHERE id = p_lead_id;
    v_status := public._build_claim_status_jsonb(v_lead.claimed_by, v_lead.claimed_at);
    RETURN v_status || jsonb_build_object('ok', true, 'released', false);
  END IF;

  INSERT INTO public.lead_events (lead_id, hotel_id, event_type, payload, actor_id)
  VALUES (
    p_lead_id, v_lead.hotel_id, 'CLAIM_RELEASED',
    jsonb_build_object(
      'by_user',           auth.uid(),
      'by_user_name',      public._user_display_name(auth.uid()),
      'prev_holder',       v_lead.claimed_by,
      'prev_holder_name',  public._user_display_name(v_lead.claimed_by),
      'release_type',      'manual',
      'reason',            NULL,
      'actor_role',        NULL
    ),
    auth.uid()
  );

  v_status := public._build_claim_status_jsonb(NULL, NULL);
  RETURN v_status || jsonb_build_object('ok', true, 'released', true);
END;
$$;

-- ─── claim_lead — switch claimed_at to clock_timestamp() ──────────────────

CREATE OR REPLACE FUNCTION public.claim_lead(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_lead             record;
  v_prev_claimed_by  uuid;
  v_prev_claimed_at  timestamptz;
  v_was_expired      boolean;
  v_updated          record;
  v_status           jsonb;
BEGIN
  SELECT id, hotel_id, deleted_at, claimed_by, claimed_at
    INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
  IF v_lead.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'LEAD_DELETED'; END IF;

  IF NOT public.vaiyu_is_hotel_member(v_lead.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  v_prev_claimed_by := v_lead.claimed_by;
  v_prev_claimed_at := v_lead.claimed_at;
  v_was_expired     := public._is_claim_expired(v_prev_claimed_at);

  UPDATE public.leads
     SET claimed_by = auth.uid(),
         claimed_at = clock_timestamp()
   WHERE id = p_lead_id
     AND deleted_at IS NULL
     AND (
       claimed_by IS NULL
       OR claimed_by = auth.uid()
       OR claimed_at < clock_timestamp() - public._claim_ttl()
     )
   RETURNING claimed_by, claimed_at INTO v_updated;

  IF NOT FOUND THEN
    SELECT claimed_by, claimed_at
      INTO v_updated FROM public.leads WHERE id = p_lead_id;
    v_status := public._build_claim_status_jsonb(v_updated.claimed_by, v_updated.claimed_at);
    RETURN v_status || jsonb_build_object('ok', false);
  END IF;

  IF v_prev_claimed_by IS DISTINCT FROM auth.uid() THEN
    INSERT INTO public.lead_events (lead_id, hotel_id, event_type, payload, actor_id)
    VALUES (
      p_lead_id, v_lead.hotel_id, 'CLAIMED',
      jsonb_build_object(
        'by_user',           auth.uid(),
        'by_user_name',      public._user_display_name(auth.uid()),
        'prev_user',         v_prev_claimed_by,
        'prev_user_name',    public._user_display_name(v_prev_claimed_by),
        'expires_at',        v_updated.claimed_at + public._claim_ttl(),
        'took_over_expired', (v_prev_claimed_by IS NOT NULL AND v_was_expired)
      ),
      auth.uid()
    );
  END IF;

  v_status := public._build_claim_status_jsonb(v_updated.claimed_by, v_updated.claimed_at);
  RETURN v_status || jsonb_build_object('ok', true);
END;
$$;
