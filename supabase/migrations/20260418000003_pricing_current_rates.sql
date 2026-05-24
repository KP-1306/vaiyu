-- ============================================================
-- VAiyu: Occupancy-Based Dynamic Pricing
-- Migration 003: pricing_current_rates (active override layer)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pricing_current_rates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id       UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  room_type_id   UUID NULL REFERENCES public.room_types(id) ON DELETE CASCADE,
  base_price     NUMERIC(12,2) NOT NULL,
  override_price NUMERIC(12,2) NOT NULL,
  rule_id        UUID NULL
                   REFERENCES public.pricing_rules(id) ON DELETE SET NULL,
  applied_by     UUID NOT NULL,
  applied_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NULL,

  UNIQUE (hotel_id, room_type_id)
);

CREATE INDEX IF NOT EXISTS idx_pricing_current_rates_hotel
  ON public.pricing_current_rates (hotel_id);

COMMENT ON TABLE public.pricing_current_rates IS
  'VAiyu Pricing Module: Active override rate per room type. NULL room_type_id = property-wide override.';
