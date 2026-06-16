-- 20260616000006_owner_views_security_invoker.sql
--
-- SECURITY (P0): close a cross-tenant + anonymous data leak across ALL owner
-- analytics views.
--
-- Every public.v_owner_* view was a PLAIN view (owned by postgres, no
-- security_invoker) with NO membership filter, and SELECT was granted to anon +
-- PUBLIC. A plain view owned by postgres bypasses RLS on the underlying tables,
-- so anyone with the public anon key (shipped in the frontend bundle) could read
-- EVERY hotel's tickets / SLA / occupancy / staff / check-in data via PostgREST.
-- Proven on prod: `SET ROLE anon; SELECT count(DISTINCT hotel_id) FROM
-- v_owner_kpi_summary;` returned 4 hotels.
--
-- Fix (mirrors the v_ops_* views, which are already security_invoker):
--   1. SET (security_invoker = on)  → underlying-table RLS now applies to the
--      QUERYING user. Owners/supervisors keep full hotel scope via
--      `supervisors_and_owners_see_all_tickets`, `stays_select_for_members`,
--      etc.; non-members (and anon) get zero rows.
--   2. REVOKE SELECT FROM PUBLIC, anon (defence-in-depth: no owner view is ever
--      anonymous) and GRANT SELECT TO authenticated explicitly so the grant is
--      not lost when PUBLIC is revoked.
--
-- Idempotent: re-running ALTER/REVOKE/GRANT is safe. Verified locally
-- (owner still sees data via the dashboard; anon sees nothing) before deploy.

DO $$
DECLARE
  v text;
  owner_views text[] := ARRAY[
    'v_owner_activity_breakdown',
    'v_owner_arrivals_dashboard',
    'v_owner_at_risk_breakdown',
    'v_owner_block_reason_analysis',
    'v_owner_checkin_trend_daily',
    'v_owner_kpi_summary',
    'v_owner_kpis_ist',
    'v_owner_occupancy_stats',
    'v_owner_sla_breach_breakdown',
    'v_owner_sla_exception_breakdown',
    'v_owner_sla_impact_waterfall',
    'v_owner_sla_trend_daily',
    'v_owner_staff_performance',
    'v_owner_ticket_activity'
  ];
BEGIN
  FOREACH v IN ARRAY owner_views LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = on)', v);
    EXECUTE format('REVOKE SELECT ON public.%I FROM PUBLIC', v);
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon', v);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v);
  END LOOP;
END $$;
