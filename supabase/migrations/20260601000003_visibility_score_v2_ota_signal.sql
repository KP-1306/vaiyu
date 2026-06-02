-- Visibility Score v2 — add OTA Listing Optimizer signal
--
-- Adds one new TRUST_REPUTATION signal `ota_listing_ready` (AUTO_DERIVED)
-- that reads from the OTA Listing Optimizer's overall readiness band via
-- `_ota_signal_for_visibility(p_hotel_id)`. Bumps formula version 1 → 2.
--
-- TRUST_REPUTATION category internal rebalance (stays at 25):
--   review_link_set         5 → 4  (-1)
--   reviews_flowing         7 → 7  (unchanged)
--   off_platform_response   5 → 4  (-1)
--   trust_essentials_assets 8 → 6  (-2)
--   ota_listing_ready       — → 4  (+4 NEW)
--   ----------------------------------------
--   Category subtotal:     25 → 25 ✓
--
-- No other categories changed. Grand total stays 100.
--
-- Effect on existing snapshots:
--   • Existing snapshots carry formula_version=1 and remain interpretable
--   • New snapshots taken after this migration carry formula_version=2
--   • The trend chart compares like-for-like via formula_version
--
-- Per CLAUDE.md: no phase 2, no deferred — every signal added here is
-- evaluated immediately on first snapshot after deployment.

-- ─── _visibility_weights() v2 ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._visibility_weights()
RETURNS TABLE (version int, weights jsonb)
LANGUAGE sql IMMUTABLE
AS $$
  SELECT 2::int AS version,
         jsonb_build_object(
           -- GMB_READINESS (30) — unchanged
           'gmb_claimed',              6,
           'gmb_verified',             6,
           'gmb_category_set',         4,
           'address_complete',         5,
           'map_pin_set',              5,
           'phone_present',            4,
           -- TRUST_REPUTATION (25) — internal rebalance
           'review_link_set',          4,   -- was 5
           'reviews_flowing',          7,
           'off_platform_response',    4,   -- was 5
           'trust_essentials_assets',  6,   -- was 8
           'ota_listing_ready',        4,   -- NEW
           -- DIGITAL_ASSETS (20) — unchanged
           'critical_assets_ready',   10,
           'high_assets_ready',        5,
           'brand_basics',             5,
           -- DIRECT_ENQUIRY (15) — unchanged
           'whatsapp_connected',       4,
           'booking_url_set',          3,
           'payment_ready',            4,
           'lead_response_time',       4,
           -- EXPERIENCE_PACKAGES (10) — unchanged
           'package_live',             5,
           'seo_blueprint_ready',      5
         ) AS weights;
$$;
COMMENT ON FUNCTION public._visibility_weights() IS
  'Authoritative weights for the Visibility Score formula. v2: added ota_listing_ready (TRUST_REPUTATION, weight 4); rebalanced trust_essentials_assets (-2), off_platform_response (-1), review_link_set (-1) to keep TRUST_REPUTATION at 25 and total at 100. TS mirror in web/src/config/visibilityScore.ts + vitest parity test enforces no silent drift.';

-- ─── _compute_visibility_score() v2 — adds ota_listing_ready signal ────────
-- Full replacement (CREATE OR REPLACE). Body mirrors the v1 function with
-- one new signal block inserted between trust_essentials_assets (#10) and
-- critical_assets_ready (#11). All other blocks unchanged.

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

  -- v2: OTA Listing Optimizer signal
  v_ota_ready           boolean := false;

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

  -- (7) v2 NEW: OTA Listing Optimizer overall band
  -- Bridge function returns true when overall_score ≥ 50 (Moderate or Premium).
  BEGIN
    v_ota_ready := public._ota_signal_for_visibility(p_hotel_id);
  EXCEPTION WHEN OTHERS THEN
    -- OTA module not present (during migration ordering) — treat as not ready
    v_ota_ready := false;
  END;

  ----------------------------------------------------------------------------
  -- CATEGORY: GMB_READINESS
  ----------------------------------------------------------------------------

  -- 1. gmb_claimed (self-attested)
  v_signal_key := 'gmb_claimed';  v_category := 'GMB_READINESS';
  v_weight := (v_weights ->> v_signal_key)::numeric;
  SELECT * INTO v_attest FROM public.hotel_visibility_attestations
    WHERE hotel_id = p_hotel_id AND signal_key = v_signal_key;
  v_state := COALESCE(v_attest.state::text, 'UNCLAIMED');
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

  -- 5. map_pin_set (derived)
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
  -- CATEGORY: TRUST_REPUTATION  (v2: weights rebalanced; new ota_listing_ready)
  ----------------------------------------------------------------------------

  -- 7. review_link_set (derived) — v2 weight 4 (was 5)
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

  -- 8. reviews_flowing (derived)
  v_signal_key := 'reviews_flowing'; v_category := 'TRUST_REPUTATION';
  v_weight := (v_weights ->> v_signal_key)::numeric;
  IF v_reviews_90d = 0 AND v_hotel.created_at > now() - interval '30 days' THEN
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

  -- 9. off_platform_response (self-attested) — v2 weight 4 (was 5)
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

  -- 10. trust_essentials_assets (derived from DAM) — v2 weight 6 (was 8)
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

  -- 10b. NEW v2: ota_listing_ready (AUTO_DERIVED from OTA Listing Optimizer)
  v_signal_key := 'ota_listing_ready'; v_category := 'TRUST_REPUTATION';
  v_weight := (v_weights ->> v_signal_key)::numeric;
  v_satisfied := v_ota_ready;
  v_included := true;
  v_contrib := CASE WHEN v_satisfied THEN v_weight ELSE 0 END;
  v_reason := CASE WHEN v_satisfied THEN 'OTA Listing Optimizer reports Moderate or Premium readiness.'
                                     ELSE 'Complete OTA Listing Optimizer review to reach Moderate readiness (≥50).' END;
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
  -- Satisfied via either path:
  --   (a) per-hotel Meta phone_number_id present (Direct Mode), OR
  --   (b) Interakt-routed AND owner-enabled (single-platform-account model,
  --       where individual wa_phone_number_id may be empty)
  v_signal_key := 'whatsapp_connected'; v_category := 'DIRECT_ENQUIRY';
  v_weight := (v_weights ->> v_signal_key)::numeric;
  v_satisfied := COALESCE(length(btrim(v_hotel.wa_phone_number_id)), 0) > 0
              OR (COALESCE(v_hotel.whatsapp_enabled, false)
                  AND COALESCE(v_hotel.whatsapp_provider, 'META_DIRECT') = 'INTERAKT');
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

  -- 16. payment_ready (Razorpay Route/Direct OR UPI)
  -- Satisfied via ANY of:
  --   (a) Razorpay Route (razorpay_account_id is the linked acc_xxx), OR
  --   (b) Razorpay Direct (razorpay_direct_key_id is the per-hotel public key), OR
  --   (c) UPI ID configured
  v_signal_key := 'payment_ready'; v_category := 'DIRECT_ENQUIRY';
  v_weight := (v_weights ->> v_signal_key)::numeric;
  v_satisfied := (v_hotel.razorpay_account_id IS NOT NULL)
              OR (v_hotel.razorpay_direct_key_id IS NOT NULL)
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
    v_satisfied := v_lead_median_minutes <= 240;
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
  'Deterministic scoring of one hotel''s visibility readiness. v2: 20 signals (added ota_listing_ready in TRUST_REPUTATION). Loops through all signals, applies per-signal evaluation rules, accumulates contributions with min-sample carve-outs and 90-day manager-verification expiry, and returns a complete jsonb breakdown.';

-- ─── End of Visibility Score v2 migration ──────────────────────────────────
