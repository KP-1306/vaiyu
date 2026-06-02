-- Visibility Score — Hardening pass (2026-06-01)
--
-- Fixes uncovered by hostile-mode self-review of the 2026-05-31 migration.
-- All issues live and now closed in v1 (no Phase 2):
--
--   1. RLS leak: snapshot policy `hotel_id IS NULL OR vaiyu_is_hotel_member`
--      let any authenticated user read orphaned (deleted-hotel) snapshots.
--      Tightened to AND, dropping the NULL pass-through.
--
--   2. Cron-health false-positive for new hotels: a brand-new tenant created
--      Wednesday saw "no snapshot in 9 days" until the Sunday cron fired.
--      View now grants a 14-day grace period from hotels.created_at.
--
--   3. Snapshot delta tracking was broken: prior implementation re-read the
--      previous snapshot's `signals_changed` field (which is the *delta*, not
--      the *state*) and a `WHERE false` clamp made the output always empty.
--      Adds `signal_states jsonb` to each snapshot (compact map of
--      key→effective_state) so the next snapshot can compute a real diff.
--
--   4. Manager-verify expired in score-compute but DB row stayed
--      MANAGER_VERIFIED forever and no audit event fired on the 90-day mark.
--      Adds `_degrade_expired_visibility_attestations()` helper plus a daily
--      pg_cron job that demotes expired rows and writes audit events.
--
--   5. Unverify-lock check on a deleted verifier (manager_verified_by IS NULL
--      after auth.users cascade) relied on `NULL <> uuid` evaluating to NULL
--      to bypass the lock. Made it explicit with an IS NOT NULL guard.
--
-- Re-applying this migration on top of the v1 migration is safe: all changes
-- use DROP IF EXISTS / CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS.

-- ─── 1. Tighten RLS on snapshots ────────────────────────────────────────────

DROP POLICY IF EXISTS vss_select_members ON public.visibility_score_snapshots;
CREATE POLICY vss_select_members
  ON public.visibility_score_snapshots FOR SELECT
  TO authenticated
  USING (
    hotel_id IS NOT NULL AND public.vaiyu_is_hotel_member(hotel_id)
  );
COMMENT ON POLICY vss_select_members ON public.visibility_score_snapshots IS
  'Snapshot rows are readable only by current members of the row''s hotel. Orphan rows (hotel deleted) remain in the table for historical aggregates but are unreadable from the app — by design.';

-- ─── 2. Cron-health view — add 14-day grace period for new hotels ──────────

DROP VIEW IF EXISTS public.v_visibility_cron_health CASCADE;
CREATE VIEW public.v_visibility_cron_health WITH (security_invoker = on) AS
  SELECT h.id   AS hotel_id,
         h.slug AS hotel_slug,
         (SELECT MAX(s.taken_at)
            FROM public.visibility_score_snapshots s
           WHERE s.hotel_id_at_snapshot = h.id
             AND s.triggered_by = 'CRON') AS last_cron_snapshot_at,
         CASE
           -- Brand-new hotel: cron hasn't had a chance yet, don't false-alarm
           WHEN h.created_at >= now() - interval '14 days' THEN true
           -- Otherwise healthy iff a CRON snapshot exists in the last 9 days
           ELSE EXISTS (
             SELECT 1 FROM public.visibility_score_snapshots s
              WHERE s.hotel_id_at_snapshot = h.id
                AND s.triggered_by = 'CRON'
                AND s.taken_at >= now() - interval '9 days'
           )
         END AS healthy
    FROM public.hotels h
   WHERE public.vaiyu_is_hotel_member(h.id);
COMMENT ON VIEW public.v_visibility_cron_health IS
  'Per-hotel cron health. Healthy iff hotel is <14 days old (grace) OR a CRON snapshot exists in the last 9 days. last_cron_snapshot_at is the raw timestamp regardless of grace state.';
GRANT SELECT ON public.v_visibility_cron_health TO authenticated;

-- ─── 3. Snapshot delta tracking ─────────────────────────────────────────────

-- Add a compact per-signal-state map so the next snapshot can compute a real
-- diff. Stored as { signal_key: state_string } where state_string is one of:
--   "AUTO_PASS" | "AUTO_FAIL" | "EXCLUDED"
--   "UNCLAIMED" | "SELF_ATTESTED" | "MANAGER_VERIFIED"
ALTER TABLE public.visibility_score_snapshots
  ADD COLUMN IF NOT EXISTS signal_states jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.visibility_score_snapshots.signal_states IS
  'Compact per-signal-state map at snapshot time. Used by the next snapshot to compute `signals_changed`. Format: { signal_key: state_string } with state_string ∈ AUTO_PASS|AUTO_FAIL|EXCLUDED|UNCLAIMED|SELF_ATTESTED|MANAGER_VERIFIED.';

-- Helper: derive the effective per-signal-state map from a breakdown jsonb.
CREATE OR REPLACE FUNCTION public._visibility_signal_states(p_breakdown jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $$
  SELECT COALESCE(jsonb_object_agg(
           s->>'key',
           CASE
             WHEN (s->>'included')::boolean IS NOT TRUE THEN 'EXCLUDED'
             WHEN s->>'kind' = 'SELF_ATTESTED'          THEN s->>'state'
             WHEN (s->>'satisfied')::boolean            THEN 'AUTO_PASS'
             ELSE                                            'AUTO_FAIL'
           END
         ), '{}'::jsonb)
    FROM jsonb_array_elements(COALESCE(p_breakdown->'signals', '[]'::jsonb)) s;
$$;
COMMENT ON FUNCTION public._visibility_signal_states(jsonb) IS
  'Project a breakdown jsonb to a compact { signal_key: state } map for snapshot diff comparison.';

-- Replace snapshot RPC with a correct delta implementation.
CREATE OR REPLACE FUNCTION public.snapshot_visibility_score(
  p_hotel_id uuid,
  p_trigger  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_trigger     public.visibility_snapshot_trigger;
  v_score       jsonb;
  v_curr_states jsonb;
  v_prev        public.visibility_score_snapshots;
  v_changed     jsonb := '[]'::jsonb;
  v_id          uuid;
  v_rate_key    text;
  v_recent      int;
  v_is_member   boolean;
  v_is_manager  boolean;
BEGIN
  -- Validate enum
  BEGIN
    v_trigger := p_trigger::public.visibility_snapshot_trigger;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'INVALID_TRIGGER';
  END;

  v_is_member  := public.vaiyu_is_hotel_member(p_hotel_id);
  v_is_manager := public.vaiyu_is_hotel_finance_manager(p_hotel_id);

  IF v_trigger = 'CRON' THEN
    IF NOT public.vaiyu_is_system_cron() THEN RAISE EXCEPTION 'CRON_FORBIDDEN'; END IF;
  ELSIF v_trigger = 'ADMIN_BACKFILL' THEN
    IF NOT public.vaiyu_is_system_cron() THEN RAISE EXCEPTION 'ADMIN_FORBIDDEN'; END IF;
  ELSIF v_trigger = 'OWNER_REFRESH' THEN
    IF NOT v_is_member THEN RAISE EXCEPTION 'NOT_A_MEMBER'; END IF;
    v_rate_key := 'visibility_refresh:' || p_hotel_id::text;
    SELECT COUNT(*) INTO v_recent FROM public.api_hits
      WHERE key = v_rate_key AND ts >= now() - interval '5 minutes';
    IF v_recent > 0 THEN RAISE EXCEPTION 'RATE_LIMIT_REFRESH'; END IF;
    INSERT INTO public.api_hits(key, fn) VALUES (v_rate_key, 'snapshot_visibility_score');
  ELSIF v_trigger = 'MANAGER_REFRESH' THEN
    IF NOT v_is_manager THEN RAISE EXCEPTION 'NOT_A_MANAGER'; END IF;
    v_rate_key := 'visibility_refresh:' || p_hotel_id::text;
    SELECT COUNT(*) INTO v_recent FROM public.api_hits
      WHERE key = v_rate_key AND ts >= now() - interval '1 minute';
    IF v_recent > 0 THEN RAISE EXCEPTION 'RATE_LIMIT_REFRESH'; END IF;
    INSERT INTO public.api_hits(key, fn) VALUES (v_rate_key, 'snapshot_visibility_score');
  END IF;

  -- Compute current breakdown + state map
  v_score := public._compute_visibility_score(p_hotel_id);
  v_curr_states := public._visibility_signal_states(v_score);

  -- Find prior snapshot (delta target)
  SELECT * INTO v_prev
    FROM public.visibility_score_snapshots
   WHERE hotel_id_at_snapshot = p_hotel_id
   ORDER BY taken_at DESC
   LIMIT 1;

  IF FOUND THEN
    -- Diff prior signal_states vs current. Emit one row per key whose state changed.
    WITH prev AS (
      SELECT key, value AS prev_state
        FROM jsonb_each_text(COALESCE(v_prev.signal_states, '{}'::jsonb))
    ),
    curr AS (
      SELECT key, value AS curr_state
        FROM jsonb_each_text(COALESCE(v_curr_states, '{}'::jsonb))
    ),
    diffs AS (
      SELECT COALESCE(p.key, c.key) AS key,
             p.prev_state,
             c.curr_state
        FROM prev p FULL OUTER JOIN curr c USING (key)
       WHERE COALESCE(p.prev_state, '__none__') <> COALESCE(c.curr_state, '__none__')
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'key', key,
             'before', prev_state,
             'after', curr_state)), '[]'::jsonb)
      INTO v_changed FROM diffs;
  END IF;

  INSERT INTO public.visibility_score_snapshots(
    hotel_id, hotel_id_at_snapshot, formula_version,
    total_score, band, category_scores,
    signals_satisfied, signals_total, signals_excluded,
    previous_score, signals_changed, signal_states,
    triggered_by, triggered_by_user
  ) VALUES (
    p_hotel_id, p_hotel_id, (v_score->>'version')::int,
    (v_score->>'total_score')::numeric,
    v_score->>'band',
    v_score->'category_scores',
    (v_score->>'signals_satisfied')::int,
    (v_score->>'signals_total')::int,
    COALESCE((v_score->>'signals_excluded')::int, 0),
    CASE WHEN v_prev.taken_at IS NOT NULL THEN v_prev.total_score ELSE NULL END,
    v_changed,
    v_curr_states,
    v_trigger,
    CASE WHEN v_trigger IN ('CRON','ADMIN_BACKFILL') THEN NULL ELSE auth.uid() END
  ) RETURNING id INTO v_id;

  INSERT INTO public.va_audit_logs(action, actor, hotel_id, entity, entity_id, meta)
  VALUES (
    'visibility_snapshot_taken',
    COALESCE(auth.uid()::text, 'system'),
    p_hotel_id,
    'visibility_snapshot',
    v_id,
    jsonb_build_object(
      'trigger', v_trigger,
      'total_score', (v_score->>'total_score')::numeric,
      'band', v_score->>'band',
      'previous_score', v_prev.total_score,
      'formula_version', (v_score->>'version')::int,
      'changed_count', jsonb_array_length(v_changed)
    )
  );

  RETURN jsonb_build_object(
    'snapshot_id', v_id,
    'total_score', (v_score->>'total_score')::numeric,
    'band', v_score->>'band',
    'changed', v_changed
  );
END;
$$;
COMMENT ON FUNCTION public.snapshot_visibility_score(uuid, text) IS
  'Writes a snapshot row with correct delta tracking. Diffs current per-signal-state map against prior snapshot''s signal_states and stores the result in signals_changed.';

-- ─── 4. Daily auto-degrade of expired manager-verifications ────────────────

CREATE OR REPLACE FUNCTION public._degrade_expired_visibility_attestations()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  r record;
  v_count int := 0;
BEGIN
  -- Only allowed from system cron (or postgres direct) — never user-callable
  IF NOT public.vaiyu_is_system_cron() THEN
    RAISE EXCEPTION 'CRON_FORBIDDEN';
  END IF;

  FOR r IN
    SELECT id, hotel_id, signal_key, manager_verified_by, manager_verified_at
      FROM public.hotel_visibility_attestations
     WHERE state = 'MANAGER_VERIFIED'
       AND manager_verified_at < now() - interval '90 days'
  LOOP
    UPDATE public.hotel_visibility_attestations
       SET state = 'SELF_ATTESTED',
           manager_verified_by = NULL,
           manager_verified_at = NULL,
           manager_note = NULL
     WHERE id = r.id;

    INSERT INTO public.va_audit_logs(action, actor, hotel_id, entity, entity_id, meta)
    VALUES (
      'visibility_attestation_auto_degraded',
      'system',
      r.hotel_id,
      'visibility_attestation',
      r.id,
      jsonb_build_object(
        'signal_key', r.signal_key,
        'previous_verifier', r.manager_verified_by,
        'verified_at', r.manager_verified_at,
        'reason', '90-day verification expiry'
      )
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
COMMENT ON FUNCTION public._degrade_expired_visibility_attestations() IS
  'Daily-run sweep that demotes MANAGER_VERIFIED rows older than 90 days back to SELF_ATTESTED with an audit event. Read-time degradation in _compute_visibility_score is already correct; this keeps DB state consistent with score and produces audit visibility on the 90-day boundary.';

-- Daily cron at 02:30 UTC (08:00 IST), avoids the 21:30 UTC weekly snapshot slot
DO $$ BEGIN
  PERFORM cron.schedule(
    'visibility_attestation_daily_degrade',
    '30 2 * * *',
    $cron$
      DO $inner$
      BEGIN
        PERFORM public._degrade_expired_visibility_attestations();
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.va_audit_logs(action, actor, entity, meta)
        VALUES ('visibility_degrade_cron_error', 'system', 'visibility_attestation',
                jsonb_build_object('error', SQLERRM));
      END
      $inner$;
    $cron$
  );
EXCEPTION WHEN duplicate_object OR unique_violation THEN
  NULL;
END $$;

-- ─── 5. Explicit IS NOT NULL guard in unverify lock check ──────────────────

CREATE OR REPLACE FUNCTION public.manager_unverify_attestation(
  p_hotel_id   uuid,
  p_signal_key text,
  p_reason     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_existing public.hotel_visibility_attestations;
  v_id       uuid;
  v_is_admin boolean;
BEGIN
  IF NOT public.vaiyu_is_hotel_finance_manager(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_A_MANAGER';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  SELECT * INTO v_existing
    FROM public.hotel_visibility_attestations
   WHERE hotel_id = p_hotel_id AND signal_key = p_signal_key
   FOR UPDATE;
  IF NOT FOUND OR v_existing.state <> 'MANAGER_VERIFIED' THEN
    RAISE EXCEPTION 'NOTHING_TO_UNVERIFY';
  END IF;

  -- Lock rule, explicit: only the verifying manager OR platform_admin
  -- can unverify. If the verifier was deleted (manager_verified_by IS NULL
  -- via auth.users cascade), the lock cannot apply and any manager may
  -- unverify — this is documented behaviour.
  v_is_admin := public.vaiyu_is_system_cron();
  IF NOT v_is_admin
     AND v_existing.manager_verified_by IS NOT NULL
     AND v_existing.manager_verified_by <> auth.uid()
  THEN
    RAISE EXCEPTION 'ATTESTATION_LOCKED';
  END IF;

  UPDATE public.hotel_visibility_attestations SET
    state = 'SELF_ATTESTED',
    manager_verified_by = NULL,
    manager_verified_at = NULL,
    manager_note = NULL
   WHERE id = v_existing.id
   RETURNING id INTO v_id;

  INSERT INTO public.va_audit_logs(action, actor, hotel_id, entity, entity_id, meta)
  VALUES (
    'visibility_attestation_manager_unverified',
    auth.uid()::text,
    p_hotel_id,
    'visibility_attestation',
    v_id,
    jsonb_build_object('signal_key', p_signal_key, 'reason', p_reason)
  );

  RETURN jsonb_build_object('id', v_id, 'state', 'SELF_ATTESTED');
END;
$$;
