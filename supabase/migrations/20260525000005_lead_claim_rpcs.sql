-- Lead claim lock RPCs (Day 3)
--
-- 4 public RPCs + 3 internal helpers. Implements the optimistic claim pattern
-- that prevents two staff from working the same lead simultaneously.
--
-- Public RPCs:
--   claim_lead          — atomic check-and-set, refreshes if same user
--   release_claim       — voluntary release by current holder
--   force_release_claim — manager-class override with mandatory reason
--   get_lead_claim_status — read-only status fetch
--
-- Internal helpers:
--   _claim_ttl()                              — single source of truth for 15-min TTL
--   _is_claim_expired(timestamptz)            — claim expiry check
--   _user_display_name(uuid)                  — friendly name for event payload snapshot
--   _build_claim_status_jsonb(uuid, ts)       — consistent status response shape
--
-- Design notes (all 6 review fixes baked in):
--
-- 1. Event payloads snapshot the holder's display name at write time. This
--    avoids coupling the event log to auth.users for read-time lookups.
--    Timelines remain meaningful even if a user is later deleted or moved to
--    a different auth provider.
--
-- 2. All timestamps returned to the frontend are ABSOLUTE (UTC timestamptz).
--    The frontend must NEVER compute expiry from a relative countdown — it
--    must call claim_lead / get_lead_claim_status to re-validate. The server
--    is the only authority for "is this claim still active".
--
-- 3. release_claim returns { released: true|false } so the UI can distinguish
--    "we cleared the claim" from "no claim to clear" without inspecting
--    other fields.
--
-- 4. Force-release writes a realtime CLAIM_RELEASED event with release_type
--    = 'forced'. The Day 9 frontend MUST subscribe to lead_events and show a
--    toast to the displaced holder when this fires for a lead they were
--    working on. This is an acceptance criterion for Day 9, not optional.
--
-- 5. CLAIM_RELEASED payload uses release_type enum (manual | forced) instead
--    of overlapping boolean flags. Cleaner semantics for downstream consumers.
--
-- 6. _is_claim_expired() and _claim_ttl() are the single source of truth for
--    the 15-minute expiry. Change in one place propagates everywhere.

-- ─── _claim_ttl ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._claim_ttl()
RETURNS interval
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT interval '15 minutes'
$$;

COMMENT ON FUNCTION public._claim_ttl IS
  'Single source of truth for the claim-lock TTL. Used by _is_claim_expired and claim_lead UPDATE predicate.';

-- ─── _is_claim_expired ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._is_claim_expired(p_claimed_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT p_claimed_at IS NULL OR p_claimed_at < now() - public._claim_ttl()
$$;

-- ─── _user_display_name ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._user_display_name(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT COALESCE(
    NULLIF(btrim(au.raw_user_meta_data->>'full_name'), ''),
    NULLIF(btrim(au.raw_user_meta_data->>'name'), ''),
    split_part(au.email, '@', 1),
    'unknown'
  )
  FROM auth.users au
  WHERE au.id = p_user_id
$$;

COMMENT ON FUNCTION public._user_display_name IS
  'Returns friendly display name (full_name > name > email alias). Used at event-write time to snapshot holder identity into the event payload, avoiding read-time auth.users coupling.';

-- ─── _build_claim_status_jsonb ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._build_claim_status_jsonb(
  p_claimed_by uuid,
  p_claimed_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_is_expired boolean;
  v_caller     uuid := auth.uid();
BEGIN
  v_is_expired := public._is_claim_expired(p_claimed_at);

  IF p_claimed_by IS NULL OR v_is_expired THEN
    RETURN jsonb_build_object(
      'claimed_by',       NULL,
      'claimed_by_name',  NULL,
      'claimed_at',       NULL,
      'claim_expires_at', NULL,
      'is_expired',       v_is_expired,
      'is_self',          false
    );
  END IF;

  RETURN jsonb_build_object(
    'claimed_by',       p_claimed_by,
    'claimed_by_name',  public._user_display_name(p_claimed_by),
    'claimed_at',       p_claimed_at,
    'claim_expires_at', p_claimed_at + public._claim_ttl(),
    'is_expired',       false,
    'is_self',          (p_claimed_by = v_caller)
  );
END;
$$;

-- ─── claim_lead ───────────────────────────────────────────────────────────

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
  -- Initial guards
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

  -- Atomic check-and-set. Postgres row lock during UPDATE serializes contention.
  -- Predicate: claim is available if no one holds it, the caller already holds
  -- it (heartbeat refresh), or the existing claim is expired.
  UPDATE public.leads
     SET claimed_by = auth.uid(),
         claimed_at = now()
   WHERE id = p_lead_id
     AND deleted_at IS NULL
     AND (
       claimed_by IS NULL
       OR claimed_by = auth.uid()
       OR claimed_at < now() - public._claim_ttl()
     )
   RETURNING claimed_by, claimed_at INTO v_updated;

  IF v_updated.claimed_by IS NULL THEN
    -- Contention: someone else holds an active claim. Re-read the latest state.
    SELECT claimed_by, claimed_at
      INTO v_updated FROM public.leads WHERE id = p_lead_id;
    v_status := public._build_claim_status_jsonb(v_updated.claimed_by, v_updated.claimed_at);
    RETURN v_status || jsonb_build_object('ok', false);
  END IF;

  -- We hold the claim. Write CLAIMED event only if claim CHANGED HANDS.
  -- Same-user heartbeat refresh writes no event (avoids timeline spam).
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

-- ─── release_claim ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.release_claim(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_lead     record;
  v_updated  record;
  v_status   jsonb;
BEGIN
  SELECT id, hotel_id, deleted_at, claimed_by, claimed_at
    INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
  IF v_lead.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'LEAD_DELETED'; END IF;

  IF NOT public.vaiyu_is_hotel_member(v_lead.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- Only the current holder can voluntarily release. No-op (not error) if
  -- the caller doesn't hold the claim — UI may call this on tab close
  -- regardless of state.
  UPDATE public.leads
     SET claimed_by = NULL, claimed_at = NULL
   WHERE id = p_lead_id
     AND claimed_by = auth.uid()
   RETURNING claimed_by, claimed_at INTO v_updated;

  IF v_updated IS NULL OR (v_updated.claimed_by IS NULL AND v_lead.claimed_by <> auth.uid()) THEN
    -- We didn't actually release anything (caller wasn't the holder)
    v_status := public._build_claim_status_jsonb(v_lead.claimed_by, v_lead.claimed_at);
    RETURN v_status || jsonb_build_object('ok', true, 'released', false);
  END IF;

  -- We released our claim. Write CLAIM_RELEASED event.
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

-- ─── force_release_claim ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.force_release_claim(
  p_lead_id uuid,
  p_reason  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_lead       record;
  v_actor_role text;
  v_status     jsonb;
BEGIN
  SELECT id, hotel_id, deleted_at, claimed_by, claimed_at
    INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
  IF v_lead.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'LEAD_DELETED'; END IF;

  -- Manager-class authority required (OWNER, ADMIN, MANAGER, GENERAL_MANAGER,
  -- FINANCE_MANAGER). Same authority band as soft_delete_lead.
  IF NOT public.vaiyu_is_hotel_finance_manager(v_lead.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  v_actor_role := public._hotel_role_code(v_lead.hotel_id);

  -- Clear the claim regardless of who holds it
  UPDATE public.leads
     SET claimed_by = NULL, claimed_at = NULL
   WHERE id = p_lead_id;

  -- Write CLAIM_RELEASED event only if there was actually a claim to release
  IF v_lead.claimed_by IS NOT NULL THEN
    INSERT INTO public.lead_events (lead_id, hotel_id, event_type, payload, actor_id)
    VALUES (
      p_lead_id, v_lead.hotel_id, 'CLAIM_RELEASED',
      jsonb_build_object(
        'by_user',           auth.uid(),
        'by_user_name',      public._user_display_name(auth.uid()),
        'prev_holder',       v_lead.claimed_by,
        'prev_holder_name',  public._user_display_name(v_lead.claimed_by),
        'release_type',      'forced',
        'reason',            btrim(p_reason),
        'actor_role',        v_actor_role
      ),
      auth.uid()
    );
  END IF;

  v_status := public._build_claim_status_jsonb(NULL, NULL);
  RETURN v_status || jsonb_build_object(
    'ok', true,
    'released', v_lead.claimed_by IS NOT NULL,
    'release_type', 'forced'
  );
END;
$$;

-- ─── get_lead_claim_status ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_lead_claim_status(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_lead   record;
  v_status jsonb;
BEGIN
  SELECT id, hotel_id, deleted_at, claimed_by, claimed_at
    INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;

  -- Note: we deliberately allow reading claim status of soft-deleted leads
  -- so the UI can render historical state. Mutations (claim_lead etc.) still
  -- block on LEAD_DELETED.

  IF NOT public.vaiyu_is_hotel_member(v_lead.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  v_status := public._build_claim_status_jsonb(v_lead.claimed_by, v_lead.claimed_at);
  RETURN v_status || jsonb_build_object('ok', true);
END;
$$;

-- ─── Grants ──────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.claim_lead             TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_claim          TO authenticated;
GRANT EXECUTE ON FUNCTION public.force_release_claim    TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lead_claim_status  TO authenticated;

-- Internal helpers (_*) are not granted — RPC-internal only.
