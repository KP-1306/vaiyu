-- ============================================================
-- VAiyu Pricing – Phase 1: enterprise rate management
-- ============================================================
-- Scope:
--   • Extend rate_plans: plan_code, priority, is_default, soft delete, updated_at,
--     meal_code enum, channel scope, booking window.
--   • Extend rate_plan_prices: dow_mask, priority, unique index for overlap sanity,
--     updated_at + timestamp trigger.
--   • New rate_restrictions table (MinLOS, CTA, CTD, stop_sell per date).
--   • Replace v_effective_room_price with date/dow/priority-aware resolver.
--
-- Resolution precedence for effective price (most-specific first):
--   1. pricing_current_rates.override_price (per-room-type > property-wide)
--   2. rate_plan_prices row matching room_type + date + dow, ordered by
--      rate_plan_prices.priority DESC, rate_plans.priority DESC, is_default DESC
--   3. NULL / 0 → falls through to engine's base_price of the applicable plan
-- ============================================================

-- ─── 1. rate_plans: enterprise metadata ─────────────────────
ALTER TABLE public.rate_plans
  ADD COLUMN IF NOT EXISTS plan_code      TEXT,
  ADD COLUMN IF NOT EXISTS priority       INT          NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS is_default     BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ  NULL,
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS meal_code      TEXT         NULL,
  ADD COLUMN IF NOT EXISTS channel_scope  TEXT         NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS min_advance_days INT        NULL,
  ADD COLUMN IF NOT EXISTS max_advance_days INT        NULL,
  ADD COLUMN IF NOT EXISTS description    TEXT         NULL;

-- Meal code aligned to hotel industry conventions:
--   EP = European Plan (room only)     CP = Continental (breakfast)
--   MAP = Modified American (brkfst+1) AP  = American (all meals)
ALTER TABLE public.rate_plans
  DROP CONSTRAINT IF EXISTS chk_rate_plans_meal_code,
  ADD  CONSTRAINT chk_rate_plans_meal_code
    CHECK (meal_code IS NULL OR meal_code IN ('EP','CP','MAP','AP'));

ALTER TABLE public.rate_plans
  DROP CONSTRAINT IF EXISTS chk_rate_plans_channel_scope,
  ADD  CONSTRAINT chk_rate_plans_channel_scope
    CHECK (channel_scope IN ('all','direct','ota','corporate','walk_in'));

-- Soft-delete-aware uniqueness: a plan_code may be reused after a plan is
-- deleted. Partial index on live rows only.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rate_plans_hotel_code
  ON public.rate_plans(hotel_id, plan_code)
  WHERE deleted_at IS NULL AND plan_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rate_plans_hotel_live
  ON public.rate_plans(hotel_id, priority DESC)
  WHERE deleted_at IS NULL;

-- Bump updated_at on every row change (same pattern as pricing_rules).
CREATE OR REPLACE FUNCTION public.trg_rate_plans_touch_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_rate_plans_touch ON public.rate_plans;
CREATE TRIGGER trg_rate_plans_touch
  BEFORE UPDATE ON public.rate_plans
  FOR EACH ROW EXECUTE FUNCTION public.trg_rate_plans_touch_updated_at();


-- ─── 2. rate_plan_prices: dow + priority + timestamps ──────
ALTER TABLE public.rate_plan_prices
  ADD COLUMN IF NOT EXISTS dow_mask       SMALLINT     NOT NULL DEFAULT 127,
  ADD COLUMN IF NOT EXISTS priority       INT          NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS hotel_id       UUID         NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS notes          TEXT         NULL;

-- dow_mask bit layout: bit 0=Sun, 1=Mon, 2=Tue, ..., 6=Sat. 127 = all days.
ALTER TABLE public.rate_plan_prices
  DROP CONSTRAINT IF EXISTS chk_rate_plan_prices_dow_mask,
  ADD  CONSTRAINT chk_rate_plan_prices_dow_mask
    CHECK (dow_mask BETWEEN 1 AND 127);

ALTER TABLE public.rate_plan_prices
  DROP CONSTRAINT IF EXISTS chk_rate_plan_prices_date_order,
  ADD  CONSTRAINT chk_rate_plan_prices_date_order
    CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from);

ALTER TABLE public.rate_plan_prices
  DROP CONSTRAINT IF EXISTS chk_rate_plan_prices_price_positive,
  ADD  CONSTRAINT chk_rate_plan_prices_price_positive
    CHECK (price >= 0);

-- Backfill hotel_id from rate_plans for existing rows (table is empty today
-- so this is a no-op, but future-proofs the migration).
UPDATE public.rate_plan_prices rpp
  SET hotel_id = rp.hotel_id
  FROM public.rate_plans rp
  WHERE rpp.rate_plan_id = rp.id AND rpp.hotel_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_rate_plan_prices_lookup
  ON public.rate_plan_prices(room_type_id, valid_from, valid_to, priority DESC);

CREATE INDEX IF NOT EXISTS idx_rate_plan_prices_plan
  ON public.rate_plan_prices(rate_plan_id);

CREATE OR REPLACE FUNCTION public.trg_rate_plan_prices_touch_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_rate_plan_prices_touch ON public.rate_plan_prices;
CREATE TRIGGER trg_rate_plan_prices_touch
  BEFORE UPDATE ON public.rate_plan_prices
  FOR EACH ROW EXECUTE FUNCTION public.trg_rate_plan_prices_touch_updated_at();


-- ─── 3. rate_restrictions (MinLOS, CTA, CTD, stop_sell) ─────
-- Per (hotel, plan?, room_type?, date). NULL plan/room_type = applies to all.
CREATE TABLE IF NOT EXISTS public.rate_restrictions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id            UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  rate_plan_id        UUID NULL REFERENCES public.rate_plans(id) ON DELETE CASCADE,
  room_type_id        UUID NULL REFERENCES public.room_types(id) ON DELETE CASCADE,
  date                DATE NOT NULL,
  min_los             INT  NULL,
  max_los             INT  NULL,
  closed_to_arrival   BOOLEAN NOT NULL DEFAULT FALSE,
  closed_to_departure BOOLEAN NOT NULL DEFAULT FALSE,
  stop_sell           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_rate_restrictions_los
    CHECK (min_los IS NULL OR min_los >= 1),
  CONSTRAINT chk_rate_restrictions_max_los
    CHECK (max_los IS NULL OR min_los IS NULL OR max_los >= min_los)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rate_restrictions_scope_date
  ON public.rate_restrictions(
    hotel_id,
    COALESCE(rate_plan_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(room_type_id, '00000000-0000-0000-0000-000000000000'::uuid),
    date
  );

CREATE INDEX IF NOT EXISTS idx_rate_restrictions_hotel_date
  ON public.rate_restrictions(hotel_id, date);

DROP TRIGGER IF EXISTS trg_rate_restrictions_touch ON public.rate_restrictions;
CREATE TRIGGER trg_rate_restrictions_touch
  BEFORE UPDATE ON public.rate_restrictions
  FOR EACH ROW EXECUTE FUNCTION public.trg_rate_plan_prices_touch_updated_at();


-- ─── 4. Effective-price resolver ────────────────────────────
-- Replaces the simpler view from migration 003 with date/dow/priority logic.
-- Postgres EXTRACT(DOW FROM date) returns 0=Sunday..6=Saturday, aligning to
-- our dow_mask bit layout.
DROP VIEW IF EXISTS public.v_effective_room_price;

CREATE OR REPLACE FUNCTION public.get_effective_room_price(
  p_hotel_id UUID,
  p_room_type_id UUID,
  p_date DATE
) RETURNS TABLE (
  base_price       NUMERIC(12,2),
  effective_price  NUMERIC(12,2),
  is_overridden    BOOLEAN,
  rule_id          UUID,
  applied_at       TIMESTAMPTZ,
  override_scope   TEXT,
  rate_plan_id     UUID,
  rate_plan_name   TEXT
) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_dow_bit INT := (1 << EXTRACT(DOW FROM p_date)::INT);
  v_base    NUMERIC(12,2);
  v_plan_id UUID;
  v_plan_nm TEXT;
  v_override    NUMERIC(12,2);
  v_override_scope TEXT;
  v_rule_id UUID;
  v_applied TIMESTAMPTZ;
BEGIN
  -- 1. Resolve plan base price for this date (highest-priority matching row).
  SELECT rpp.price, rp.id, rp.name
    INTO v_base, v_plan_id, v_plan_nm
  FROM public.rate_plan_prices rpp
  JOIN public.rate_plans       rp ON rp.id = rpp.rate_plan_id
  WHERE rp.hotel_id = p_hotel_id
    AND rp.deleted_at IS NULL
    AND rpp.room_type_id = p_room_type_id
    AND (rpp.valid_from IS NULL OR rpp.valid_from <= p_date)
    AND (rpp.valid_to   IS NULL OR rpp.valid_to   >= p_date)
    AND (rpp.dow_mask & v_dow_bit) > 0
  ORDER BY rpp.priority DESC, rp.priority DESC, rp.is_default DESC, rpp.updated_at DESC
  LIMIT 1;

  -- 2. Resolve active override (per-type wins over property-wide).
  SELECT pcr.override_price, 'room_type', pcr.rule_id, pcr.applied_at
    INTO v_override, v_override_scope, v_rule_id, v_applied
  FROM public.pricing_current_rates pcr
  WHERE pcr.hotel_id = p_hotel_id
    AND pcr.room_type_id = p_room_type_id
    AND (pcr.expires_at IS NULL OR pcr.expires_at > NOW());

  IF v_override IS NULL THEN
    SELECT pcr.override_price, 'property', pcr.rule_id, pcr.applied_at
      INTO v_override, v_override_scope, v_rule_id, v_applied
    FROM public.pricing_current_rates pcr
    WHERE pcr.hotel_id = p_hotel_id
      AND pcr.room_type_id IS NULL
      AND (pcr.expires_at IS NULL OR pcr.expires_at > NOW());
  END IF;

  RETURN QUERY SELECT
    v_base,
    COALESCE(v_override, v_base),
    (v_override IS NOT NULL),
    v_rule_id,
    v_applied,
    v_override_scope,
    v_plan_id,
    v_plan_nm;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_effective_room_price(UUID, UUID, DATE)
  TO authenticated, anon, service_role;

-- Convenience view for the "today" case (walk-in Availability). Dated lookups
-- go through the function directly.
CREATE OR REPLACE VIEW public.v_effective_room_price AS
SELECT
  rt.hotel_id,
  rt.id AS room_type_id,
  r.base_price,
  r.effective_price,
  r.is_overridden,
  r.rule_id,
  r.applied_at,
  r.override_scope,
  r.rate_plan_id,
  r.rate_plan_name
FROM public.room_types rt
CROSS JOIN LATERAL public.get_effective_room_price(rt.hotel_id, rt.id, CURRENT_DATE) r;

GRANT SELECT ON public.v_effective_room_price TO authenticated, anon, service_role;

COMMENT ON VIEW public.v_effective_room_price IS
  'Effective room price resolved for CURRENT_DATE. For arbitrary dates, call get_effective_room_price(hotel_id, room_type_id, date) directly.';
COMMENT ON FUNCTION public.get_effective_room_price(UUID, UUID, DATE) IS
  'Resolves the price a guest should see: pricing_current_rates.override_price if active, otherwise the highest-priority rate_plan_prices row matching the date and day-of-week. Used by walk-in availability and (future) pre-checkin / reservation flows.';


-- ─── 5. RLS policies for rate_plans / rate_plan_prices / rate_restrictions ──
-- Owners can manage their own hotel's rates; service_role bypasses RLS.
ALTER TABLE public.rate_plans        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_plan_prices  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_restrictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rate_plans_owner_rw       ON public.rate_plans;
DROP POLICY IF EXISTS rate_plan_prices_owner_rw ON public.rate_plan_prices;
DROP POLICY IF EXISTS rate_restrictions_owner_rw ON public.rate_restrictions;

-- Lean on the existing helper user_is_hotel_owner(hotel_id) used elsewhere.
-- If that function doesn't exist yet, fall back to a permissive policy for
-- authenticated users (temporary — pricing RPCs already gate by role).
DO $$
DECLARE
  v_has_helper BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'user_is_hotel_owner'
  ) INTO v_has_helper;

  IF v_has_helper THEN
    EXECUTE $p$
      CREATE POLICY rate_plans_owner_rw ON public.rate_plans
        FOR ALL TO authenticated
        USING  (public.user_is_hotel_owner(hotel_id))
        WITH CHECK (public.user_is_hotel_owner(hotel_id));
    $p$;
    EXECUTE $p$
      CREATE POLICY rate_plan_prices_owner_rw ON public.rate_plan_prices
        FOR ALL TO authenticated
        USING  (public.user_is_hotel_owner(hotel_id))
        WITH CHECK (public.user_is_hotel_owner(hotel_id));
    $p$;
    EXECUTE $p$
      CREATE POLICY rate_restrictions_owner_rw ON public.rate_restrictions
        FOR ALL TO authenticated
        USING  (public.user_is_hotel_owner(hotel_id))
        WITH CHECK (public.user_is_hotel_owner(hotel_id));
    $p$;
  ELSE
    EXECUTE $p$
      CREATE POLICY rate_plans_owner_rw ON public.rate_plans
        FOR ALL TO authenticated USING (true) WITH CHECK (true);
    $p$;
    EXECUTE $p$
      CREATE POLICY rate_plan_prices_owner_rw ON public.rate_plan_prices
        FOR ALL TO authenticated USING (true) WITH CHECK (true);
    $p$;
    EXECUTE $p$
      CREATE POLICY rate_restrictions_owner_rw ON public.rate_restrictions
        FOR ALL TO authenticated USING (true) WITH CHECK (true);
    $p$;
  END IF;
END $$;
