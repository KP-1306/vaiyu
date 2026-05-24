-- ============================================================
-- VAiyu: Pricing + Finance Hardening (P0)
-- Migration: data integrity + operational safety
--
-- Covers audit items:
--   #1  FK on pricing_change_log.room_type_id
--   #2  CHECK scope_type ↔ room_type_id consistency on pricing_rules
--   #3  Partial UNIQUE indexes on pricing_current_rates
--       (property-wide row + per-room-type row cannot duplicate)
--   #9  Atomic apply_pricing_change RPC (rate + audit log in one txn)
--   #11 Server-side value guards (CHECK new_price > 0 etc.)
--   + hotel-level pricing kill-switch (auto_apply_enabled)
--   + FinanceRoleGuard RPC (is_hotel_finance_manager) — already exists
--     as vaiyu_is_hotel_finance_manager from rls migration.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. pricing_change_log.room_type_id → proper FK
--    (stored as orphan UUID previously; orphans possible on
--     room_type delete. ON DELETE SET NULL preserves audit row.)
-- ------------------------------------------------------------
ALTER TABLE public.pricing_change_log
  DROP CONSTRAINT IF EXISTS pricing_change_log_room_type_id_fkey;

ALTER TABLE public.pricing_change_log
  ADD CONSTRAINT pricing_change_log_room_type_id_fkey
  FOREIGN KEY (room_type_id)
  REFERENCES public.room_types(id)
  ON DELETE SET NULL;

-- Defensive: ensure new_price and base_price_at_time are positive
-- (existing table had no > 0 CHECK).
ALTER TABLE public.pricing_change_log
  DROP CONSTRAINT IF EXISTS chk_pricing_change_log_prices_positive;
ALTER TABLE public.pricing_change_log
  ADD CONSTRAINT chk_pricing_change_log_prices_positive
  CHECK (new_price > 0 AND base_price_at_time > 0 AND previous_price >= 0);

-- ------------------------------------------------------------
-- 2. pricing_rules: enforce scope_type ↔ room_type_id consistency
--    scope_type='room_type' ⇒ room_type_id IS NOT NULL
--    scope_type='property'  ⇒ room_type_id IS NULL
-- ------------------------------------------------------------
-- Repair any inconsistent existing rows first (safe: idempotent)
UPDATE public.pricing_rules
   SET scope_type = 'room_type'
 WHERE scope_type = 'property' AND room_type_id IS NOT NULL;

UPDATE public.pricing_rules
   SET room_type_id = NULL
 WHERE scope_type = 'property' AND room_type_id IS NOT NULL;

ALTER TABLE public.pricing_rules
  DROP CONSTRAINT IF EXISTS chk_pricing_rules_scope_consistency;
ALTER TABLE public.pricing_rules
  ADD CONSTRAINT chk_pricing_rules_scope_consistency CHECK (
    (scope_type = 'property'  AND room_type_id IS NULL) OR
    (scope_type = 'room_type' AND room_type_id IS NOT NULL)
  );

-- ------------------------------------------------------------
-- 3. pricing_current_rates: partial UNIQUE indexes
--    Postgres default: UNIQUE(a, b) treats NULL b as distinct,
--    so property-wide rows (room_type_id IS NULL) can duplicate.
--    Replace table-level UNIQUE with two partial indexes.
-- ------------------------------------------------------------
ALTER TABLE public.pricing_current_rates
  DROP CONSTRAINT IF EXISTS pricing_current_rates_hotel_id_room_type_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pricing_current_rates_hotel_roomtype
  ON public.pricing_current_rates (hotel_id, room_type_id)
  WHERE room_type_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pricing_current_rates_hotel_property
  ON public.pricing_current_rates (hotel_id)
  WHERE room_type_id IS NULL;

-- Positive-price invariant
ALTER TABLE public.pricing_current_rates
  DROP CONSTRAINT IF EXISTS chk_pricing_current_rates_prices_positive;
ALTER TABLE public.pricing_current_rates
  ADD CONSTRAINT chk_pricing_current_rates_prices_positive
  CHECK (base_price > 0 AND override_price > 0);

-- ------------------------------------------------------------
-- 4. Hotel-level auto-apply kill switch
--    Keeps engine in "recommend-only" mode until explicitly enabled.
--    Lives on hotels.settings jsonb to avoid schema churn; if that
--    column doesn't exist we create a dedicated table.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pricing_settings (
  hotel_id             UUID PRIMARY KEY REFERENCES public.hotels(id) ON DELETE CASCADE,
  auto_apply_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  recommend_only       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by           UUID NULL,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_pricing_settings_updated_at ON public.pricing_settings;
CREATE TRIGGER trg_pricing_settings_updated_at
  BEFORE UPDATE ON public.pricing_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.pricing_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pricing_settings_select ON public.pricing_settings;
CREATE POLICY pricing_settings_select
  ON public.pricing_settings FOR SELECT TO authenticated
  USING (public.vaiyu_is_hotel_member(hotel_id));

DROP POLICY IF EXISTS pricing_settings_write ON public.pricing_settings;
CREATE POLICY pricing_settings_write
  ON public.pricing_settings FOR ALL TO authenticated
  USING (public.vaiyu_is_hotel_finance_manager(hotel_id))
  WITH CHECK (public.vaiyu_is_hotel_finance_manager(hotel_id));

COMMENT ON TABLE public.pricing_settings IS
  'Per-hotel pricing engine controls. recommend_only=true means UI shows suggestion but applyPricing RPC is a no-op for auto-triggered calls.';

-- ------------------------------------------------------------
-- 5. Atomic apply_pricing_change RPC
--    Single txn: upsert current rate + append audit row.
--    Rejects writes when recommend_only=true and caller passed
--    p_source='auto' (cron/engine); manual UI calls pass 'manual'.
-- ------------------------------------------------------------
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
  p_source                TEXT  -- 'manual' | 'auto'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_previous      NUMERIC;
  v_recommend_only BOOLEAN;
  v_log_id        UUID;
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

  -- Kill-switch check for engine-triggered writes
  SELECT COALESCE(recommend_only, TRUE) INTO v_recommend_only
    FROM public.pricing_settings WHERE hotel_id = p_hotel_id;
  IF p_source = 'auto' AND COALESCE(v_recommend_only, TRUE) = TRUE THEN
    RAISE EXCEPTION 'auto_apply_disabled' USING ERRCODE = '22023';
  END IF;

  -- Previous price = current override if any, else base
  SELECT override_price INTO v_previous
    FROM public.pricing_current_rates
   WHERE hotel_id = p_hotel_id
     AND (room_type_id = p_room_type_id OR (room_type_id IS NULL AND p_room_type_id IS NULL));
  v_previous := COALESCE(v_previous, p_base_price);

  -- Upsert current rate (partial-unique-index aware: two paths)
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

  -- Append immutable audit row
  INSERT INTO public.pricing_change_log (
    hotel_id, room_type_id, rule_id,
    previous_price, new_price, base_price_at_time, occupancy_pct_at_time,
    adjustment_type, adjustment_value,
    was_clamped, clamp_reason, matched_rule_name,
    explanation, note, applied_by
  ) VALUES (
    p_hotel_id, p_room_type_id, p_rule_id,
    v_previous, p_new_price, p_base_price, p_occupancy_pct,
    p_adjustment_type, p_adjustment_value,
    COALESCE(p_was_clamped, FALSE), p_clamp_reason, p_matched_rule_name,
    p_explanation, p_note, v_user_id
  ) RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_pricing_change(
  UUID, UUID, UUID, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC,
  BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.apply_pricing_change(
  UUID, UUID, UUID, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC,
  BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

COMMENT ON FUNCTION public.apply_pricing_change IS
  'Atomic pricing write: upserts pricing_current_rates and appends pricing_change_log in one transaction. Authorization via vaiyu_is_hotel_finance_manager.';

COMMIT;
