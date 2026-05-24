-- ============================================================
-- VAiyu: Occupancy-Based Dynamic Pricing
-- Migration 002: pricing_change_log (append-only audit trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pricing_change_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id              UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  room_type_id          UUID NULL,
  rule_id               UUID NULL
                          REFERENCES public.pricing_rules(id) ON DELETE SET NULL,
  previous_price        NUMERIC(12,2) NOT NULL,
  new_price             NUMERIC(12,2) NOT NULL,
  base_price_at_time    NUMERIC(12,2) NOT NULL,
  occupancy_pct_at_time NUMERIC(5,2) NOT NULL,
  adjustment_type       TEXT NOT NULL,
  adjustment_value      NUMERIC(12,2) NOT NULL,
  was_clamped           BOOLEAN NOT NULL DEFAULT FALSE,
  clamp_reason          TEXT NULL,
  matched_rule_name     TEXT NULL,
  explanation           TEXT NOT NULL,
  note                  TEXT NULL,
  applied_by            UUID NOT NULL,
  applied_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_change_log_hotel_id
  ON public.pricing_change_log (hotel_id);
CREATE INDEX IF NOT EXISTS idx_pricing_change_log_hotel_applied_at
  ON public.pricing_change_log (hotel_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_pricing_change_log_rule_id
  ON public.pricing_change_log (rule_id);

COMMENT ON TABLE public.pricing_change_log IS
  'VAiyu Pricing Module: Immutable audit log of every pricing apply action.';
