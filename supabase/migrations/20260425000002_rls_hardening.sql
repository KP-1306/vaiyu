-- ============================================================
-- VAiyu Pricing – RLS hardening (production blocker fix)
-- ============================================================
-- Earlier migrations added permissive `USING (true)` policies as a
-- fallback because they expected a `user_is_hotel_owner()` helper that
-- doesn't exist in this codebase. The actual helpers are
-- `vaiyu_is_hotel_finance_manager` (writes) and `vaiyu_is_hotel_member`
-- (reads), used by every pre-existing pricing table.
--
-- This migration replaces the permissive policies with role-correct
-- ones, matching the existing `pricing_rules` / `pricing_current_rates`
-- pattern.
-- ============================================================

-- ─── rate_plans ────────────────────────────────────────────
DROP POLICY IF EXISTS rate_plans_owner_rw ON public.rate_plans;
DROP POLICY IF EXISTS rate_plans_select   ON public.rate_plans;
DROP POLICY IF EXISTS rate_plans_insert   ON public.rate_plans;
DROP POLICY IF EXISTS rate_plans_update   ON public.rate_plans;
DROP POLICY IF EXISTS rate_plans_delete   ON public.rate_plans;

CREATE POLICY rate_plans_select ON public.rate_plans
  FOR SELECT TO authenticated
  USING (public.vaiyu_is_hotel_member(hotel_id));

CREATE POLICY rate_plans_insert ON public.rate_plans
  FOR INSERT TO authenticated
  WITH CHECK (public.vaiyu_is_hotel_finance_manager(hotel_id));

CREATE POLICY rate_plans_update ON public.rate_plans
  FOR UPDATE TO authenticated
  USING  (public.vaiyu_is_hotel_finance_manager(hotel_id))
  WITH CHECK (public.vaiyu_is_hotel_finance_manager(hotel_id));

CREATE POLICY rate_plans_delete ON public.rate_plans
  FOR DELETE TO authenticated
  USING (public.vaiyu_is_hotel_finance_manager(hotel_id));


-- ─── rate_plan_prices ──────────────────────────────────────
DROP POLICY IF EXISTS rate_plan_prices_owner_rw ON public.rate_plan_prices;
DROP POLICY IF EXISTS rate_plan_prices_select   ON public.rate_plan_prices;
DROP POLICY IF EXISTS rate_plan_prices_insert   ON public.rate_plan_prices;
DROP POLICY IF EXISTS rate_plan_prices_update   ON public.rate_plan_prices;
DROP POLICY IF EXISTS rate_plan_prices_delete   ON public.rate_plan_prices;

CREATE POLICY rate_plan_prices_select ON public.rate_plan_prices
  FOR SELECT TO authenticated
  USING (public.vaiyu_is_hotel_member(hotel_id));

CREATE POLICY rate_plan_prices_insert ON public.rate_plan_prices
  FOR INSERT TO authenticated
  WITH CHECK (public.vaiyu_is_hotel_finance_manager(hotel_id));

CREATE POLICY rate_plan_prices_update ON public.rate_plan_prices
  FOR UPDATE TO authenticated
  USING  (public.vaiyu_is_hotel_finance_manager(hotel_id))
  WITH CHECK (public.vaiyu_is_hotel_finance_manager(hotel_id));

CREATE POLICY rate_plan_prices_delete ON public.rate_plan_prices
  FOR DELETE TO authenticated
  USING (public.vaiyu_is_hotel_finance_manager(hotel_id));


-- ─── rate_restrictions ─────────────────────────────────────
DROP POLICY IF EXISTS rate_restrictions_owner_rw ON public.rate_restrictions;
DROP POLICY IF EXISTS rate_restrictions_select   ON public.rate_restrictions;
DROP POLICY IF EXISTS rate_restrictions_insert   ON public.rate_restrictions;
DROP POLICY IF EXISTS rate_restrictions_update   ON public.rate_restrictions;
DROP POLICY IF EXISTS rate_restrictions_delete   ON public.rate_restrictions;

-- Reads are wider (any hotel member) so the walk-in screen can fetch
-- restrictions for stop-sell / min-LOS enforcement. Writes are gated.
CREATE POLICY rate_restrictions_select ON public.rate_restrictions
  FOR SELECT TO authenticated
  USING (public.vaiyu_is_hotel_member(hotel_id));

CREATE POLICY rate_restrictions_insert ON public.rate_restrictions
  FOR INSERT TO authenticated
  WITH CHECK (public.vaiyu_is_hotel_finance_manager(hotel_id));

CREATE POLICY rate_restrictions_update ON public.rate_restrictions
  FOR UPDATE TO authenticated
  USING  (public.vaiyu_is_hotel_finance_manager(hotel_id))
  WITH CHECK (public.vaiyu_is_hotel_finance_manager(hotel_id));

CREATE POLICY rate_restrictions_delete ON public.rate_restrictions
  FOR DELETE TO authenticated
  USING (public.vaiyu_is_hotel_finance_manager(hotel_id));


-- ─── pricing_adjustments ───────────────────────────────────
-- Audit table — read by hotel members for the dashboard card,
-- writes happen only via SECURITY DEFINER RPC (create_walkin_v2)
-- so authenticated INSERT is intentionally NOT granted.
DROP POLICY IF EXISTS pricing_adjustments_owner_rw ON public.pricing_adjustments;
DROP POLICY IF EXISTS pricing_adjustments_select   ON public.pricing_adjustments;
DROP POLICY IF EXISTS pricing_adjustments_update   ON public.pricing_adjustments;
DROP POLICY IF EXISTS pricing_adjustments_delete   ON public.pricing_adjustments;

CREATE POLICY pricing_adjustments_select ON public.pricing_adjustments
  FOR SELECT TO authenticated
  USING (public.vaiyu_is_hotel_member(hotel_id));

-- No INSERT/UPDATE/DELETE policies → only service_role (and SECURITY
-- DEFINER RPCs that bypass RLS) can mutate. This protects the audit
-- trail from being edited after the fact.
