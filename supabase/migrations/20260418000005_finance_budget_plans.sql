-- ============================================================
-- VAiyu: Financial Intelligence Layer
-- Migration 005: finance_budget_plans
-- ============================================================
CREATE TABLE IF NOT EXISTS public.finance_budget_plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id      UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  budget_month  DATE NOT NULL,
  category_id   UUID NOT NULL
                  REFERENCES public.finance_categories(id) ON DELETE RESTRICT,
  budget_amount NUMERIC(14,2) NOT NULL CHECK (budget_amount >= 0),
  notes         TEXT NULL,
  created_by    UUID NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (hotel_id, budget_month, category_id)
);

CREATE INDEX IF NOT EXISTS idx_finance_budget_plans_hotel
  ON public.finance_budget_plans (hotel_id);
CREATE INDEX IF NOT EXISTS idx_finance_budget_plans_hotel_month
  ON public.finance_budget_plans (hotel_id, budget_month DESC);

DROP TRIGGER IF EXISTS trg_finance_budget_plans_updated_at ON public.finance_budget_plans;
CREATE TRIGGER trg_finance_budget_plans_updated_at
  BEFORE UPDATE ON public.finance_budget_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.finance_budget_plans IS
  'VAiyu Finance Module: Monthly operational budget per category per hotel.';
COMMENT ON COLUMN public.finance_budget_plans.budget_month IS
  'Stored as first day of target month (YYYY-MM-01).';
