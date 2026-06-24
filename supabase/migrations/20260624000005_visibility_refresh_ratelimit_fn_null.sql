-- 20260624000005_visibility_refresh_ratelimit_fn_null.sql
--
-- WHY: snapshot_visibility_score() uses public.api_hits as a refresh rate-limiter
-- (key 'visibility_refresh:<hotel>', read with a windowed COUNT on key+ts). But it
-- wrote those rate-limit rows with fn = 'snapshot_visibility_score' — non-NULL fn.
--
-- The owner "System Health · 24h" card (v_api_24h / v_api_top_fns_24h) treats
-- "fn IS NOT NULL" as the discriminator for REAL edge-function telemetry (see
-- 20260621000003). So every owner/manager "refresh visibility" click leaked into
-- the card as a phantom edge function `snapshot_visibility_score` with 0 ms latency
-- (ms is NULL on these rows) and inflated the 24h call count. It is a rate-limiter
-- row masquerading as telemetry — a violation of that contract.
--
-- FIX: write the rate-limit row with fn left NULL (like every other limiter, incl.
-- va_rate_limit_hit which writes only `key`). The rate-limit READ is unaffected —
-- it filters on key + ts only, never fn — and visibility refreshes remain fully
-- audited via va_audit_logs('visibility_snapshot_taken'), which this function still
-- writes. Nothing reads fn = 'snapshot_visibility_score' (verified across supabase/
-- + web/), so no consumer regresses.
--
-- This CREATE OR REPLACE is byte-identical to the live definition (= 20260601000001)
-- except the two INSERT lines (fn dropped); confirmed by programmatic diff before
-- authoring. Idempotent and safe on fresh DB / prod / re-run.

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
    INSERT INTO public.api_hits(key) VALUES (v_rate_key);
  ELSIF v_trigger = 'MANAGER_REFRESH' THEN
    IF NOT v_is_manager THEN RAISE EXCEPTION 'NOT_A_MANAGER'; END IF;
    v_rate_key := 'visibility_refresh:' || p_hotel_id::text;
    SELECT COUNT(*) INTO v_recent FROM public.api_hits
      WHERE key = v_rate_key AND ts >= now() - interval '1 minute';
    IF v_recent > 0 THEN RAISE EXCEPTION 'RATE_LIMIT_REFRESH'; END IF;
    INSERT INTO public.api_hits(key) VALUES (v_rate_key);
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
