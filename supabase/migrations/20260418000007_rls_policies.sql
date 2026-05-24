-- ============================================================
-- VAiyu: RLS Policies for Pricing & Finance tables
-- Migration 007: Row Level Security
-- ============================================================
-- Authorization model (matches the rest of the codebase):
--   * Membership source of truth  : public.hotel_members (hotel_id, user_id, is_active)
--   * Role source of truth        : public.hotel_member_roles (M2M) -> public.hotel_roles (code)
--   * Legacy text role            : public.hotel_members.role (kept for fallback)
--   * Platform override           : public.is_platform_admin()
--
-- Manager-tier codes allowed to mutate pricing / finance rows:
--   OWNER, HOTEL_OWNER, ADMIN, ADMINISTRATOR, MANAGER,
--   GENERAL_MANAGER, FINANCE_MANAGER
--
-- Why NOT auth_hotel_id():
--   A user can be a member of multiple hotels. A "first-active-row"
--   helper would silently hide/deny access for every hotel after the
--   first. All policies here scope to the row's own hotel_id and
--   verify the caller has an active membership in *that* hotel.
-- ============================================================

-- ---------- Remove previous (broken) helpers if they exist ----------
DROP FUNCTION IF EXISTS public.auth_hotel_id() CASCADE;
DROP FUNCTION IF EXISTS public.auth_is_owner_or_admin() CASCADE;

-- ---------- Canonical helpers ----------

-- Any active member of the hotel (used for SELECT policies)
CREATE OR REPLACE FUNCTION public.vaiyu_is_hotel_member(p_hotel_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.hotel_members hm
    WHERE hm.user_id = auth.uid()
      AND hm.hotel_id = p_hotel_id
      AND hm.is_active = true
  );
$$;

-- Owner/admin/manager tier of the hotel (used for INSERT/UPDATE/DELETE
-- policies on sensitive finance/pricing rows). Accepts either the
-- RBAC role (hotel_member_roles -> hotel_roles.code) or the legacy
-- hotel_members.role text column. Platform admins are always allowed.
CREATE OR REPLACE FUNCTION public.vaiyu_is_hotel_finance_manager(p_hotel_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM public.hotel_members hm
      LEFT JOIN public.hotel_member_roles hmr
             ON hmr.hotel_member_id = hm.id
      LEFT JOIN public.hotel_roles hr
             ON hr.id = hmr.role_id
      WHERE hm.user_id   = auth.uid()
        AND hm.hotel_id  = p_hotel_id
        AND hm.is_active = true
        AND (
          -- RBAC path (preferred)
          hr.code IN (
            'OWNER', 'HOTEL_OWNER',
            'ADMIN', 'ADMINISTRATOR',
            'MANAGER', 'GENERAL_MANAGER',
            'FINANCE_MANAGER'
          )
          -- Legacy text-role fallback
          OR hm.role IN ('owner', 'admin', 'manager')
          OR hm.role IN ('OWNER', 'ADMIN', 'MANAGER', 'HOTEL_OWNER', 'FINANCE_MANAGER')
        )
    );
$$;

GRANT EXECUTE ON FUNCTION public.vaiyu_is_hotel_member(uuid)           TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vaiyu_is_hotel_finance_manager(uuid)  TO anon, authenticated, service_role;

-- ---------- Enable RLS ----------
ALTER TABLE public.pricing_rules           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_change_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_current_rates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_categories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_budget_plans    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_expenses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_manual_revenue  ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PRICING_RULES
-- ============================================================
DROP POLICY IF EXISTS "pricing_rules_select" ON public.pricing_rules;
CREATE POLICY "pricing_rules_select" ON public.pricing_rules
  FOR SELECT TO authenticated
  USING (public.vaiyu_is_hotel_member(hotel_id));

DROP POLICY IF EXISTS "pricing_rules_insert" ON public.pricing_rules;
CREATE POLICY "pricing_rules_insert" ON public.pricing_rules
  FOR INSERT TO authenticated
  WITH CHECK (public.vaiyu_is_hotel_finance_manager(hotel_id));

DROP POLICY IF EXISTS "pricing_rules_update" ON public.pricing_rules;
CREATE POLICY "pricing_rules_update" ON public.pricing_rules
  FOR UPDATE TO authenticated
  USING      (public.vaiyu_is_hotel_finance_manager(hotel_id))
  WITH CHECK (public.vaiyu_is_hotel_finance_manager(hotel_id));

DROP POLICY IF EXISTS "pricing_rules_delete" ON public.pricing_rules;
CREATE POLICY "pricing_rules_delete" ON public.pricing_rules
  FOR DELETE TO authenticated
  USING (public.vaiyu_is_hotel_finance_manager(hotel_id));

-- ============================================================
-- PRICING_CHANGE_LOG  (append-only audit trail; managers only read)
-- ============================================================
DROP POLICY IF EXISTS "pricing_change_log_select" ON public.pricing_change_log;
CREATE POLICY "pricing_change_log_select" ON public.pricing_change_log
  FOR SELECT TO authenticated
  USING (public.vaiyu_is_hotel_finance_manager(hotel_id));

DROP POLICY IF EXISTS "pricing_change_log_insert" ON public.pricing_change_log;
CREATE POLICY "pricing_change_log_insert" ON public.pricing_change_log
  FOR INSERT TO authenticated
  WITH CHECK (public.vaiyu_is_hotel_finance_manager(hotel_id));

-- No UPDATE or DELETE policies ==> audit trail is immutable for app-tier users.

-- ============================================================
-- PRICING_CURRENT_RATES
-- ============================================================
DROP POLICY IF EXISTS "pricing_current_rates_select" ON public.pricing_current_rates;
CREATE POLICY "pricing_current_rates_select" ON public.pricing_current_rates
  FOR SELECT TO authenticated
  USING (public.vaiyu_is_hotel_member(hotel_id));

DROP POLICY IF EXISTS "pricing_current_rates_insert" ON public.pricing_current_rates;
CREATE POLICY "pricing_current_rates_insert" ON public.pricing_current_rates
  FOR INSERT TO authenticated
  WITH CHECK (public.vaiyu_is_hotel_finance_manager(hotel_id));

DROP POLICY IF EXISTS "pricing_current_rates_update" ON public.pricing_current_rates;
CREATE POLICY "pricing_current_rates_update" ON public.pricing_current_rates
  FOR UPDATE TO authenticated
  USING      (public.vaiyu_is_hotel_finance_manager(hotel_id))
  WITH CHECK (public.vaiyu_is_hotel_finance_manager(hotel_id));

DROP POLICY IF EXISTS "pricing_current_rates_delete" ON public.pricing_current_rates;
CREATE POLICY "pricing_current_rates_delete" ON public.pricing_current_rates
  FOR DELETE TO authenticated
  USING (public.vaiyu_is_hotel_finance_manager(hotel_id));

-- ============================================================
-- FINANCE_CATEGORIES
-- ============================================================
DROP POLICY IF EXISTS "finance_categories_select" ON public.finance_categories;
CREATE POLICY "finance_categories_select" ON public.finance_categories
  FOR SELECT TO authenticated
  USING (public.vaiyu_is_hotel_member(hotel_id));

DROP POLICY IF EXISTS "finance_categories_insert" ON public.finance_categories;
CREATE POLICY "finance_categories_insert" ON public.finance_categories
  FOR INSERT TO authenticated
  WITH CHECK (public.vaiyu_is_hotel_finance_manager(hotel_id));

DROP POLICY IF EXISTS "finance_categories_update" ON public.finance_categories;
CREATE POLICY "finance_categories_update" ON public.finance_categories
  FOR UPDATE TO authenticated
  USING      (public.vaiyu_is_hotel_finance_manager(hotel_id))
  WITH CHECK (public.vaiyu_is_hotel_finance_manager(hotel_id));

DROP POLICY IF EXISTS "finance_categories_delete" ON public.finance_categories;
CREATE POLICY "finance_categories_delete" ON public.finance_categories
  FOR DELETE TO authenticated
  USING (public.vaiyu_is_hotel_finance_manager(hotel_id));

-- ============================================================
-- FINANCE_BUDGET_PLANS
-- ============================================================
DROP POLICY IF EXISTS "finance_budget_plans_select" ON public.finance_budget_plans;
CREATE POLICY "finance_budget_plans_select" ON public.finance_budget_plans
  FOR SELECT TO authenticated
  USING (public.vaiyu_is_hotel_member(hotel_id));

DROP POLICY IF EXISTS "finance_budget_plans_insert" ON public.finance_budget_plans;
CREATE POLICY "finance_budget_plans_insert" ON public.finance_budget_plans
  FOR INSERT TO authenticated
  WITH CHECK (public.vaiyu_is_hotel_finance_manager(hotel_id));

DROP POLICY IF EXISTS "finance_budget_plans_update" ON public.finance_budget_plans;
CREATE POLICY "finance_budget_plans_update" ON public.finance_budget_plans
  FOR UPDATE TO authenticated
  USING      (public.vaiyu_is_hotel_finance_manager(hotel_id))
  WITH CHECK (public.vaiyu_is_hotel_finance_manager(hotel_id));

DROP POLICY IF EXISTS "finance_budget_plans_delete" ON public.finance_budget_plans;
CREATE POLICY "finance_budget_plans_delete" ON public.finance_budget_plans
  FOR DELETE TO authenticated
  USING (public.vaiyu_is_hotel_finance_manager(hotel_id));

-- ============================================================
-- FINANCE_EXPENSES
-- ============================================================
DROP POLICY IF EXISTS "finance_expenses_select" ON public.finance_expenses;
CREATE POLICY "finance_expenses_select" ON public.finance_expenses
  FOR SELECT TO authenticated
  USING (public.vaiyu_is_hotel_member(hotel_id));

DROP POLICY IF EXISTS "finance_expenses_insert" ON public.finance_expenses;
CREATE POLICY "finance_expenses_insert" ON public.finance_expenses
  FOR INSERT TO authenticated
  WITH CHECK (public.vaiyu_is_hotel_finance_manager(hotel_id));

DROP POLICY IF EXISTS "finance_expenses_update" ON public.finance_expenses;
CREATE POLICY "finance_expenses_update" ON public.finance_expenses
  FOR UPDATE TO authenticated
  USING      (public.vaiyu_is_hotel_finance_manager(hotel_id))
  WITH CHECK (public.vaiyu_is_hotel_finance_manager(hotel_id));

DROP POLICY IF EXISTS "finance_expenses_delete" ON public.finance_expenses;
CREATE POLICY "finance_expenses_delete" ON public.finance_expenses
  FOR DELETE TO authenticated
  USING (public.vaiyu_is_hotel_finance_manager(hotel_id));

-- ============================================================
-- FINANCE_MANUAL_REVENUE
-- ============================================================
DROP POLICY IF EXISTS "finance_manual_revenue_select" ON public.finance_manual_revenue;
CREATE POLICY "finance_manual_revenue_select" ON public.finance_manual_revenue
  FOR SELECT TO authenticated
  USING (public.vaiyu_is_hotel_member(hotel_id));

DROP POLICY IF EXISTS "finance_manual_revenue_insert" ON public.finance_manual_revenue;
CREATE POLICY "finance_manual_revenue_insert" ON public.finance_manual_revenue
  FOR INSERT TO authenticated
  WITH CHECK (public.vaiyu_is_hotel_finance_manager(hotel_id));

DROP POLICY IF EXISTS "finance_manual_revenue_update" ON public.finance_manual_revenue;
CREATE POLICY "finance_manual_revenue_update" ON public.finance_manual_revenue
  FOR UPDATE TO authenticated
  USING      (public.vaiyu_is_hotel_finance_manager(hotel_id))
  WITH CHECK (public.vaiyu_is_hotel_finance_manager(hotel_id));

DROP POLICY IF EXISTS "finance_manual_revenue_delete" ON public.finance_manual_revenue;
CREATE POLICY "finance_manual_revenue_delete" ON public.finance_manual_revenue
  FOR DELETE TO authenticated
  USING (public.vaiyu_is_hotel_finance_manager(hotel_id));
