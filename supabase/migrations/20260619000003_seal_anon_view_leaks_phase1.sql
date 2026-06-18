-- ============================================================
-- VAiyu: App-wide view-leak sweep — Phase 1 (seal the anon/public exposure)
-- ============================================================
-- FOUND 2026-06-19: an app-wide audit found ~47 views with the leak signature
-- (PLAIN view => bypasses base-table RLS, AND granted SELECT to anon) that are
-- hotel-scoped. Confirmed LIVE on prod with the anon key: anonymous internet
-- callers could read e.g. owner_revenue_daily_v (revenue, 15 rows),
-- owner_hotel_occupancy_daily (330), v_guest_*_base (guest PII, 59),
-- v_my_food_orders (20), v_housekeeping_operational_board (198), etc.
-- This is the same class already fixed for the v_owner_/v_arrival_/v_ops_
-- families — here swept across the whole schema.
--
-- PHASE 1 (this migration): REVOKE the anon/PUBLIC grant on every signature-
-- matching view. This immediately seals the UNAUTHENTICATED (open-internet)
-- exposure — the most severe part — with ZERO risk to authenticated screens:
--   * the view bodies and security_invoker flags are left untouched, so every
--     authenticated owner/staff/guest sees byte-identical results to before;
--   * all consumers are authenticated (owner dashboards, staff boards, and the
--     guest portal, which uses real auth sessions: current_guest_id() maps
--     auth.uid() -> guest via guest_user_map).
--
-- Done by SIGNATURE (dynamic), so nothing is missed, with two deliberate
-- exclusions kept anon-readable pending a public-use review:
--   * v_effective_room_price  (read by the availability/pricing flow)
--   * v_partner_directory     (possible public partner listing)
-- and v_public_hotels (intentionally anon).
--
-- PHASE 2 (next migration): authenticated cross-tenant scoping (plain + explicit
-- membership/guest filter, output-identity proven) so a logged-in user of one
-- hotel also cannot read another hotel's rows.
-- ============================================================

DO $$
DECLARE r record;
        n int := 0;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND c.relkind = 'v'
      -- plain view (RLS-bypassing): security_invoker not enabled
      AND (SELECT option_value FROM pg_options_to_table(c.reloptions)
           WHERE option_name = 'security_invoker') IS DISTINCT FROM 'true'
      -- currently anon-readable
      AND has_table_privilege('anon', format('public.%I', c.relname)::regclass, 'SELECT')
      -- hotel-scoped (tenant data)
      AND EXISTS (SELECT 1 FROM information_schema.columns col
                  WHERE col.table_schema = 'public' AND col.table_name = c.relname
                    AND col.column_name = 'hotel_id')
      AND c.relname NOT IN (
        'v_public_hotels',          -- intentionally anon (public hotel resolution)
        'v_effective_room_price',   -- excluded: pricing/availability flow (Phase 1b review)
        'v_partner_directory'       -- excluded: possible public listing (Phase 1b review)
      )
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', r.relname);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', r.relname);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', r.relname);
    n := n + 1;
    RAISE NOTICE 'Phase1 sealed anon on %', r.relname;
  END LOOP;
  RAISE NOTICE 'Phase1 total views sealed: %', n;
END $$;
