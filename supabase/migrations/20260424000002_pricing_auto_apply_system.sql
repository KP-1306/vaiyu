-- 20260424000002_pricing_auto_apply_system.sql
-- Adds the server-side path for scheduled auto-apply:
--   1. Persist `source` on pricing_change_log so manual vs auto is queryable.
--   2. Allow `applied_by` to be NULL for system-originated writes.
--   3. A service-role-only `apply_pricing_change_system` RPC that an Edge
--      Function (or any scheduled runner) can call without an auth.uid().
--
-- The existing `apply_pricing_change` (user-facing, SECURITY DEFINER, checks
-- finance-manager role) is unchanged except that it now persists `source`.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. pricing_change_log schema changes
-- ---------------------------------------------------------------------------

ALTER TABLE public.pricing_change_log
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE public.pricing_change_log
  DROP CONSTRAINT IF EXISTS chk_pricing_change_log_source;
ALTER TABLE public.pricing_change_log
  ADD CONSTRAINT chk_pricing_change_log_source
    CHECK (source IN ('manual', 'auto'));

-- Allow NULL `applied_by` so auto-source rows written by the scheduler don't
-- need to impersonate a human. Manual writes still stamp the acting user.
ALTER TABLE public.pricing_change_log
  ALTER COLUMN applied_by DROP NOT NULL;

-- Ensure every row has an actor OR is explicitly a system row. This prevents
-- accidental NULL stamps from buggy manual call-sites.
ALTER TABLE public.pricing_change_log
  DROP CONSTRAINT IF EXISTS chk_pricing_change_log_actor;
ALTER TABLE public.pricing_change_log
  ADD CONSTRAINT chk_pricing_change_log_actor
    CHECK (applied_by IS NOT NULL OR source = 'auto');

COMMENT ON COLUMN public.pricing_change_log.source IS
  'Origin of the write: manual (human clicked Apply) or auto (scheduled runner).';


-- ---------------------------------------------------------------------------
-- 2. Update apply_pricing_change to persist `source`
-- ---------------------------------------------------------------------------
-- Signature unchanged; we only add `source` to the INSERT. Idempotency and
-- guardrail logic from the prior migration stay intact.

CREATE OR REPLACE FUNCTION public.apply_pricing_change(
  p_hotel_id              UUID,
  p_room_type_id          UUID,
  p_rule_id               UUID,
  p_base_price            NUMERIC,
  p_new_price             NUMERIC,
  p_occupancy_pct         NUMERIC,
  p_adjustment_type       TEXT,
  p_adjustment_value      NUMERIC,
  p_was_clamped           BOOLEAN,
  p_clamp_reason          TEXT,
  p_matched_rule_name     TEXT,
  p_explanation           TEXT,
  p_note                  TEXT,
  p_source                TEXT,
  p_client_request_id     UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id         UUID := auth.uid();
  v_previous        NUMERIC;
  v_recommend_only  BOOLEAN;
  v_max_delta_pct   INT;
  v_delta_pct       NUMERIC;
  v_existing_id     UUID;
  v_log_id          UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '28000';
  END IF;

  IF NOT public.vaiyu_is_hotel_finance_manager(p_hotel_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_new_price IS NULL OR p_new_price <= 0 THEN
    RAISE EXCEPTION 'invalid_price: new_price must be > 0' USING ERRCODE = '22023';
  END IF;
  IF p_base_price IS NULL OR p_base_price <= 0 THEN
    RAISE EXCEPTION 'invalid_price: base_price must be > 0' USING ERRCODE = '22023';
  END IF;
  IF p_source NOT IN ('manual', 'auto') THEN
    RAISE EXCEPTION 'invalid_source: must be manual or auto' USING ERRCODE = '22023';
  END IF;

  IF p_client_request_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM public.pricing_change_log
     WHERE hotel_id = p_hotel_id AND client_request_id = p_client_request_id;
    IF v_existing_id IS NOT NULL THEN
      RETURN v_existing_id;
    END IF;
  END IF;

  SELECT COALESCE(recommend_only, TRUE), max_delta_pct
    INTO v_recommend_only, v_max_delta_pct
    FROM public.pricing_settings WHERE hotel_id = p_hotel_id;

  IF p_source = 'auto' AND COALESCE(v_recommend_only, TRUE) = TRUE THEN
    RAISE EXCEPTION 'auto_apply_disabled' USING ERRCODE = '22023';
  END IF;

  IF p_source = 'auto' AND v_max_delta_pct IS NOT NULL THEN
    v_delta_pct := ABS(p_new_price - p_base_price) / p_base_price * 100;
    IF v_delta_pct > v_max_delta_pct THEN
      RAISE EXCEPTION 'guardrail_blocked: delta %% > %% cap (% > %)',
        ROUND(v_delta_pct, 2), v_max_delta_pct
        USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT override_price INTO v_previous
    FROM public.pricing_current_rates
   WHERE hotel_id = p_hotel_id
     AND (room_type_id = p_room_type_id OR (room_type_id IS NULL AND p_room_type_id IS NULL));
  v_previous := COALESCE(v_previous, p_base_price);

  IF p_room_type_id IS NULL THEN
    INSERT INTO public.pricing_current_rates
      (hotel_id, room_type_id, base_price, override_price, rule_id, applied_by, applied_at)
    VALUES
      (p_hotel_id, NULL, p_base_price, p_new_price, p_rule_id, v_user_id, NOW())
    ON CONFLICT (hotel_id) WHERE room_type_id IS NULL
    DO UPDATE SET
      base_price     = EXCLUDED.base_price,
      override_price = EXCLUDED.override_price,
      rule_id        = EXCLUDED.rule_id,
      applied_by     = EXCLUDED.applied_by,
      applied_at     = EXCLUDED.applied_at;
  ELSE
    INSERT INTO public.pricing_current_rates
      (hotel_id, room_type_id, base_price, override_price, rule_id, applied_by, applied_at)
    VALUES
      (p_hotel_id, p_room_type_id, p_base_price, p_new_price, p_rule_id, v_user_id, NOW())
    ON CONFLICT (hotel_id, room_type_id) WHERE room_type_id IS NOT NULL
    DO UPDATE SET
      base_price     = EXCLUDED.base_price,
      override_price = EXCLUDED.override_price,
      rule_id        = EXCLUDED.rule_id,
      applied_by     = EXCLUDED.applied_by,
      applied_at     = EXCLUDED.applied_at;
  END IF;

  BEGIN
    INSERT INTO public.pricing_change_log (
      hotel_id, room_type_id, rule_id,
      previous_price, new_price, base_price_at_time, occupancy_pct_at_time,
      adjustment_type, adjustment_value,
      was_clamped, clamp_reason, matched_rule_name,
      explanation, note, applied_by, client_request_id, source
    ) VALUES (
      p_hotel_id, p_room_type_id, p_rule_id,
      v_previous, p_new_price, p_base_price, p_occupancy_pct,
      p_adjustment_type, p_adjustment_value,
      COALESCE(p_was_clamped, FALSE), p_clamp_reason, p_matched_rule_name,
      p_explanation, p_note, v_user_id, p_client_request_id, p_source
    ) RETURNING id INTO v_log_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_log_id
      FROM public.pricing_change_log
     WHERE hotel_id = p_hotel_id AND client_request_id = p_client_request_id;
    IF v_log_id IS NULL THEN RAISE; END IF;
  END;

  RETURN v_log_id;
END;
$$;


-- ---------------------------------------------------------------------------
-- 3. apply_pricing_change_system: service-role-only, no user check
-- ---------------------------------------------------------------------------
-- Identical write semantics to the user-facing RPC, minus:
--   • auth.uid() / finance-manager check
--   • always source='auto'
--   • applied_by = NULL (identifies system writes in audit queries)
--
-- Guardrail and kill-switch are still enforced — a buggy scheduler cannot
-- bypass the operator's max-delta cap or the recommend_only kill-switch.
-- Locked to the `service_role` GRANT so a compromised client JWT cannot call
-- this even if it discovered the name.

CREATE OR REPLACE FUNCTION public.apply_pricing_change_system(
  p_hotel_id              UUID,
  p_room_type_id          UUID,
  p_rule_id               UUID,
  p_base_price            NUMERIC,
  p_new_price             NUMERIC,
  p_occupancy_pct         NUMERIC,
  p_adjustment_type       TEXT,
  p_adjustment_value      NUMERIC,
  p_was_clamped           BOOLEAN,
  p_clamp_reason          TEXT,
  p_matched_rule_name     TEXT,
  p_explanation           TEXT,
  p_client_request_id     UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous        NUMERIC;
  v_recommend_only  BOOLEAN;
  v_auto_enabled    BOOLEAN;
  v_max_delta_pct   INT;
  v_delta_pct       NUMERIC;
  v_existing_id     UUID;
  v_log_id          UUID;
BEGIN
  IF p_new_price IS NULL OR p_new_price <= 0 THEN
    RAISE EXCEPTION 'invalid_price: new_price must be > 0' USING ERRCODE = '22023';
  END IF;
  IF p_base_price IS NULL OR p_base_price <= 0 THEN
    RAISE EXCEPTION 'invalid_price: base_price must be > 0' USING ERRCODE = '22023';
  END IF;

  -- Idempotency short-circuit
  IF p_client_request_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM public.pricing_change_log
     WHERE hotel_id = p_hotel_id AND client_request_id = p_client_request_id;
    IF v_existing_id IS NOT NULL THEN
      RETURN v_existing_id;
    END IF;
  END IF;

  SELECT COALESCE(auto_apply_enabled, FALSE),
         COALESCE(recommend_only, TRUE),
         max_delta_pct
    INTO v_auto_enabled, v_recommend_only, v_max_delta_pct
    FROM public.pricing_settings WHERE hotel_id = p_hotel_id;

  -- Double gate: both `auto_apply_enabled=TRUE` and `recommend_only=FALSE`.
  -- The operator has to flip two switches to enable automatic writes.
  IF COALESCE(v_auto_enabled, FALSE) = FALSE OR COALESCE(v_recommend_only, TRUE) = TRUE THEN
    RAISE EXCEPTION 'auto_apply_disabled' USING ERRCODE = '22023';
  END IF;

  IF v_max_delta_pct IS NOT NULL THEN
    v_delta_pct := ABS(p_new_price - p_base_price) / p_base_price * 100;
    IF v_delta_pct > v_max_delta_pct THEN
      RAISE EXCEPTION 'guardrail_blocked: delta %% > %% cap (% > %)',
        ROUND(v_delta_pct, 2), v_max_delta_pct
        USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT override_price INTO v_previous
    FROM public.pricing_current_rates
   WHERE hotel_id = p_hotel_id
     AND (room_type_id = p_room_type_id OR (room_type_id IS NULL AND p_room_type_id IS NULL));
  v_previous := COALESCE(v_previous, p_base_price);

  IF p_room_type_id IS NULL THEN
    INSERT INTO public.pricing_current_rates
      (hotel_id, room_type_id, base_price, override_price, rule_id, applied_by, applied_at)
    VALUES
      (p_hotel_id, NULL, p_base_price, p_new_price, p_rule_id, NULL, NOW())
    ON CONFLICT (hotel_id) WHERE room_type_id IS NULL
    DO UPDATE SET
      base_price     = EXCLUDED.base_price,
      override_price = EXCLUDED.override_price,
      rule_id        = EXCLUDED.rule_id,
      applied_by     = EXCLUDED.applied_by,
      applied_at     = EXCLUDED.applied_at;
  ELSE
    INSERT INTO public.pricing_current_rates
      (hotel_id, room_type_id, base_price, override_price, rule_id, applied_by, applied_at)
    VALUES
      (p_hotel_id, p_room_type_id, p_base_price, p_new_price, p_rule_id, NULL, NOW())
    ON CONFLICT (hotel_id, room_type_id) WHERE room_type_id IS NOT NULL
    DO UPDATE SET
      base_price     = EXCLUDED.base_price,
      override_price = EXCLUDED.override_price,
      rule_id        = EXCLUDED.rule_id,
      applied_by     = EXCLUDED.applied_by,
      applied_at     = EXCLUDED.applied_at;
  END IF;

  BEGIN
    INSERT INTO public.pricing_change_log (
      hotel_id, room_type_id, rule_id,
      previous_price, new_price, base_price_at_time, occupancy_pct_at_time,
      adjustment_type, adjustment_value,
      was_clamped, clamp_reason, matched_rule_name,
      explanation, note, applied_by, client_request_id, source
    ) VALUES (
      p_hotel_id, p_room_type_id, p_rule_id,
      v_previous, p_new_price, p_base_price, p_occupancy_pct,
      p_adjustment_type, p_adjustment_value,
      COALESCE(p_was_clamped, FALSE), p_clamp_reason, p_matched_rule_name,
      p_explanation, NULL, NULL, p_client_request_id, 'auto'
    ) RETURNING id INTO v_log_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_log_id
      FROM public.pricing_change_log
     WHERE hotel_id = p_hotel_id AND client_request_id = p_client_request_id;
    IF v_log_id IS NULL THEN RAISE; END IF;
  END;

  RETURN v_log_id;
END;
$$;

-- service_role only — NOT granted to `authenticated`.
REVOKE ALL ON FUNCTION public.apply_pricing_change_system(
  UUID, UUID, UUID, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC,
  BOOLEAN, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.apply_pricing_change_system(
  UUID, UUID, UUID, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC,
  BOOLEAN, TEXT, TEXT, TEXT, UUID
) TO service_role;

COMMENT ON FUNCTION public.apply_pricing_change_system IS
  'Service-role-only auto-apply RPC. Called by the scheduled edge function. Requires BOTH auto_apply_enabled=TRUE and recommend_only=FALSE to succeed; still honors max_delta_pct guardrail.';

COMMIT;
