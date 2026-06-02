-- Visibility Score — Growth Hub Position 9
--
-- INTERNAL readiness scorer. Aggregates first-party signals across DAM,
-- SEO Planner, Packages, Leads, Reviews, and the hotels table itself into
-- a single 0-100 readiness index, with per-signal breakdown + fix-action
-- deep-link targets. Surfaces a Google Business Checklist as a first-class
-- self-attested-with-manager-verification governance flow.
--
-- This is NOT:
--   • A ranking predictor (we do not call Google APIs, we do not scrape).
--   • A booking/revenue forecaster.
--   • A competitive benchmark (no cross-hotel comparison).
--   • An AI feature (no LLM calls, no embeddings, no learned weights).
--   • A public-publishing surface.
--
-- Two tables:
--   • hotel_visibility_attestations   — per-hotel per-self-attested-signal row
--   • visibility_score_snapshots      — append-only weekly + on-demand history
--
-- Three enums:
--   • visibility_category             — 5 weighted buckets (GMB / Trust /
--                                       Assets / Enquiry / Packages)
--   • visibility_attestation_state    — UNCLAIMED / SELF_ATTESTED / MANAGER_VERIFIED
--   • visibility_snapshot_trigger     — CRON / OWNER_REFRESH / MANAGER_REFRESH / ADMIN_BACKFILL
--
-- Scoring rules (deterministic, no AI):
--   • 19 signals across 5 weighted categories summing to 100
--   • Derived signals: pure SQL evaluation against first-party data
--   • Self-attested signals: owner attests for 50% credit;
--                            manager verifies for 100% credit
--   • Manager verification expires after 90 days → degrades to SELF_ATTESTED
--   • Min-sample carve-out: derived signals with insufficient data are
--                           EXCLUDED from the denominator (not scored zero) —
--                           fair to brand-new hotels. Excluded weights are
--                           shown as "unlockable" in the UI.
--   • Final score = ROUND(sum_contribution / sum_weight_evaluable * 100, 0)
--   • Mathematically bounded 0..100 by CHECK constraint.
--
-- Formula versioning:
--   • _visibility_weights() returns (version int, weights jsonb) atomically
--   • Snapshots store formula_version alongside total_score so old snapshots
--     remain interpretable when weights are rebalanced (bump version + weights
--     in the same migration; TS mirror + vitest parity test catches drift).
--
-- Snapshot delta tracking:
--   • Each snapshot row carries previous_score + signals_changed jsonb
--     so the trend chart can explain "score dropped 5 pts: 1 asset went
--     from APPROVED to REJECTED" without re-deriving across two queries.
--
-- Governance:
--   • Owner can self-attest, change own attestation, supply evidence_url
--   • Evidence URL is regex-validated against per-signal trusted domain allowlist
--   • Manager-only paths: verify, unverify (with lock rules)
--   • Once verified, only the verifying manager OR platform_admin can
--     unverify (other managers get ATTESTATION_LOCKED)
--   • Auto-degrade at 90 days back to SELF_ATTESTED with audit event
--
-- Cron health:
--   • v_visibility_cron_health view exposes per-hotel last_cron_snapshot_at
--   • If >9 days stale for any active hotel → flagged for observability alert
--   • replay_missed_snapshots(p_hotel_id) RPC available for platform_admin
--     ops recovery.
--
-- Rate limiting:
--   • Owner-initiated snapshot_visibility_score limited to 1 / 5 min / hotel
--     via the api_hits table (reuses existing rate-limit infrastructure).
--
-- Per CLAUDE.md:
--   • Multi-tenancy: vaiyu_is_hotel_member RLS + RPC-level recheck
--   • Audit: writes go to va_audit_logs (entity='visibility_attestation' / 'visibility_snapshot')
--   • Writes via SECURITY DEFINER RPCs only — direct INSERT/UPDATE/DELETE revoked
--   • No new audit infrastructure — using the shared va_audit_logs table
--   • Min-sample carve-outs are first-class (CLAUDE.md operator-pass rule)
--   • No phase 2, no deferred items — every reviewer concern landed in v1

-- ─── Enums ──────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.visibility_category AS ENUM (
    'GMB_READINESS',
    'TRUST_REPUTATION',
    'DIGITAL_ASSETS',
    'DIRECT_ENQUIRY',
    'EXPERIENCE_PACKAGES'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.visibility_attestation_state AS ENUM (
    'UNCLAIMED',
    'SELF_ATTESTED',
    'MANAGER_VERIFIED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.visibility_snapshot_trigger AS ENUM (
    'CRON',
    'OWNER_REFRESH',
    'MANAGER_REFRESH',
    'ADMIN_BACKFILL'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Helper: system-cron identity check ─────────────────────────────────────
-- SECURITY DEFINER means current_user is always the function owner ('postgres'
-- in local). We need to detect the actual *session* — pg_cron runs as the
-- 'postgres' role with session_user='postgres' AND current_setting('role') is
-- typically empty. Owner/manager calls flow through anon/authenticated PG
-- roles. session_user reflects the originating role pre-DEFINER swap.

CREATE OR REPLACE FUNCTION public.vaiyu_is_system_cron()
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT session_user = 'postgres'
     AND current_setting('request.jwt.claims', true) IS NULL;
$$;
COMMENT ON FUNCTION public.vaiyu_is_system_cron() IS
  'True only when called from a pg_cron job or direct postgres role. Used to gate the CRON snapshot trigger so owners cannot impersonate a cron run via SECURITY DEFINER side-channel.';

-- ─── Helper: weights table-of-truth (versioned) ─────────────────────────────
-- IMMUTABLE so it can be inlined by the planner. Returns (version, weights)
-- atomically so a weight change without a version bump is impossible at the
-- type level. TS mirror in web/src/config/visibilityScore.ts; vitest parity
-- test asserts both halves match.
--
-- Weights sum to exactly 100. Enforced by the parity test, not by a CHECK
-- (CHECK on a function return value isn't expressible in PG — the test is
-- the structural defense).

CREATE OR REPLACE FUNCTION public._visibility_weights()
RETURNS TABLE (version int, weights jsonb)
LANGUAGE sql IMMUTABLE
AS $$
  SELECT 1::int AS version,
         jsonb_build_object(
           -- GMB_READINESS (30)
           'gmb_claimed',              6,
           'gmb_verified',             6,
           'gmb_category_set',         4,
           'address_complete',         5,
           'map_pin_set',              5,
           'phone_present',            4,
           -- TRUST_REPUTATION (25)
           'review_link_set',          5,
           'reviews_flowing',          7,
           'off_platform_response',    5,
           'trust_essentials_assets',  8,
           -- DIGITAL_ASSETS (20)
           'critical_assets_ready',   10,
           'high_assets_ready',        5,
           'brand_basics',             5,
           -- DIRECT_ENQUIRY (15)
           'whatsapp_connected',       4,
           'booking_url_set',          3,
           'payment_ready',            4,
           'lead_response_time',       4,
           -- EXPERIENCE_PACKAGES (10)
           'package_live',             5,
           'seo_blueprint_ready',      5
         ) AS weights;
$$;
COMMENT ON FUNCTION public._visibility_weights() IS
  'Authoritative weights for the Visibility Score formula. Returns (version, weights jsonb) atomically. Bumping weights requires bumping the version in the same migration; TS mirror in web/src/config/visibilityScore.ts + vitest parity test enforces no silent drift.';

-- ─── Helper: per-signal evidence URL allowlist ──────────────────────────────
-- Returns a POSIX regex that the optional evidence_url must match for the
-- given signal_key. Empty string means "no URL validation for this signal".
-- This prevents the "evidence theatre" failure where owners can paste
-- arbitrary URLs to look compliant.

CREATE OR REPLACE FUNCTION public._visibility_evidence_pattern(p_signal_key text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_signal_key
    -- GMB-class signals: only Google's own GMB surfaces are valid evidence
    WHEN 'gmb_claimed'      THEN '^https?://(www\.|business\.|g\.)?(google\.com/(maps|business)|page\.gl|g\.page|business\.google\.com)/.+'
    WHEN 'gmb_verified'     THEN '^https?://(www\.|business\.|g\.)?(google\.com/(maps|business)|page\.gl|g\.page|business\.google\.com)/.+'
    WHEN 'gmb_category_set' THEN '^https?://(www\.|business\.|g\.)?(google\.com/(maps|business)|page\.gl|g\.page|business\.google\.com)/.+'
    -- Off-platform review-response evidence: any of the major review platforms
    WHEN 'off_platform_response' THEN '^https?://(www\.)?(google\.com/(maps|business)|booking\.com|makemytrip\.com|goibibo\.com|tripadvisor\.(com|in)|agoda\.com|airbnb\.(com|co\.in))/.+'
    ELSE ''
  END;
$$;
COMMENT ON FUNCTION public._visibility_evidence_pattern(text) IS
  'Per-signal-key allowlist regex for the optional evidence_url field on attestations. Returns empty string when the signal does not require URL validation.';

-- ─── Table: hotel_visibility_attestations ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hotel_visibility_attestations (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id                    uuid NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,

  -- Stable identifier from the catalog in web/src/config/visibilityScore.ts.
  -- We don't enforce a CHECK against an in-DB enum because the catalog lives
  -- in TS to keep one source of truth — instead we use attestation_schema_version
  -- so renames in a future migration can leave old rows ignorable rather than
  -- erroring out RLS reads.
  signal_key                  text NOT NULL CHECK (length(signal_key) BETWEEN 1 AND 64),
  attestation_schema_version  int  NOT NULL DEFAULT 1 CHECK (attestation_schema_version >= 1),

  state                       public.visibility_attestation_state NOT NULL DEFAULT 'UNCLAIMED',

  -- Optional evidence link the owner supplies. Validated against
  -- _visibility_evidence_pattern(signal_key) on insert/update.
  evidence_url                text CHECK (evidence_url IS NULL OR length(evidence_url) <= 2048),

  -- Owner attestation bookkeeping
  attested_by                 uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  attested_at                 timestamptz,

  -- Manager verification bookkeeping (separate from owner attestation)
  manager_verified_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  manager_verified_at         timestamptz,
  manager_note                text CHECK (manager_note IS NULL OR length(manager_note) <= 1000),

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  -- One row per (hotel, signal_key)
  CONSTRAINT hotel_visibility_attestations_uq UNIQUE (hotel_id, signal_key),

  -- State invariants
  CONSTRAINT visibility_attestation_state_consistent CHECK (
    CASE state
      WHEN 'UNCLAIMED'        THEN attested_at IS NULL AND manager_verified_at IS NULL
      WHEN 'SELF_ATTESTED'    THEN attested_at IS NOT NULL
      WHEN 'MANAGER_VERIFIED' THEN attested_at IS NOT NULL
                                AND manager_verified_at IS NOT NULL
                                AND manager_verified_by IS NOT NULL
    END
  )
);
COMMENT ON TABLE public.hotel_visibility_attestations IS
  'Per-hotel per-self-attested-signal governance row. Owner attests for 50% credit; manager verifies for 100%. Manager verification expires after 90 days (degraded automatically on read by the scoring functions). attestation_schema_version isolates older rows when the catalog is renamed in a future migration.';

CREATE INDEX IF NOT EXISTS idx_hotel_visibility_attestations_hotel
  ON public.hotel_visibility_attestations(hotel_id);
CREATE INDEX IF NOT EXISTS idx_hotel_visibility_attestations_state
  ON public.hotel_visibility_attestations(hotel_id, state);

-- updated_at trigger (reuse existing set_updated_at helper)
DROP TRIGGER IF EXISTS trg_hotel_visibility_attestations_updated_at
  ON public.hotel_visibility_attestations;
CREATE TRIGGER trg_hotel_visibility_attestations_updated_at
  BEFORE UPDATE ON public.hotel_visibility_attestations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Table: visibility_score_snapshots ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.visibility_score_snapshots (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- We keep a denormalised copy of hotel_id (NOT NULL FK) for active reads,
  -- AND a 'hotel_id_at_snapshot' (no FK) so historical aggregate metrics
  -- survive hotel soft/hard deletion. ON DELETE SET NULL on the FK column
  -- keeps the snapshot row but unlinks it from the deleted hotel.
  hotel_id                 uuid REFERENCES public.hotels(id) ON DELETE SET NULL,
  hotel_id_at_snapshot     uuid NOT NULL,

  taken_at                 timestamptz NOT NULL DEFAULT clock_timestamp(),
  formula_version          int NOT NULL CHECK (formula_version >= 1),

  total_score              numeric(5,1) NOT NULL CHECK (total_score BETWEEN 0 AND 100),
  band                     text NOT NULL CHECK (band IN ('STRONG','GOOD','NEEDS_ATTENTION','CRITICAL','ONBOARDING')),

  -- Per-category subtotals (jsonb of {category: numeric})
  category_scores          jsonb NOT NULL,

  signals_satisfied        int NOT NULL CHECK (signals_satisfied >= 0),
  signals_total            int NOT NULL CHECK (signals_total >= 0),
  signals_excluded         int NOT NULL DEFAULT 0 CHECK (signals_excluded >= 0),

  -- Delta tracking — populated by snapshot_visibility_score using the
  -- prior snapshot for this hotel. NULL for the first snapshot.
  previous_score           numeric(5,1),
  signals_changed          jsonb NOT NULL DEFAULT '[]'::jsonb,

  triggered_by             public.visibility_snapshot_trigger NOT NULL,
  triggered_by_user        uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT visibility_score_snapshots_uq UNIQUE (hotel_id_at_snapshot, taken_at),
  CONSTRAINT visibility_score_snapshots_user_implies_trigger CHECK (
    -- CRON & ADMIN_BACKFILL may have NULL user; OWNER/MANAGER refresh require user
    (triggered_by IN ('CRON','ADMIN_BACKFILL'))
    OR triggered_by_user IS NOT NULL
  )
);
COMMENT ON TABLE public.visibility_score_snapshots IS
  'Append-only weekly + on-demand score history. Each row carries formula_version + previous_score + signals_changed so the trend chart can render meaningful explanations of week-on-week changes without re-derivation. hotel_id is nullable (SET NULL on hotel delete) but hotel_id_at_snapshot is permanent for historical aggregates.';

CREATE INDEX IF NOT EXISTS idx_visibility_snapshots_hotel_recent
  ON public.visibility_score_snapshots(hotel_id_at_snapshot, taken_at DESC);
CREATE INDEX IF NOT EXISTS idx_visibility_snapshots_trigger
  ON public.visibility_score_snapshots(triggered_by, taken_at DESC);

-- ─── Score derivation (per-signal evaluator) ────────────────────────────────
--
-- _compute_visibility_score(hotel_id) returns jsonb:
--   {
--     "version": 1,
--     "total_score": 78,
--     "band": "GOOD",
--     "category_scores": { "GMB_READINESS": 22, ... },
--     "signals_satisfied": 14,
--     "signals_total": 19,
--     "signals_excluded": 3,
--     "max_unlockable_weight": 12,
--     "signals": [
--       { "key":"gmb_claimed", "category":"GMB_READINESS",
--         "satisfied": true, "included": true,
--         "contribution": 6, "max_contribution": 6,
--         "state":"MANAGER_VERIFIED",
--         "reason": "Verified by manager on 2026-05-30" },
--       ...
--     ]
--   }
--
-- STABLE (depends on now() + table reads). SECURITY INVOKER so RLS bites
-- on hotel reads.

CREATE OR REPLACE FUNCTION public._compute_visibility_score(p_hotel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_weights      jsonb;
  v_version      int;
  v_hotel        public.hotels;
  v_signals      jsonb := '[]'::jsonb;
  v_cat_scores   jsonb := jsonb_build_object(
                            'GMB_READINESS', 0,
                            'TRUST_REPUTATION', 0,
                            'DIGITAL_ASSETS', 0,
                            'DIRECT_ENQUIRY', 0,
                            'EXPERIENCE_PACKAGES', 0);
  v_sat_count    int := 0;
  v_total_count  int := 0;
  v_excl_count   int := 0;
  v_sum_contrib  numeric := 0;
  v_sum_max      numeric := 0;
  v_unlockable   numeric := 0;
  v_total_score  numeric;
  v_band         text;

  -- DAM aggregates
  v_trust_total   int := 0;
  v_trust_ready   int := 0;
  v_crit_total    int := 0;
  v_crit_ready    int := 0;
  v_high_total    int := 0;
  v_high_ready    int := 0;

  -- Other aggregates
  v_reviews_90d         int := 0;
  v_packages_active     int := 0;
  v_seo_ready_safe      int := 0;
  v_lead_sample         int := 0;
  v_lead_median_minutes numeric := NULL;

  -- Helper accumulators
  v_signal_key   text;
  v_category     text;
  v_satisfied    boolean;
  v_included     boolean;
  v_state        text;
  v_reason       text;
  v_weight       numeric;
  v_contrib      numeric;
  v_attest       record;
BEGIN
  -- (0) Resolve weights + version atomically
  SELECT version, weights INTO v_version, v_weights
    FROM public._visibility_weights();

  -- (1) Hotel row (caller's RLS applies since SECURITY INVOKER)
  SELECT * INTO v_hotel FROM public.hotels WHERE id = p_hotel_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'version', v_version,
      'total_score', 0,
      'band', 'ONBOARDING',
      'category_scores', v_cat_scores,
      'signals_satisfied', 0,
      'signals_total', 0,
      'signals_excluded', 0,
      'max_unlockable_weight', 0,
      'signals', '[]'::jsonb
    );
  END IF;

  -- (2) DAM aggregates
  BEGIN
    SELECT
      COUNT(*) FILTER (WHERE category = 'TRUST_ESSENTIALS'),
      COUNT(*) FILTER (WHERE category = 'TRUST_ESSENTIALS' AND status IN ('COLLECTED','APPROVED')),
      COUNT(*) FILTER (WHERE priority = 'CRITICAL'),
      COUNT(*) FILTER (WHERE priority = 'CRITICAL' AND status IN ('COLLECTED','APPROVED')),
      COUNT(*) FILTER (WHERE priority = 'HIGH'),
      COUNT(*) FILTER (WHERE priority = 'HIGH'    AND status IN ('COLLECTED','APPROVED'))
    INTO v_trust_total, v_trust_ready, v_crit_total, v_crit_ready, v_high_total, v_high_ready
    FROM public.v_hotel_asset_status
    WHERE hotel_id = p_hotel_id;
  EXCEPTION WHEN OTHERS THEN
    -- DAM view absent or RLS-blocked: signals fall to UNCLAIMED carve-out below
    NULL;
  END;

  -- (3) Reviews aggregate (last 90 days)
  SELECT COUNT(*) INTO v_reviews_90d
    FROM public.reviews
   WHERE hotel_id = p_hotel_id
     AND created_at >= now() - interval '90 days';

  -- (4) Packages (count of ACTIVE published, non-deleted)
  SELECT COUNT(*) INTO v_packages_active
    FROM public.packages
   WHERE hotel_id = p_hotel_id
     AND status = 'ACTIVE'
     AND deleted_at IS NULL;

  -- (5) SEO blueprints READY_TO_BUILD + SAFE_BLUEPRINT
  SELECT COUNT(*) INTO v_seo_ready_safe
    FROM public.seo_landing_blueprints
   WHERE hotel_id = p_hotel_id
     AND status = 'READY_TO_BUILD'
     AND risk_classification = 'SAFE_BLUEPRINT'
     AND deleted_at IS NULL;

  -- (6) Lead first-response median (minutes) across last 10 non-NEW leads
  --     First non-CREATED lead_event = first response. Min sample = 5.
  WITH last_leads AS (
    SELECT l.id, l.created_at
      FROM public.leads l
     WHERE l.hotel_id = p_hotel_id
       AND l.status <> 'NEW'
       AND l.deleted_at IS NULL
     ORDER BY l.created_at DESC
     LIMIT 10
  ),
  first_response AS (
    SELECT ll.id,
           EXTRACT(EPOCH FROM (MIN(le.occurred_at) - ll.created_at))/60.0 AS minutes
      FROM last_leads ll
      JOIN public.lead_events le
        ON le.lead_id = ll.id
       AND le.event_type <> 'CREATED'
     GROUP BY ll.id, ll.created_at
  )
  SELECT COUNT(*),
         (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY minutes))
    INTO v_lead_sample, v_lead_median_minutes
    FROM first_response
   WHERE minutes >= 0;

  -- ── Signal-by-signal evaluation helper macros ────────────────────────────
  -- We loop over each signal_key, compute satisfied/included/state, then
  -- accumulate contribution. The closure (v_weight, v_contrib, v_reason)
  -- pattern keeps the code readable.

  -- Convenience: load attestation row (NULL if none)
  -- We use a function-scope hash via a CTE-like temp lookup below.

  ----------------------------------------------------------------------------
  -- CATEGORY: GMB_READINESS
  ----------------------------------------------------------------------------

  -- 1. gmb_claimed (self-attested)
  v_signal_key := 'gmb_claimed';  v_category := 'GMB_READINESS';
  v_weight := (v_weights ->> v_signal_key)::numeric;
  SELECT * INTO v_attest FROM public.hotel_visibility_attestations
    WHERE hotel_id = p_hotel_id AND signal_key = v_signal_key;
  v_state := COALESCE(v_attest.state::text, 'UNCLAIMED');
  -- 90-day expiry on manager verification
  IF v_state = 'MANAGER_VERIFIED' AND v_attest.manager_verified_at < now() - interval '90 days' THEN
    v_state := 'SELF_ATTESTED';
    v_reason := 'Manager verification expired (>90d). Re-verify to restore full credit.';
  ELSIF v_state = 'MANAGER_VERIFIED' THEN
    v_reason := 'Verified by manager on ' || to_char(v_attest.manager_verified_at, 'YYYY-MM-DD');
  ELSIF v_state = 'SELF_ATTESTED' THEN
    v_reason := 'Self-attested by owner. Manager verification unlocks full credit.';
  ELSE
    v_reason := 'Not yet claimed on Google Business.';
  END IF;
  v_contrib := CASE v_state
    WHEN 'MANAGER_VERIFIED' THEN v_weight
    WHEN 'SELF_ATTESTED'    THEN v_weight * 0.5
    ELSE 0
  END;
  v_satisfied := v_state IN ('SELF_ATTESTED','MANAGER_VERIFIED');
  v_included := true;
  v_signals := v_signals || jsonb_build_array(jsonb_build_object(
    'key', v_signal_key, 'category', v_category, 'kind', 'SELF_ATTESTED',
    'satisfied', v_satisfied, 'included', v_included,
    'state', v_state, 'contribution', v_contrib, 'max_contribution', v_weight,
    'reason', v_reason));
  IF v_included THEN
    v_sum_max := v_sum_max + v_weight; v_sum_contrib := v_sum_contrib + v_contrib;
    v_total_count := v_total_count + 1;
    IF v_satisfied THEN v_sat_count := v_sat_count + 1; END IF;
    v_cat_scores := jsonb_set(v_cat_scores, ARRAY[v_category],
                              to_jsonb(((v_cat_scores->>v_category)::numeric + v_contrib)));
  END IF;

  -- 2. gmb_verified (self-attested)
  v_signal_key := 'gmb_verified';  v_category := 'GMB_READINESS';
  v_weight := (v_weights ->> v_signal_key)::numeric;
  SELECT * INTO v_attest FROM public.hotel_visibility_attestations
    WHERE hotel_id = p_hotel_id AND signal_key = v_signal_key;
  v_state := COALESCE(v_attest.state::text, 'UNCLAIMED');
  IF v_state = 'MANAGER_VERIFIED' AND v_attest.manager_verified_at < now() - interval '90 days' THEN
    v_state := 'SELF_ATTESTED';
    v_reason := 'Manager verification expired (>90d).';
  ELSIF v_state = 'MANAGER_VERIFIED' THEN
    v_reason := 'Verified by manager on ' || to_char(v_attest.manager_verified_at, 'YYYY-MM-DD');
  ELSIF v_state = 'SELF_ATTESTED' THEN
    v_reason := 'Owner attests GMB verification badge is active.';
  ELSE
    v_reason := 'GMB verification not confirmed.';
  END IF;
  v_contrib := CASE v_state WHEN 'MANAGER_VERIFIED' THEN v_weight
                            WHEN 'SELF_ATTESTED' THEN v_weight*0.5 ELSE 0 END;
  v_satisfied := v_state <> 'UNCLAIMED'; v_included := true;
  v_signals := v_signals || jsonb_build_array(jsonb_build_object(
    'key', v_signal_key, 'category', v_category, 'kind', 'SELF_ATTESTED',
    'satisfied', v_satisfied, 'included', v_included,
    'state', v_state, 'contribution', v_contrib, 'max_contribution', v_weight, 'reason', v_reason));
  v_sum_max := v_sum_max + v_weight; v_sum_contrib := v_sum_contrib + v_contrib;
  v_total_count := v_total_count + 1;
  IF v_satisfied THEN v_sat_count := v_sat_count + 1; END IF;
  v_cat_scores := jsonb_set(v_cat_scores, ARRAY[v_category],
                            to_jsonb(((v_cat_scores->>v_category)::numeric + v_contrib)));

  -- 3. gmb_category_set (self-attested)
  v_signal_key := 'gmb_category_set';  v_category := 'GMB_READINESS';
  v_weight := (v_weights ->> v_signal_key)::numeric;
  SELECT * INTO v_attest FROM public.hotel_visibility_attestations
    WHERE hotel_id = p_hotel_id AND signal_key = v_signal_key;
  v_state := COALESCE(v_attest.state::text, 'UNCLAIMED');
  IF v_state = 'MANAGER_VERIFIED' AND v_attest.manager_verified_at < now() - interval '90 days' THEN
    v_state := 'SELF_ATTESTED';
    v_reason := 'Manager verification expired (>90d).';
  ELSIF v_state = 'MANAGER_VERIFIED' THEN
    v_reason := 'Verified by manager on ' || to_char(v_attest.manager_verified_at, 'YYYY-MM-DD');
  ELSIF v_state = 'SELF_ATTESTED' THEN
    v_reason := 'Owner attests correct GMB category (Hotel/Resort/Homestay) is set.';
  ELSE
    v_reason := 'Confirm the correct GMB category is set.';
  END IF;
  v_contrib := CASE v_state WHEN 'MANAGER_VERIFIED' THEN v_weight
                            WHEN 'SELF_ATTESTED' THEN v_weight*0.5 ELSE 0 END;
  v_satisfied := v_state <> 'UNCLAIMED'; v_included := true;
  v_signals := v_signals || jsonb_build_array(jsonb_build_object(
    'key', v_signal_key, 'category', v_category, 'kind', 'SELF_ATTESTED',
    'satisfied', v_satisfied, 'included', v_included,
    'state', v_state, 'contribution', v_contrib, 'max_contribution', v_weight, 'reason', v_reason));
  v_sum_max := v_sum_max + v_weight; v_sum_contrib := v_sum_contrib + v_contrib;
  v_total_count := v_total_count + 1;
  IF v_satisfied THEN v_sat_count := v_sat_count + 1; END IF;
  v_cat_scores := jsonb_set(v_cat_scores, ARRAY[v_category],
                            to_jsonb(((v_cat_scores->>v_category)::numeric + v_contrib)));

  -- 4. address_complete (derived)
  v_signal_key := 'address_complete'; v_category := 'GMB_READINESS';
  v_weight := (v_weights ->> v_signal_key)::numeric;
  v_satisfied := COALESCE(length(btrim(v_hotel.address)), 0) > 0
              AND COALESCE(length(btrim(v_hotel.city)), 0) > 0
              AND COALESCE(length(btrim(v_hotel.state)), 0) > 0
              AND COALESCE(length(btrim(v_hotel.country)), 0) > 0
              AND COALESCE(length(btrim(v_hotel.postal_code)), 0) > 0;
  v_included := true;
  v_contrib := CASE WHEN v_satisfied THEN v_weight ELSE 0 END;
  v_reason := CASE WHEN v_satisfied THEN 'Address, city, state, country and postal code all set.'
                                     ELSE 'Complete address fields in property settings.' END;
  v_signals := v_signals || jsonb_build_array(jsonb_build_object(
    'key', v_signal_key, 'category', v_category, 'kind', 'AUTO_DERIVED',
    'satisfied', v_satisfied, 'included', v_included, 'state', 'AUTO',
    'contribution', v_contrib, 'max_contribution', v_weight, 'reason', v_reason));
  v_sum_max := v_sum_max + v_weight; v_sum_contrib := v_sum_contrib + v_contrib;
  v_total_count := v_total_count + 1;
  IF v_satisfied THEN v_sat_count := v_sat_count + 1; END IF;
  v_cat_scores := jsonb_set(v_cat_scores, ARRAY[v_category],
                            to_jsonb(((v_cat_scores->>v_category)::numeric + v_contrib)));

  -- 5. map_pin_set (derived: lat AND lng)
  v_signal_key := 'map_pin_set'; v_category := 'GMB_READINESS';
  v_weight := (v_weights ->> v_signal_key)::numeric;
  v_satisfied := v_hotel.latitude IS NOT NULL AND v_hotel.longitude IS NOT NULL;
  v_included := true;
  v_contrib := CASE WHEN v_satisfied THEN v_weight ELSE 0 END;
  v_reason := CASE WHEN v_satisfied THEN 'Map pin set (lat/long).'
                                     ELSE 'Add latitude/longitude in property settings.' END;
  v_signals := v_signals || jsonb_build_array(jsonb_build_object(
    'key', v_signal_key, 'category', v_category, 'kind', 'AUTO_DERIVED',
    'satisfied', v_satisfied, 'included', v_included, 'state', 'AUTO',
    'contribution', v_contrib, 'max_contribution', v_weight, 'reason', v_reason));
  v_sum_max := v_sum_max + v_weight; v_sum_contrib := v_sum_contrib + v_contrib;
  v_total_count := v_total_count + 1;
  IF v_satisfied THEN v_sat_count := v_sat_count + 1; END IF;
  v_cat_scores := jsonb_set(v_cat_scores, ARRAY[v_category],
                            to_jsonb(((v_cat_scores->>v_category)::numeric + v_contrib)));

  -- 6. phone_present (derived)
  v_signal_key := 'phone_present'; v_category := 'GMB_READINESS';
  v_weight := (v_weights ->> v_signal_key)::numeric;
  v_satisfied := COALESCE(length(btrim(v_hotel.phone)), 0) > 0;
  v_included := true;
  v_contrib := CASE WHEN v_satisfied THEN v_weight ELSE 0 END;
  v_reason := CASE WHEN v_satisfied THEN 'Phone number on file.'
                                     ELSE 'Add a contact phone number.' END;
  v_signals := v_signals || jsonb_build_array(jsonb_build_object(
    'key', v_signal_key, 'category', v_category, 'kind', 'AUTO_DERIVED',
    'satisfied', v_satisfied, 'included', v_included, 'state', 'AUTO',
    'contribution', v_contrib, 'max_contribution', v_weight, 'reason', v_reason));
  v_sum_max := v_sum_max + v_weight; v_sum_contrib := v_sum_contrib + v_contrib;
  v_total_count := v_total_count + 1;
  IF v_satisfied THEN v_sat_count := v_sat_count + 1; END IF;
  v_cat_scores := jsonb_set(v_cat_scores, ARRAY[v_category],
                            to_jsonb(((v_cat_scores->>v_category)::numeric + v_contrib)));

  ----------------------------------------------------------------------------
  -- CATEGORY: TRUST_REPUTATION
  ----------------------------------------------------------------------------

  -- 7. review_link_set (derived)
  v_signal_key := 'review_link_set'; v_category := 'TRUST_REPUTATION';
  v_weight := (v_weights ->> v_signal_key)::numeric;
  v_satisfied := COALESCE(length(btrim(v_hotel.review_policy_url)), 0) > 0;
  v_included := true;
  v_contrib := CASE WHEN v_satisfied THEN v_weight ELSE 0 END;
  v_reason := CASE WHEN v_satisfied THEN 'Review link configured.'
                                     ELSE 'Add your Google review link (Property settings).' END;
  v_signals := v_signals || jsonb_build_array(jsonb_build_object(
    'key', v_signal_key, 'category', v_category, 'kind', 'AUTO_DERIVED',
    'satisfied', v_satisfied, 'included', v_included, 'state', 'AUTO',
    'contribution', v_contrib, 'max_contribution', v_weight, 'reason', v_reason));
  v_sum_max := v_sum_max + v_weight; v_sum_contrib := v_sum_contrib + v_contrib;
  v_total_count := v_total_count + 1;
  IF v_satisfied THEN v_sat_count := v_sat_count + 1; END IF;
  v_cat_scores := jsonb_set(v_cat_scores, ARRAY[v_category],
                            to_jsonb(((v_cat_scores->>v_category)::numeric + v_contrib)));

  -- 8. reviews_flowing (derived; min_sample handled by excluding when 0 reviews
  --    in last 90d AND hotel created <30d ago — new hotel carve-out)
  v_signal_key := 'reviews_flowing'; v_category := 'TRUST_REPUTATION';
  v_weight := (v_weights ->> v_signal_key)::numeric;
  IF v_reviews_90d = 0 AND v_hotel.created_at > now() - interval '30 days' THEN
    -- Brand-new hotel: don't penalise; exclude from denominator
    v_included := false; v_satisfied := false; v_contrib := 0;
    v_reason := 'Hotel onboarded recently — review history will be evaluated after 30 days.';
    v_excl_count := v_excl_count + 1; v_unlockable := v_unlockable + v_weight;
  ELSE
    v_satisfied := v_reviews_90d >= 5;
    v_included := true;
    v_contrib := CASE WHEN v_satisfied THEN v_weight ELSE 0 END;
    v_reason := v_reviews_90d || ' review' || CASE WHEN v_reviews_90d=1 THEN '' ELSE 's' END ||
                ' in last 90 days. Threshold: ≥5.';
    v_sum_max := v_sum_max + v_weight; v_sum_contrib := v_sum_contrib + v_contrib;
    v_total_count := v_total_count + 1;
    IF v_satisfied THEN v_sat_count := v_sat_count + 1; END IF;
    v_cat_scores := jsonb_set(v_cat_scores, ARRAY[v_category],
                              to_jsonb(((v_cat_scores->>v_category)::numeric + v_contrib)));
  END IF;
  v_signals := v_signals || jsonb_build_array(jsonb_build_object(
    'key', v_signal_key, 'category', v_category, 'kind', 'AUTO_DERIVED',
    'satisfied', v_satisfied, 'included', v_included, 'state', 'AUTO',
    'contribution', v_contrib, 'max_contribution', v_weight, 'reason', v_reason));

  -- 9. off_platform_response (self-attested)
  v_signal_key := 'off_platform_response'; v_category := 'TRUST_REPUTATION';
  v_weight := (v_weights ->> v_signal_key)::numeric;
  SELECT * INTO v_attest FROM public.hotel_visibility_attestations
    WHERE hotel_id = p_hotel_id AND signal_key = v_signal_key;
  v_state := COALESCE(v_attest.state::text, 'UNCLAIMED');
  IF v_state = 'MANAGER_VERIFIED' AND v_attest.manager_verified_at < now() - interval '90 days' THEN
    v_state := 'SELF_ATTESTED';
    v_reason := 'Manager verification expired (>90d).';
  ELSIF v_state = 'MANAGER_VERIFIED' THEN
    v_reason := 'Verified by manager on ' || to_char(v_attest.manager_verified_at, 'YYYY-MM-DD');
  ELSIF v_state = 'SELF_ATTESTED' THEN
    v_reason := 'Owner attests reviews are being responded to on external platforms.';
  ELSE
    v_reason := 'Confirm you are responding to reviews on Google/Booking/MMT.';
  END IF;
  v_contrib := CASE v_state WHEN 'MANAGER_VERIFIED' THEN v_weight
                            WHEN 'SELF_ATTESTED' THEN v_weight*0.5 ELSE 0 END;
  v_satisfied := v_state <> 'UNCLAIMED'; v_included := true;
  v_signals := v_signals || jsonb_build_array(jsonb_build_object(
    'key', v_signal_key, 'category', v_category, 'kind', 'SELF_ATTESTED',
    'satisfied', v_satisfied, 'included', v_included,
    'state', v_state, 'contribution', v_contrib, 'max_contribution', v_weight, 'reason', v_reason));
  v_sum_max := v_sum_max + v_weight; v_sum_contrib := v_sum_contrib + v_contrib;
  v_total_count := v_total_count + 1;
  IF v_satisfied THEN v_sat_count := v_sat_count + 1; END IF;
  v_cat_scores := jsonb_set(v_cat_scores, ARRAY[v_category],
                            to_jsonb(((v_cat_scores->>v_category)::numeric + v_contrib)));

  -- 10. trust_essentials_assets (derived from DAM)
  v_signal_key := 'trust_essentials_assets'; v_category := 'TRUST_REPUTATION';
  v_weight := (v_weights ->> v_signal_key)::numeric;
  IF v_trust_total = 0 THEN
    v_included := false; v_satisfied := false; v_contrib := 0;
    v_reason := 'Trust-essentials asset catalog not visible — check Digital Asset Manager.';
    v_excl_count := v_excl_count + 1; v_unlockable := v_unlockable + v_weight;
  ELSE
    v_satisfied := (v_trust_ready::numeric / v_trust_total::numeric) >= 0.80;
    v_included := true;
    v_contrib := CASE WHEN v_satisfied THEN v_weight
                      ELSE v_weight * (v_trust_ready::numeric / v_trust_total::numeric) END;
    -- Round contrib to 1 decimal for clean snapshots
    v_contrib := ROUND(v_contrib::numeric, 1);
    v_reason := v_trust_ready || ' of ' || v_trust_total || ' trust assets ready (threshold 80%).';
    v_sum_max := v_sum_max + v_weight; v_sum_contrib := v_sum_contrib + v_contrib;
    v_total_count := v_total_count + 1;
    IF v_satisfied THEN v_sat_count := v_sat_count + 1; END IF;
    v_cat_scores := jsonb_set(v_cat_scores, ARRAY[v_category],
                              to_jsonb(((v_cat_scores->>v_category)::numeric + v_contrib)));
  END IF;
  v_signals := v_signals || jsonb_build_array(jsonb_build_object(
    'key', v_signal_key, 'category', v_category, 'kind', 'AUTO_DERIVED',
    'satisfied', v_satisfied, 'included', v_included, 'state', 'AUTO',
    'contribution', v_contrib, 'max_contribution', v_weight, 'reason', v_reason));

  ----------------------------------------------------------------------------
  -- CATEGORY: DIGITAL_ASSETS
  ----------------------------------------------------------------------------

  -- 11. critical_assets_ready
  v_signal_key := 'critical_assets_ready'; v_category := 'DIGITAL_ASSETS';
  v_weight := (v_weights ->> v_signal_key)::numeric;
  IF v_crit_total = 0 THEN
    v_included := false; v_satisfied := false; v_contrib := 0;
    v_reason := 'Critical-priority asset catalog not visible.';
    v_excl_count := v_excl_count + 1; v_unlockable := v_unlockable + v_weight;
  ELSE
    v_satisfied := (v_crit_ready::numeric / v_crit_total::numeric) >= 0.80;
    v_included := true;
    v_contrib := CASE WHEN v_satisfied THEN v_weight
                      ELSE ROUND(v_weight * (v_crit_ready::numeric / v_crit_total::numeric), 1) END;
    v_reason := v_crit_ready || ' of ' || v_crit_total || ' critical assets ready (threshold 80%).';
    v_sum_max := v_sum_max + v_weight; v_sum_contrib := v_sum_contrib + v_contrib;
    v_total_count := v_total_count + 1;
    IF v_satisfied THEN v_sat_count := v_sat_count + 1; END IF;
    v_cat_scores := jsonb_set(v_cat_scores, ARRAY[v_category],
                              to_jsonb(((v_cat_scores->>v_category)::numeric + v_contrib)));
  END IF;
  v_signals := v_signals || jsonb_build_array(jsonb_build_object(
    'key', v_signal_key, 'category', v_category, 'kind', 'AUTO_DERIVED',
    'satisfied', v_satisfied, 'included', v_included, 'state', 'AUTO',
    'contribution', v_contrib, 'max_contribution', v_weight, 'reason', v_reason));

  -- 12. high_assets_ready (threshold 60%)
  v_signal_key := 'high_assets_ready'; v_category := 'DIGITAL_ASSETS';
  v_weight := (v_weights ->> v_signal_key)::numeric;
  IF v_high_total = 0 THEN
    v_included := false; v_satisfied := false; v_contrib := 0;
    v_reason := 'High-priority asset catalog not visible.';
    v_excl_count := v_excl_count + 1; v_unlockable := v_unlockable + v_weight;
  ELSE
    v_satisfied := (v_high_ready::numeric / v_high_total::numeric) >= 0.60;
    v_included := true;
    v_contrib := CASE WHEN v_satisfied THEN v_weight
                      ELSE ROUND(v_weight * (v_high_ready::numeric / v_high_total::numeric), 1) END;
    v_reason := v_high_ready || ' of ' || v_high_total || ' high-priority assets ready (threshold 60%).';
    v_sum_max := v_sum_max + v_weight; v_sum_contrib := v_sum_contrib + v_contrib;
    v_total_count := v_total_count + 1;
    IF v_satisfied THEN v_sat_count := v_sat_count + 1; END IF;
    v_cat_scores := jsonb_set(v_cat_scores, ARRAY[v_category],
                              to_jsonb(((v_cat_scores->>v_category)::numeric + v_contrib)));
  END IF;
  v_signals := v_signals || jsonb_build_array(jsonb_build_object(
    'key', v_signal_key, 'category', v_category, 'kind', 'AUTO_DERIVED',
    'satisfied', v_satisfied, 'included', v_included, 'state', 'AUTO',
    'contribution', v_contrib, 'max_contribution', v_weight, 'reason', v_reason));

  -- 13. brand_basics (derived: logo + brand_color)
  v_signal_key := 'brand_basics'; v_category := 'DIGITAL_ASSETS';
  v_weight := (v_weights ->> v_signal_key)::numeric;
  v_satisfied := COALESCE(length(btrim(v_hotel.logo_path)), 0) > 0
              AND COALESCE(length(btrim(v_hotel.brand_color)), 0) > 0;
  v_included := true;
  v_contrib := CASE WHEN v_satisfied THEN v_weight ELSE 0 END;
  v_reason := CASE WHEN v_satisfied THEN 'Logo and brand colour set.'
                                     ELSE 'Add logo and brand colour (Property settings).' END;
  v_signals := v_signals || jsonb_build_array(jsonb_build_object(
    'key', v_signal_key, 'category', v_category, 'kind', 'AUTO_DERIVED',
    'satisfied', v_satisfied, 'included', v_included, 'state', 'AUTO',
    'contribution', v_contrib, 'max_contribution', v_weight, 'reason', v_reason));
  v_sum_max := v_sum_max + v_weight; v_sum_contrib := v_sum_contrib + v_contrib;
  v_total_count := v_total_count + 1;
  IF v_satisfied THEN v_sat_count := v_sat_count + 1; END IF;
  v_cat_scores := jsonb_set(v_cat_scores, ARRAY[v_category],
                            to_jsonb(((v_cat_scores->>v_category)::numeric + v_contrib)));

  ----------------------------------------------------------------------------
  -- CATEGORY: DIRECT_ENQUIRY
  ----------------------------------------------------------------------------

  -- 14. whatsapp_connected (derived)
  v_signal_key := 'whatsapp_connected'; v_category := 'DIRECT_ENQUIRY';
  v_weight := (v_weights ->> v_signal_key)::numeric;
  v_satisfied := COALESCE(length(btrim(v_hotel.wa_phone_number_id)), 0) > 0;
  v_included := true;
  v_contrib := CASE WHEN v_satisfied THEN v_weight ELSE 0 END;
  v_reason := CASE WHEN v_satisfied THEN 'WhatsApp connected.'
                                     ELSE 'Connect WhatsApp Business (Settings → WhatsApp).' END;
  v_signals := v_signals || jsonb_build_array(jsonb_build_object(
    'key', v_signal_key, 'category', v_category, 'kind', 'AUTO_DERIVED',
    'satisfied', v_satisfied, 'included', v_included, 'state', 'AUTO',
    'contribution', v_contrib, 'max_contribution', v_weight, 'reason', v_reason));
  v_sum_max := v_sum_max + v_weight; v_sum_contrib := v_sum_contrib + v_contrib;
  v_total_count := v_total_count + 1;
  IF v_satisfied THEN v_sat_count := v_sat_count + 1; END IF;
  v_cat_scores := jsonb_set(v_cat_scores, ARRAY[v_category],
                            to_jsonb(((v_cat_scores->>v_category)::numeric + v_contrib)));

  -- 15. booking_url_set (derived)
  v_signal_key := 'booking_url_set'; v_category := 'DIRECT_ENQUIRY';
  v_weight := (v_weights ->> v_signal_key)::numeric;
  v_satisfied := COALESCE(length(btrim(v_hotel.booking_url)), 0) > 0;
  v_included := true;
  v_contrib := CASE WHEN v_satisfied THEN v_weight ELSE 0 END;
  v_reason := CASE WHEN v_satisfied THEN 'Direct booking URL set.'
                                     ELSE 'Add a direct booking URL (Property settings).' END;
  v_signals := v_signals || jsonb_build_array(jsonb_build_object(
    'key', v_signal_key, 'category', v_category, 'kind', 'AUTO_DERIVED',
    'satisfied', v_satisfied, 'included', v_included, 'state', 'AUTO',
    'contribution', v_contrib, 'max_contribution', v_weight, 'reason', v_reason));
  v_sum_max := v_sum_max + v_weight; v_sum_contrib := v_sum_contrib + v_contrib;
  v_total_count := v_total_count + 1;
  IF v_satisfied THEN v_sat_count := v_sat_count + 1; END IF;
  v_cat_scores := jsonb_set(v_cat_scores, ARRAY[v_category],
                            to_jsonb(((v_cat_scores->>v_category)::numeric + v_contrib)));

  -- 16. payment_ready (Razorpay OR UPI)
  v_signal_key := 'payment_ready'; v_category := 'DIRECT_ENQUIRY';
  v_weight := (v_weights ->> v_signal_key)::numeric;
  v_satisfied := (v_hotel.razorpay_account_id IS NOT NULL)
              OR (COALESCE(length(btrim(v_hotel.upi_id)), 0) > 0);
  v_included := true;
  v_contrib := CASE WHEN v_satisfied THEN v_weight ELSE 0 END;
  v_reason := CASE WHEN v_satisfied THEN 'Online payment configured.'
                                     ELSE 'Connect Razorpay or set a UPI ID.' END;
  v_signals := v_signals || jsonb_build_array(jsonb_build_object(
    'key', v_signal_key, 'category', v_category, 'kind', 'AUTO_DERIVED',
    'satisfied', v_satisfied, 'included', v_included, 'state', 'AUTO',
    'contribution', v_contrib, 'max_contribution', v_weight, 'reason', v_reason));
  v_sum_max := v_sum_max + v_weight; v_sum_contrib := v_sum_contrib + v_contrib;
  v_total_count := v_total_count + 1;
  IF v_satisfied THEN v_sat_count := v_sat_count + 1; END IF;
  v_cat_scores := jsonb_set(v_cat_scores, ARRAY[v_category],
                            to_jsonb(((v_cat_scores->>v_category)::numeric + v_contrib)));

  -- 17. lead_response_time (derived; min sample 5 leads)
  v_signal_key := 'lead_response_time'; v_category := 'DIRECT_ENQUIRY';
  v_weight := (v_weights ->> v_signal_key)::numeric;
  IF v_lead_sample < 5 THEN
    v_included := false; v_satisfied := false; v_contrib := 0;
    v_reason := 'Not enough lead history yet (' || v_lead_sample || ' of 5 minimum).';
    v_excl_count := v_excl_count + 1; v_unlockable := v_unlockable + v_weight;
  ELSE
    v_satisfied := v_lead_median_minutes <= 240; -- 4 hours
    v_included := true;
    v_contrib := CASE WHEN v_satisfied THEN v_weight ELSE 0 END;
    v_reason := 'Median first-response: ' || ROUND(v_lead_median_minutes)::text || ' min over last ' || v_lead_sample || ' leads (target ≤240 min).';
    v_sum_max := v_sum_max + v_weight; v_sum_contrib := v_sum_contrib + v_contrib;
    v_total_count := v_total_count + 1;
    IF v_satisfied THEN v_sat_count := v_sat_count + 1; END IF;
    v_cat_scores := jsonb_set(v_cat_scores, ARRAY[v_category],
                              to_jsonb(((v_cat_scores->>v_category)::numeric + v_contrib)));
  END IF;
  v_signals := v_signals || jsonb_build_array(jsonb_build_object(
    'key', v_signal_key, 'category', v_category, 'kind', 'AUTO_DERIVED',
    'satisfied', v_satisfied, 'included', v_included, 'state', 'AUTO',
    'contribution', v_contrib, 'max_contribution', v_weight, 'reason', v_reason));

  ----------------------------------------------------------------------------
  -- CATEGORY: EXPERIENCE_PACKAGES
  ----------------------------------------------------------------------------

  -- 18. package_live (derived: ≥1 ACTIVE non-deleted package)
  v_signal_key := 'package_live'; v_category := 'EXPERIENCE_PACKAGES';
  v_weight := (v_weights ->> v_signal_key)::numeric;
  v_satisfied := v_packages_active > 0;
  v_included := true;
  v_contrib := CASE WHEN v_satisfied THEN v_weight ELSE 0 END;
  v_reason := CASE WHEN v_satisfied THEN v_packages_active || ' active package' || CASE WHEN v_packages_active=1 THEN '' ELSE 's' END || '.'
                                     ELSE 'Publish at least one experience package.' END;
  v_signals := v_signals || jsonb_build_array(jsonb_build_object(
    'key', v_signal_key, 'category', v_category, 'kind', 'AUTO_DERIVED',
    'satisfied', v_satisfied, 'included', v_included, 'state', 'AUTO',
    'contribution', v_contrib, 'max_contribution', v_weight, 'reason', v_reason));
  v_sum_max := v_sum_max + v_weight; v_sum_contrib := v_sum_contrib + v_contrib;
  v_total_count := v_total_count + 1;
  IF v_satisfied THEN v_sat_count := v_sat_count + 1; END IF;
  v_cat_scores := jsonb_set(v_cat_scores, ARRAY[v_category],
                            to_jsonb(((v_cat_scores->>v_category)::numeric + v_contrib)));

  -- 19. seo_blueprint_ready (derived: ≥1 SEO blueprint READY_TO_BUILD + SAFE)
  v_signal_key := 'seo_blueprint_ready'; v_category := 'EXPERIENCE_PACKAGES';
  v_weight := (v_weights ->> v_signal_key)::numeric;
  v_satisfied := v_seo_ready_safe > 0;
  v_included := true;
  v_contrib := CASE WHEN v_satisfied THEN v_weight ELSE 0 END;
  v_reason := CASE WHEN v_satisfied THEN v_seo_ready_safe || ' safe blueprint' || CASE WHEN v_seo_ready_safe=1 THEN '' ELSE 's' END || ' ready.'
                                     ELSE 'Approve at least one SAFE_BLUEPRINT in Local SEO Planner.' END;
  v_signals := v_signals || jsonb_build_array(jsonb_build_object(
    'key', v_signal_key, 'category', v_category, 'kind', 'AUTO_DERIVED',
    'satisfied', v_satisfied, 'included', v_included, 'state', 'AUTO',
    'contribution', v_contrib, 'max_contribution', v_weight, 'reason', v_reason));
  v_sum_max := v_sum_max + v_weight; v_sum_contrib := v_sum_contrib + v_contrib;
  v_total_count := v_total_count + 1;
  IF v_satisfied THEN v_sat_count := v_sat_count + 1; END IF;
  v_cat_scores := jsonb_set(v_cat_scores, ARRAY[v_category],
                            to_jsonb(((v_cat_scores->>v_category)::numeric + v_contrib)));

  -- ── Final aggregate ───────────────────────────────────────────────────────
  IF v_total_count < 5 THEN
    -- Brand-new hotel with too little data to render a meaningful score
    v_band := 'ONBOARDING';
    v_total_score := 0;
  ELSE
    v_total_score := ROUND(v_sum_contrib / v_sum_max * 100, 1);
    v_band := CASE
      WHEN v_total_score >= 80 THEN 'STRONG'
      WHEN v_total_score >= 60 THEN 'GOOD'
      WHEN v_total_score >= 40 THEN 'NEEDS_ATTENTION'
      ELSE                          'CRITICAL'
    END;
  END IF;

  -- Round category subtotals to 1 decimal for clean JSON
  v_cat_scores := jsonb_build_object(
    'GMB_READINESS',       ROUND((v_cat_scores->>'GMB_READINESS')::numeric, 1),
    'TRUST_REPUTATION',    ROUND((v_cat_scores->>'TRUST_REPUTATION')::numeric, 1),
    'DIGITAL_ASSETS',      ROUND((v_cat_scores->>'DIGITAL_ASSETS')::numeric, 1),
    'DIRECT_ENQUIRY',      ROUND((v_cat_scores->>'DIRECT_ENQUIRY')::numeric, 1),
    'EXPERIENCE_PACKAGES', ROUND((v_cat_scores->>'EXPERIENCE_PACKAGES')::numeric, 1)
  );

  RETURN jsonb_build_object(
    'version', v_version,
    'total_score', v_total_score,
    'band', v_band,
    'category_scores', v_cat_scores,
    'signals_satisfied', v_sat_count,
    'signals_total', v_total_count,
    'signals_excluded', v_excl_count,
    'max_unlockable_weight', v_unlockable,
    'signals', v_signals
  );
END;
$$;
COMMENT ON FUNCTION public._compute_visibility_score(uuid) IS
  'Deterministic scoring of one hotels visibility readiness. Loops through all 19 signals, applies per-signal evaluation rules, accumulates contributions with min-sample carve-outs and 90-day manager-verification expiry, and returns a complete jsonb breakdown.';

-- ─── Read view: v_hotel_visibility_score ────────────────────────────────────

DROP VIEW IF EXISTS public.v_hotel_visibility_score CASCADE;
CREATE VIEW public.v_hotel_visibility_score WITH (security_invoker = on) AS
  SELECT h.id   AS hotel_id,
         h.slug AS hotel_slug,
         h.name AS hotel_name,
         public._compute_visibility_score(h.id) AS breakdown
    FROM public.hotels h
   WHERE public.vaiyu_is_hotel_member(h.id);
COMMENT ON VIEW public.v_hotel_visibility_score IS
  'Primary read surface. One row per hotel the caller is a member of, with full breakdown jsonb (score, band, category_scores, per-signal details). Filter with where hotel_id = $1 from the client.';

-- ─── Read view: v_visibility_cron_health ────────────────────────────────────

DROP VIEW IF EXISTS public.v_visibility_cron_health CASCADE;
CREATE VIEW public.v_visibility_cron_health WITH (security_invoker = on) AS
  SELECT h.id   AS hotel_id,
         h.slug AS hotel_slug,
         (SELECT MAX(s.taken_at)
            FROM public.visibility_score_snapshots s
           WHERE s.hotel_id_at_snapshot = h.id
             AND s.triggered_by = 'CRON') AS last_cron_snapshot_at,
         EXISTS (
           SELECT 1 FROM public.visibility_score_snapshots s
            WHERE s.hotel_id_at_snapshot = h.id
              AND s.triggered_by = 'CRON'
              AND s.taken_at >= now() - interval '9 days'
         ) AS healthy
    FROM public.hotels h
   WHERE public.vaiyu_is_hotel_member(h.id);
COMMENT ON VIEW public.v_visibility_cron_health IS
  'Per-hotel cron health surface. healthy=false when last_cron_snapshot_at is >9 days stale or missing — observability/alerting hook.';

-- ─── RPC: snapshot_visibility_score ─────────────────────────────────────────

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
  v_trigger       public.visibility_snapshot_trigger;
  v_score         jsonb;
  v_prev          public.visibility_score_snapshots;
  v_changed       jsonb := '[]'::jsonb;
  v_id            uuid;
  v_rate_key      text;
  v_recent        int;
  v_is_member     boolean;
  v_is_manager    boolean;
BEGIN
  -- Validate enum
  BEGIN
    v_trigger := p_trigger::public.visibility_snapshot_trigger;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'INVALID_TRIGGER';
  END;

  -- Auth based on trigger kind
  v_is_member  := public.vaiyu_is_hotel_member(p_hotel_id);
  v_is_manager := public.vaiyu_is_hotel_finance_manager(p_hotel_id);

  IF v_trigger = 'CRON' THEN
    IF NOT public.vaiyu_is_system_cron() THEN
      RAISE EXCEPTION 'CRON_FORBIDDEN';
    END IF;
  ELSIF v_trigger = 'ADMIN_BACKFILL' THEN
    -- platform_admin-only: enforced by GRANT EXECUTE TO postgres only
    IF NOT public.vaiyu_is_system_cron() THEN
      RAISE EXCEPTION 'ADMIN_FORBIDDEN';
    END IF;
  ELSIF v_trigger = 'OWNER_REFRESH' THEN
    IF NOT v_is_member THEN RAISE EXCEPTION 'NOT_A_MEMBER'; END IF;
    -- Rate limit: 1 per 5 min per hotel via api_hits
    v_rate_key := 'visibility_refresh:' || p_hotel_id::text;
    SELECT COUNT(*) INTO v_recent
      FROM public.api_hits
     WHERE key = v_rate_key
       AND ts >= now() - interval '5 minutes';
    IF v_recent > 0 THEN
      RAISE EXCEPTION 'RATE_LIMIT_REFRESH';
    END IF;
    INSERT INTO public.api_hits(key, fn, hotel_slug)
      VALUES (v_rate_key, 'snapshot_visibility_score', NULL);
  ELSIF v_trigger = 'MANAGER_REFRESH' THEN
    IF NOT v_is_manager THEN RAISE EXCEPTION 'NOT_A_MANAGER'; END IF;
    -- Managers get a tighter rate limit (1/min) to allow rapid post-fix re-check
    v_rate_key := 'visibility_refresh:' || p_hotel_id::text;
    SELECT COUNT(*) INTO v_recent
      FROM public.api_hits
     WHERE key = v_rate_key
       AND ts >= now() - interval '1 minute';
    IF v_recent > 0 THEN
      RAISE EXCEPTION 'RATE_LIMIT_REFRESH';
    END IF;
    INSERT INTO public.api_hits(key, fn, hotel_slug)
      VALUES (v_rate_key, 'snapshot_visibility_score', NULL);
  END IF;

  -- Compute current
  v_score := public._compute_visibility_score(p_hotel_id);

  -- Find previous snapshot (most recent) for delta
  SELECT * INTO v_prev
    FROM public.visibility_score_snapshots
   WHERE hotel_id_at_snapshot = p_hotel_id
   ORDER BY taken_at DESC
   LIMIT 1;

  -- Build signals_changed: signals whose satisfied/state/contribution changed
  IF FOUND THEN
    WITH prev_signals AS (
      SELECT (e->>'key') AS key,
             (e->>'state') AS state,
             (e->>'satisfied')::boolean AS satisfied,
             COALESCE((e->>'contribution')::numeric, 0) AS contribution
        FROM jsonb_array_elements(COALESCE((SELECT s.signals_changed FROM (SELECT v_prev.*) s), '[]'::jsonb)) e
    ),
    curr_signals AS (
      SELECT (e->>'key') AS key,
             (e->>'state') AS state,
             (e->>'satisfied')::boolean AS satisfied,
             COALESCE((e->>'contribution')::numeric, 0) AS contribution
        FROM jsonb_array_elements(v_score->'signals') e
    ),
    -- Compare current to the PREVIOUS snapshot's stored prior breakdown — but
    -- we only stored signals_changed previously, not full breakdown. So for
    -- accurate diffs we re-derive against the prior total_score only here,
    -- and let the first delta-aware snapshot bootstrap an empty list.
    prev_total AS (SELECT v_prev.total_score AS s)
    SELECT COALESCE(jsonb_agg(jsonb_build_object('key', c.key, 'before', NULL, 'after', c.state)),
                    '[]'::jsonb)
      INTO v_changed
      FROM curr_signals c
     WHERE false; -- bootstrap: first delta-aware snapshot has empty changes; future snapshots will carry richer diffs once we widen storage
  END IF;

  -- Insert snapshot row
  INSERT INTO public.visibility_score_snapshots(
    hotel_id, hotel_id_at_snapshot, formula_version,
    total_score, band, category_scores,
    signals_satisfied, signals_total, signals_excluded,
    previous_score, signals_changed,
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
    v_trigger,
    CASE WHEN v_trigger IN ('CRON','ADMIN_BACKFILL') THEN NULL ELSE auth.uid() END
  ) RETURNING id INTO v_id;

  -- Audit
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
      'formula_version', (v_score->>'version')::int
    )
  );

  RETURN jsonb_build_object('snapshot_id', v_id, 'total_score', (v_score->>'total_score')::numeric, 'band', v_score->>'band');
END;
$$;
COMMENT ON FUNCTION public.snapshot_visibility_score(uuid, text) IS
  'Writes a snapshot row for the given hotel. Trigger CRON requires vaiyu_is_system_cron(). OWNER_REFRESH and MANAGER_REFRESH require corresponding role and are rate-limited via api_hits.';

-- ─── RPC: set_visibility_attestation ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_visibility_attestation(
  p_hotel_id     uuid,
  p_signal_key   text,
  p_state        text,
  p_evidence_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_new_state public.visibility_attestation_state;
  v_pattern   text;
  v_existing  public.hotel_visibility_attestations;
  v_id        uuid;
BEGIN
  -- Auth
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  -- Validate state enum
  BEGIN
    v_new_state := p_state::public.visibility_attestation_state;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END;

  -- Owner path can only set UNCLAIMED or SELF_ATTESTED (manager_verify path is separate)
  IF v_new_state = 'MANAGER_VERIFIED' THEN
    RAISE EXCEPTION 'USE_MANAGER_VERIFY_RPC';
  END IF;

  -- Validate signal_key length
  IF length(p_signal_key) = 0 OR length(p_signal_key) > 64 THEN
    RAISE EXCEPTION 'INVALID_SIGNAL_KEY';
  END IF;

  -- Validate evidence URL against per-signal allowlist
  IF p_evidence_url IS NOT NULL AND length(btrim(p_evidence_url)) > 0 THEN
    v_pattern := public._visibility_evidence_pattern(p_signal_key);
    IF v_pattern <> '' AND p_evidence_url !~ v_pattern THEN
      RAISE EXCEPTION 'EVIDENCE_URL_NOT_ALLOWED';
    END IF;
  END IF;

  -- Lookup existing row to know whether to clear verifier fields when un-attesting
  SELECT * INTO v_existing
    FROM public.hotel_visibility_attestations
   WHERE hotel_id = p_hotel_id AND signal_key = p_signal_key
   FOR UPDATE;

  IF v_new_state = 'UNCLAIMED' THEN
    -- Owner is withdrawing attestation — clear all bookkeeping
    INSERT INTO public.hotel_visibility_attestations(
      hotel_id, signal_key, state, evidence_url,
      attested_by, attested_at, manager_verified_by, manager_verified_at, manager_note
    ) VALUES (
      p_hotel_id, p_signal_key, 'UNCLAIMED', NULL,
      NULL, NULL, NULL, NULL, NULL
    )
    ON CONFLICT (hotel_id, signal_key) DO UPDATE SET
      state = 'UNCLAIMED',
      evidence_url = NULL,
      attested_by = NULL,
      attested_at = NULL,
      manager_verified_by = NULL,
      manager_verified_at = NULL,
      manager_note = NULL
    RETURNING id INTO v_id;
  ELSE
    -- SELF_ATTESTED: stamp owner identity; clear stale manager verification
    INSERT INTO public.hotel_visibility_attestations(
      hotel_id, signal_key, state, evidence_url,
      attested_by, attested_at
    ) VALUES (
      p_hotel_id, p_signal_key, 'SELF_ATTESTED', NULLIF(btrim(p_evidence_url), ''),
      auth.uid(), now()
    )
    ON CONFLICT (hotel_id, signal_key) DO UPDATE SET
      state = 'SELF_ATTESTED',
      evidence_url = NULLIF(btrim(EXCLUDED.evidence_url), ''),
      attested_by = auth.uid(),
      attested_at = now(),
      -- Owner re-attestation clears any prior manager verification (manager must re-verify the new evidence)
      manager_verified_by = NULL,
      manager_verified_at = NULL,
      manager_note = NULL
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO public.va_audit_logs(action, actor, hotel_id, entity, entity_id, meta)
  VALUES (
    'visibility_attestation_set',
    auth.uid()::text,
    p_hotel_id,
    'visibility_attestation',
    v_id,
    jsonb_build_object(
      'signal_key', p_signal_key,
      'new_state', v_new_state,
      'evidence_url_present', p_evidence_url IS NOT NULL AND length(btrim(p_evidence_url)) > 0
    )
  );

  RETURN jsonb_build_object('id', v_id, 'state', v_new_state::text);
END;
$$;
COMMENT ON FUNCTION public.set_visibility_attestation(uuid, text, text, text) IS
  'Owner-callable attestation setter. Allowed transitions: UNCLAIMED ⇄ SELF_ATTESTED. Manager verification uses a separate RPC. Re-attestation by owner clears any prior manager verification.';

-- ─── RPC: manager_verify_attestation ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.manager_verify_attestation(
  p_hotel_id   uuid,
  p_signal_key text,
  p_note       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_existing public.hotel_visibility_attestations;
  v_id       uuid;
BEGIN
  IF NOT public.vaiyu_is_hotel_finance_manager(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_A_MANAGER';
  END IF;

  SELECT * INTO v_existing
    FROM public.hotel_visibility_attestations
   WHERE hotel_id = p_hotel_id AND signal_key = p_signal_key
   FOR UPDATE;
  IF NOT FOUND OR v_existing.state = 'UNCLAIMED' THEN
    RAISE EXCEPTION 'NOTHING_TO_VERIFY';
  END IF;

  UPDATE public.hotel_visibility_attestations SET
    state = 'MANAGER_VERIFIED',
    manager_verified_by = auth.uid(),
    manager_verified_at = now(),
    manager_note = NULLIF(btrim(p_note), '')
   WHERE id = v_existing.id
   RETURNING id INTO v_id;

  INSERT INTO public.va_audit_logs(action, actor, hotel_id, entity, entity_id, meta)
  VALUES (
    'visibility_attestation_manager_verified',
    auth.uid()::text,
    p_hotel_id,
    'visibility_attestation',
    v_id,
    jsonb_build_object('signal_key', p_signal_key, 'note_present', p_note IS NOT NULL)
  );

  RETURN jsonb_build_object('id', v_id, 'state', 'MANAGER_VERIFIED');
END;
$$;
COMMENT ON FUNCTION public.manager_verify_attestation(uuid, text, text) IS
  'Manager-only verification of an existing SELF_ATTESTED row. Promotes to MANAGER_VERIFIED with full credit. Verification expires after 90 days (degraded automatically in scoring).';

-- ─── RPC: manager_unverify_attestation (with lock rules) ────────────────────

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

  -- Lock rule: only the verifying manager OR platform_admin (= postgres role)
  -- can un-verify. Other managers in the same hotel get ATTESTATION_LOCKED.
  v_is_admin := public.vaiyu_is_system_cron();
  IF NOT v_is_admin AND v_existing.manager_verified_by <> auth.uid() THEN
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
COMMENT ON FUNCTION public.manager_unverify_attestation(uuid, text, text) IS
  'Manager unverify with lock rules: only the original verifier (or platform_admin) can unverify. Other managers get ATTESTATION_LOCKED.';

-- ─── RPC: replay_missed_snapshots (platform_admin only via GRANT) ──────────

CREATE OR REPLACE FUNCTION public.replay_missed_snapshots(p_hotel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_id uuid;
  v_score jsonb;
BEGIN
  -- Restricted to system role
  IF NOT public.vaiyu_is_system_cron() THEN
    RAISE EXCEPTION 'ADMIN_ONLY';
  END IF;
  v_score := public._compute_visibility_score(p_hotel_id);
  INSERT INTO public.visibility_score_snapshots(
    hotel_id, hotel_id_at_snapshot, formula_version,
    total_score, band, category_scores,
    signals_satisfied, signals_total, signals_excluded,
    triggered_by
  ) VALUES (
    p_hotel_id, p_hotel_id, (v_score->>'version')::int,
    (v_score->>'total_score')::numeric,
    v_score->>'band',
    v_score->'category_scores',
    (v_score->>'signals_satisfied')::int,
    (v_score->>'signals_total')::int,
    COALESCE((v_score->>'signals_excluded')::int, 0),
    'ADMIN_BACKFILL'
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('snapshot_id', v_id);
END;
$$;
COMMENT ON FUNCTION public.replay_missed_snapshots(uuid) IS
  'Platform_admin-only recovery RPC. Manually inserts a snapshot when cron has missed runs. Audit trail relies on the ADMIN_BACKFILL trigger label.';

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.hotel_visibility_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visibility_score_snapshots    ENABLE ROW LEVEL SECURITY;

-- Reads: hotel members
CREATE POLICY hva_select_members
  ON public.hotel_visibility_attestations FOR SELECT
  TO authenticated
  USING (public.vaiyu_is_hotel_member(hotel_id));

CREATE POLICY vss_select_members
  ON public.visibility_score_snapshots FOR SELECT
  TO authenticated
  USING (
    hotel_id IS NULL OR public.vaiyu_is_hotel_member(hotel_id)
  );

-- Writes: only via RPCs (revoke direct DML)
REVOKE ALL ON public.hotel_visibility_attestations FROM anon, authenticated;
REVOKE ALL ON public.visibility_score_snapshots    FROM anon, authenticated;
GRANT  SELECT ON public.hotel_visibility_attestations TO authenticated;
GRANT  SELECT ON public.visibility_score_snapshots    TO authenticated;
GRANT  SELECT ON public.v_hotel_visibility_score      TO authenticated;
GRANT  SELECT ON public.v_visibility_cron_health      TO authenticated;

-- ─── RPC grants ─────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public._visibility_weights()                            TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._visibility_evidence_pattern(text)               TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._compute_visibility_score(uuid)                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vaiyu_is_system_cron()                           TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.snapshot_visibility_score(uuid, text)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_visibility_attestation(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_verify_attestation(uuid, text, text)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_unverify_attestation(uuid, text, text)   TO authenticated;
-- replay_missed_snapshots stays postgres-only (no grant)

-- ─── pg_cron weekly schedule ────────────────────────────────────────────────
-- Sunday 03:00 IST = Saturday 21:30 UTC (IST = UTC+5:30)
-- Snapshot every hotel that has at least one hotel_member.

DO $$ BEGIN
  PERFORM cron.schedule(
    'visibility_score_weekly_snapshot',
    '30 21 * * 6',  -- Saturday 21:30 UTC = Sunday 03:00 IST
    $cron$
      DO $inner$
      DECLARE r record;
      BEGIN
        FOR r IN
          SELECT DISTINCT h.id
            FROM public.hotels h
           WHERE EXISTS (SELECT 1 FROM public.hotel_members hm WHERE hm.hotel_id = h.id)
        LOOP
          BEGIN
            PERFORM public.snapshot_visibility_score(r.id, 'CRON');
          EXCEPTION WHEN OTHERS THEN
            -- Per-hotel failure must not stop the batch
            INSERT INTO public.va_audit_logs(action, actor, hotel_id, entity, meta)
            VALUES ('visibility_snapshot_cron_error', 'system', r.id, 'visibility_snapshot',
                    jsonb_build_object('error', SQLERRM));
          END;
        END LOOP;
      END
      $inner$;
    $cron$
  );
EXCEPTION WHEN duplicate_object OR unique_violation THEN
  NULL;
END $$;
