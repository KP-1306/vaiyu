-- ============================================================================
-- plan_prices — editable VAiyu subscription pricing for the Operator Console MRR
-- ============================================================================
-- There is no VAiyu plan→price source in the schema (rate_plan_prices is ROOM
-- pricing). This tiny reference table lets the Plan & Revenue panel compute real
-- ₹ MRR. Seeded at 0 so MRR reads cleanly until prices are set; reprice anytime
-- with no code change, e.g.:
--   UPDATE public.plan_prices SET monthly_inr = 1499 WHERE plan = 'starter';
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.plan_prices (
  plan        text PRIMARY KEY,
  monthly_inr numeric(10,2) NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.plan_prices (plan, monthly_inr) VALUES
  ('free', 0), ('starter', 0), ('pro', 0), ('enterprise', 0)
ON CONFLICT (plan) DO NOTHING;

-- RLS: platform admins may READ (a future in-app editor can use this); writes are
-- service_role / postgres only (no write policy), so pricing changes go through SQL
-- or a super-admin tool, never an ordinary client.
ALTER TABLE public.plan_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plan_prices_admin_read ON public.plan_prices;
CREATE POLICY plan_prices_admin_read ON public.plan_prices
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

GRANT SELECT ON public.plan_prices TO authenticated;
