-- 20260424000001_pricing_guardrails_audit.sql
-- Production hardening: rule edit audit, soft-delete, apply idempotency,
-- and max-delta guardrail for auto-apply.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. pricing_rules: updated_by + soft-delete
-- ---------------------------------------------------------------------------
-- `updated_by` auto-stamped via BEFORE UPDATE trigger so the app can never
-- forget. `deleted_at` replaces hard deletes so `pricing_change_log.rule_id`
-- keeps referential integrity and the history UI can still resolve rule names
-- for past events.

ALTER TABLE public.pricing_rules
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.pricing_rules
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Partial index to keep the common listing query (active, not-deleted) fast.
CREATE INDEX IF NOT EXISTS idx_pricing_rules_live
  ON public.pricing_rules (hotel_id, priority)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.set_updated_by()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pricing_rules_updated_by ON public.pricing_rules;
CREATE TRIGGER trg_pricing_rules_updated_by
  BEFORE UPDATE ON public.pricing_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_by();

COMMENT ON COLUMN public.pricing_rules.updated_by IS
  'Auto-stamped by trg_pricing_rules_updated_by on every UPDATE. Preserves edit authorship including soft-deletes.';
COMMENT ON COLUMN public.pricing_rules.deleted_at IS
  'Soft-delete marker. listPricingRules filters `deleted_at IS NULL`; pricing_change_log.rule_id FKs are preserved so history stays resolvable.';


-- ---------------------------------------------------------------------------
-- 2. pricing_settings: max_delta_pct guardrail
-- ---------------------------------------------------------------------------
-- Single nullable column. NULL = disabled (no cap). Integer 1..100 = cap in %.
-- A separate boolean would create drift ("enabled=true but value=null"); this
-- design makes "off" an explicitly-chosen NULL value.

ALTER TABLE public.pricing_settings
  ADD COLUMN IF NOT EXISTS max_delta_pct INT;

ALTER TABLE public.pricing_settings
  DROP CONSTRAINT IF EXISTS chk_pricing_settings_max_delta_pct;
ALTER TABLE public.pricing_settings
  ADD CONSTRAINT chk_pricing_settings_max_delta_pct CHECK (
    max_delta_pct IS NULL OR (max_delta_pct BETWEEN 1 AND 100)
  );

COMMENT ON COLUMN public.pricing_settings.max_delta_pct IS
  'Guardrail cap on auto-applied price swings (percent of base). NULL = guardrail disabled. Engine rejects auto writes whose |new-base|/base*100 exceeds this cap and falls back to manual review.';


-- ---------------------------------------------------------------------------
-- 3. pricing_change_log: idempotency via client_request_id
-- ---------------------------------------------------------------------------
-- Nullable so manual UI writes that don't supply an id still work. The unique
-- partial index dedups retries within a hotel without touching the primary
-- key.

ALTER TABLE public.pricing_change_log
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_pricing_change_log_client_req
  ON public.pricing_change_log (hotel_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

COMMENT ON COLUMN public.pricing_change_log.client_request_id IS
  'Caller-supplied idempotency key. apply_pricing_change returns the existing row id when a duplicate arrives within the same hotel.';


-- ---------------------------------------------------------------------------
-- 4. apply_pricing_change RPC: add p_client_request_id + guardrail
-- ---------------------------------------------------------------------------
-- Signature change → must drop the old overload before re-creating. The new
-- parameter is last with DEFAULT NULL so existing manual call sites that only
-- pass positional arguments keep working; idempotency is opt-in per caller.

DROP FUNCTION IF EXISTS public.apply_pricing_change(
  UUID, UUID, UUID, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC,
  BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT
);

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
  p_source                TEXT,                    -- 'manual' | 'auto'
  p_client_request_id     UUID DEFAULT NULL        -- idempotency key (optional)
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

  -- Idempotency short-circuit. If this hotel already processed this request
  -- id, return the original log id without performing any writes.
  IF p_client_request_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM public.pricing_change_log
     WHERE hotel_id = p_hotel_id AND client_request_id = p_client_request_id;
    IF v_existing_id IS NOT NULL THEN
      RETURN v_existing_id;
    END IF;
  END IF;

  -- Kill-switch + guardrail (auto-apply path only).
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

  -- Previous price = current override if any, else base.
  SELECT override_price INTO v_previous
    FROM public.pricing_current_rates
   WHERE hotel_id = p_hotel_id
     AND (room_type_id = p_room_type_id OR (room_type_id IS NULL AND p_room_type_id IS NULL));
  v_previous := COALESCE(v_previous, p_base_price);

  -- Upsert current rate (partial-unique-index aware: two paths).
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

  -- Append immutable audit row. If two concurrent requests share the same
  -- client_request_id, the unique partial index makes the second insert fail
  -- with 23505; we then fetch and return the winner's id.
  BEGIN
    INSERT INTO public.pricing_change_log (
      hotel_id, room_type_id, rule_id,
      previous_price, new_price, base_price_at_time, occupancy_pct_at_time,
      adjustment_type, adjustment_value,
      was_clamped, clamp_reason, matched_rule_name,
      explanation, note, applied_by, client_request_id
    ) VALUES (
      p_hotel_id, p_room_type_id, p_rule_id,
      v_previous, p_new_price, p_base_price, p_occupancy_pct,
      p_adjustment_type, p_adjustment_value,
      COALESCE(p_was_clamped, FALSE), p_clamp_reason, p_matched_rule_name,
      p_explanation, p_note, v_user_id, p_client_request_id
    ) RETURNING id INTO v_log_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_log_id
      FROM public.pricing_change_log
     WHERE hotel_id = p_hotel_id AND client_request_id = p_client_request_id;
    IF v_log_id IS NULL THEN
      RAISE;  -- unexpected; re-raise original
    END IF;
  END;

  RETURN v_log_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_pricing_change(
  UUID, UUID, UUID, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC,
  BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.apply_pricing_change(
  UUID, UUID, UUID, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC,
  BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, UUID
) TO authenticated;

COMMENT ON FUNCTION public.apply_pricing_change IS
  'Atomic pricing write: optional idempotency via p_client_request_id, guardrail enforcement on auto-source, upsert of pricing_current_rates, and append to pricing_change_log.';

COMMIT;
