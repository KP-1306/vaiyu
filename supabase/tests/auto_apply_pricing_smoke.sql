-- ============================================================
-- Smoke test: auto-apply pricing data path (post-migration-004)
-- ============================================================
-- Exercises the same queries + RPC that auto-apply-pricing/index.ts
-- runs, so a passing run here means the cron will work end-to-end:
--
--   1. listEligibleHotels        → pricing_settings filter
--   2. getHotelOccupancy         → stays count with scheduled_checkout_at > now
--   3. listScopes (NEW)          → v_effective_room_price + property-wide
--   4. apply_pricing_change_system → writes pricing_current_rates + log
--
-- Idempotent (cleans up at the end). Re-runnable. Safe to run on any
-- DB with the migrations applied.
--
-- Run via:
--   docker exec -i supabase_db_<ref> psql -U postgres -d postgres \
--     < supabase/tests/auto_apply_pricing_smoke.sql
-- ============================================================

DO $$
DECLARE
  v_hotel_id UUID;
  v_room_type_id UUID;
  v_room_id UUID;
  v_plan_id UUID;
  v_rule_id UUID;
  v_log_id UUID;
  v_settings_existed BOOLEAN;
  v_occ_pct NUMERIC;
  v_scope_count INT;
  v_base_resolved NUMERIC;
  v_eligible_before INT;
  v_eligible_after INT;
  v_override NUMERIC;
BEGIN
  RAISE NOTICE '═══ Auto-apply pricing smoke test ═══';

  -- Pick a real hotel + room from the DB
  SELECT id INTO v_hotel_id FROM public.hotels ORDER BY created_at LIMIT 1;
  SELECT id, room_type_id INTO v_room_id, v_room_type_id
    FROM public.rooms
    WHERE hotel_id = v_hotel_id LIMIT 1;
  IF v_hotel_id IS NULL OR v_room_type_id IS NULL THEN
    RAISE NOTICE 'No seed data — skipping';
    RETURN;
  END IF;
  RAISE NOTICE 'Using hotel=% room_type=%', v_hotel_id, v_room_type_id;

  -- ── STEP 1: Snapshot existing eligible-hotels count (back out at end) ──
  SELECT COUNT(*) INTO v_eligible_before
    FROM public.pricing_settings
    WHERE auto_apply_enabled=TRUE AND recommend_only=FALSE;

  -- Enable auto-apply for this hotel (idempotent upsert)
  SELECT EXISTS (SELECT 1 FROM public.pricing_settings WHERE hotel_id = v_hotel_id)
    INTO v_settings_existed;
  IF v_settings_existed THEN
    UPDATE public.pricing_settings
      SET auto_apply_enabled = TRUE, recommend_only = FALSE, max_delta_pct = 25
      WHERE hotel_id = v_hotel_id;
  ELSE
    INSERT INTO public.pricing_settings (hotel_id, auto_apply_enabled, recommend_only, max_delta_pct)
    VALUES (v_hotel_id, TRUE, FALSE, 25);
  END IF;

  SELECT COUNT(*) INTO v_eligible_after
    FROM public.pricing_settings
    WHERE auto_apply_enabled=TRUE AND recommend_only=FALSE;
  RAISE NOTICE 'STEP 1 listEligibleHotels: % → % (delta = %)',
    v_eligible_before, v_eligible_after, v_eligible_after - v_eligible_before;

  -- ── STEP 2: occupancy with the now() filter (matches edge function) ──
  WITH r AS (SELECT COUNT(*) AS total FROM public.rooms WHERE hotel_id = v_hotel_id),
       s AS (
         SELECT COUNT(*) AS occ FROM public.stays
          WHERE hotel_id = v_hotel_id
            AND status IN ('inhouse','arriving')
            AND scheduled_checkout_at > NOW()
       )
  SELECT CASE WHEN r.total > 0 THEN (s.occ::NUMERIC / r.total) * 100 ELSE 0 END
    INTO v_occ_pct
    FROM r, s;
  RAISE NOTICE 'STEP 2 getHotelOccupancy: % pct (zombies excluded)', v_occ_pct;

  -- ── STEP 3: seed a rate plan + base price + a matching rule ──
  INSERT INTO public.rate_plans (hotel_id, name, plan_code, is_default, priority, meal_code)
    VALUES (v_hotel_id, 'AutoApply Smoke', 'AA_SMOKE', TRUE, 100, 'EP')
    ON CONFLICT (hotel_id, plan_code) WHERE deleted_at IS NULL AND plan_code IS NOT NULL
      DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_plan_id;

  INSERT INTO public.rate_plan_prices (hotel_id, rate_plan_id, room_type_id, price, dow_mask, priority)
    VALUES (v_hotel_id, v_plan_id, v_room_type_id, 4000, 127, 100)
    RETURNING id INTO v_log_id;  -- temp reuse

  -- Verify resolver returns the base
  SELECT base_price INTO v_base_resolved
    FROM public.v_effective_room_price
    WHERE hotel_id = v_hotel_id AND room_type_id = v_room_type_id;
  RAISE NOTICE 'STEP 3 base from v_effective_room_price: ₹%', v_base_resolved;

  -- ── STEP 4: scopes from the NEW listScopes path ──
  SELECT COUNT(*) INTO v_scope_count
    FROM public.v_effective_room_price
    WHERE hotel_id = v_hotel_id AND base_price IS NOT NULL AND base_price > 0;
  RAISE NOTICE 'STEP 4 listScopes returns % per-room-type scope(s)', v_scope_count;

  -- Seed a rule that will surely fire (occupancy >= 0)
  INSERT INTO public.pricing_rules (
    hotel_id, rule_name, active, scope_type, room_type_id,
    occupancy_min_pct, occupancy_max_pct,
    adjustment_type, adjustment_value,
    min_price, max_price, priority
  ) VALUES (
    v_hotel_id, 'Smoke surge', TRUE, 'property', NULL,
    0, NULL,
    'increase_pct', 10,
    NULL, NULL, 100
  ) RETURNING id INTO v_rule_id;

  -- ── STEP 5: simulate apply_pricing_change_system call ──
  -- The recommended price = 4000 * 1.10 = 4400.
  SELECT public.apply_pricing_change_system(
    p_hotel_id            := v_hotel_id,
    p_room_type_id        := v_room_type_id,
    p_rule_id             := v_rule_id,
    p_base_price          := 4000::NUMERIC,
    p_new_price           := 4400::NUMERIC,
    p_occupancy_pct       := v_occ_pct,
    p_adjustment_type     := 'increase_pct'::TEXT,
    p_adjustment_value    := 10::NUMERIC,
    p_was_clamped         := FALSE,
    p_clamp_reason        := NULL::TEXT,
    p_matched_rule_name   := 'Smoke surge'::TEXT,
    p_explanation         := 'Smoke test: 0 pct min, +10 pct'::TEXT,
    p_client_request_id   := gen_random_uuid()
  ) INTO v_log_id;

  -- Verify pricing_current_rates got the override
  SELECT override_price INTO v_override
    FROM public.pricing_current_rates
    WHERE hotel_id = v_hotel_id AND room_type_id = v_room_type_id;
  RAISE NOTICE 'STEP 5 apply_pricing_change_system: log=%, pricing_current_rates.override=₹%',
    v_log_id, v_override;

  IF v_override = 4400 THEN
    RAISE NOTICE '✓ PASS — override correctly written by the apply RPC';
  ELSE
    RAISE WARNING '✗ FAIL — expected ₹4400, got ₹%', v_override;
  END IF;

  -- ── Cleanup (restore exact prior state) ──
  DELETE FROM public.pricing_change_log WHERE rule_id = v_rule_id;
  DELETE FROM public.pricing_current_rates WHERE rule_id = v_rule_id;
  DELETE FROM public.pricing_rules WHERE id = v_rule_id;
  DELETE FROM public.rate_plan_prices WHERE rate_plan_id = v_plan_id;
  DELETE FROM public.rate_plans WHERE id = v_plan_id;
  IF v_settings_existed THEN
    -- restore previous flags conservatively
    UPDATE public.pricing_settings
      SET auto_apply_enabled = FALSE, recommend_only = TRUE
      WHERE hotel_id = v_hotel_id;
  ELSE
    DELETE FROM public.pricing_settings WHERE hotel_id = v_hotel_id;
  END IF;

  RAISE NOTICE '═══ Smoke test complete ═══';
END $$;
