-- ============================================================
-- VAiyu: Financial Intelligence Layer
-- Migration 004: finance_categories
-- ============================================================
CREATE TABLE IF NOT EXISTS public.finance_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id   UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  code       TEXT NULL,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (hotel_id, name)
);

CREATE INDEX IF NOT EXISTS idx_finance_categories_hotel
  ON public.finance_categories (hotel_id);

DROP TRIGGER IF EXISTS trg_finance_categories_updated_at ON public.finance_categories;
CREATE TRIGGER trg_finance_categories_updated_at
  BEFORE UPDATE ON public.finance_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.finance_categories IS
  'VAiyu Finance Module: Operational expense categories per hotel.';

CREATE OR REPLACE FUNCTION public.seed_default_finance_categories(p_hotel_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.finance_categories (hotel_id, name, code, is_default)
  VALUES
    (p_hotel_id, 'Housekeeping',  'HK',   TRUE),
    (p_hotel_id, 'Maintenance',   'MAINT',TRUE),
    (p_hotel_id, 'Utilities',     'UTIL', TRUE),
    (p_hotel_id, 'F&B',           'FNB',  TRUE),
    (p_hotel_id, 'Staff',         'STAFF',TRUE),
    (p_hotel_id, 'Laundry',       'LAUN', TRUE),
    (p_hotel_id, 'Front Office',  'FO',   TRUE),
    (p_hotel_id, 'Marketing',     'MKT',  TRUE),
    (p_hotel_id, 'Miscellaneous', 'MISC', TRUE)
  ON CONFLICT (hotel_id, name) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.seed_default_finance_categories IS
  'Seeds 9 default operational finance categories for a hotel. Idempotent.';
