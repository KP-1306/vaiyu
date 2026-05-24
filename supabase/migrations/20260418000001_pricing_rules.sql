-- ============================================================
-- VAiyu: Occupancy-Based Dynamic Pricing
-- Migration 001: pricing_rules
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pricing_rules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id          UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  rule_name         TEXT NOT NULL,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  scope_type        TEXT NOT NULL DEFAULT 'property'
                      CHECK (scope_type IN ('property', 'room_type')),
  room_type_id      UUID NULL REFERENCES public.room_types(id) ON DELETE SET NULL,
  occupancy_min_pct NUMERIC(5,2) NOT NULL
                      CHECK (occupancy_min_pct >= 0 AND occupancy_min_pct <= 100),
  occupancy_max_pct NUMERIC(5,2) NULL
                      CHECK (occupancy_max_pct IS NULL OR (occupancy_max_pct >= 0 AND occupancy_max_pct <= 100)),
  adjustment_type   TEXT NOT NULL
                      CHECK (adjustment_type IN ('increase_pct', 'decrease_pct', 'set_fixed_price')),
  adjustment_value  NUMERIC(12,2) NOT NULL CHECK (adjustment_value >= 0),
  min_price         NUMERIC(12,2) NULL CHECK (min_price IS NULL OR min_price >= 0),
  max_price         NUMERIC(12,2) NULL CHECK (max_price IS NULL OR max_price >= 0),
  priority          INTEGER NOT NULL DEFAULT 10,
  created_by        UUID NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_occupancy_range CHECK (
    occupancy_max_pct IS NULL OR occupancy_max_pct > occupancy_min_pct
  ),
  CONSTRAINT chk_min_max_price CHECK (
    min_price IS NULL OR max_price IS NULL OR max_price >= min_price
  )
);

CREATE INDEX IF NOT EXISTS idx_pricing_rules_hotel_id
  ON public.pricing_rules (hotel_id);
CREATE INDEX IF NOT EXISTS idx_pricing_rules_hotel_active
  ON public.pricing_rules (hotel_id, active);
CREATE INDEX IF NOT EXISTS idx_pricing_rules_hotel_priority
  ON public.pricing_rules (hotel_id, priority ASC);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pricing_rules_updated_at ON public.pricing_rules;
CREATE TRIGGER trg_pricing_rules_updated_at
  BEFORE UPDATE ON public.pricing_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.pricing_rules IS
  'VAiyu Pricing Module: Occupancy-based pricing rules defined per hotel.';
COMMENT ON COLUMN public.pricing_rules.priority IS
  'Lower number = higher priority. First matching rule wins.';
