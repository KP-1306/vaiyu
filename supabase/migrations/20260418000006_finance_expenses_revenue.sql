-- ============================================================
-- VAiyu: Financial Intelligence Layer
-- Migration 006: finance_expenses + finance_manual_revenue
-- ============================================================

-- 6A: Expense entries
CREATE TABLE IF NOT EXISTS public.finance_expenses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id       UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  expense_date   DATE NOT NULL,
  category_id    UUID NOT NULL
                   REFERENCES public.finance_categories(id) ON DELETE RESTRICT,
  amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  description    TEXT NOT NULL,
  vendor_name    TEXT NULL,
  payment_mode   TEXT NULL
                   CHECK (payment_mode IS NULL OR payment_mode IN (
                     'cash', 'bank_transfer', 'upi', 'card', 'cheque', 'other'
                   )),
  attachment_url TEXT NULL,
  created_by     UUID NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_expenses_hotel
  ON public.finance_expenses (hotel_id);
CREATE INDEX IF NOT EXISTS idx_finance_expenses_hotel_date
  ON public.finance_expenses (hotel_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_finance_expenses_hotel_category
  ON public.finance_expenses (hotel_id, category_id);

DROP TRIGGER IF EXISTS trg_finance_expenses_updated_at ON public.finance_expenses;
CREATE TRIGGER trg_finance_expenses_updated_at
  BEFORE UPDATE ON public.finance_expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.finance_expenses IS
  'VAiyu Finance Module: Manual operational expense entries per hotel.';

-- 6B: Manual revenue entries (used when booking revenue cannot be reliably queried)
CREATE TABLE IF NOT EXISTS public.finance_manual_revenue (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id     UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  revenue_date DATE NOT NULL,
  revenue_type TEXT NOT NULL DEFAULT 'room'
                 CHECK (revenue_type IN ('room', 'f&b', 'events', 'other')),
  amount       NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  notes        TEXT NULL,
  created_by   UUID NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_manual_revenue_hotel
  ON public.finance_manual_revenue (hotel_id);
CREATE INDEX IF NOT EXISTS idx_finance_manual_revenue_hotel_date
  ON public.finance_manual_revenue (hotel_id, revenue_date DESC);

DROP TRIGGER IF EXISTS trg_finance_manual_revenue_updated_at ON public.finance_manual_revenue;
CREATE TRIGGER trg_finance_manual_revenue_updated_at
  BEFORE UPDATE ON public.finance_manual_revenue
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.finance_manual_revenue IS
  'VAiyu Finance Module: Fallback manual revenue entries per hotel.';
