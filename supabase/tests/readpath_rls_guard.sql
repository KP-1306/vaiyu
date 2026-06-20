-- ============================================================================
-- READ-PATH RLS GUARD (security ratchet)
-- ============================================================================
-- Fails (RAISE EXCEPTION → psql exits non-zero) if a migration reintroduces a
-- read-path leak of the classes cleaned up in the 2026-06 perimeter + view sweeps
-- (migrations 20260616000006, 20260620000001-0016):
--
--   R1  An anon-readable SECURITY DEFINER view. A view without
--       security_invoker=true runs as its owner (postgres) and BYPASSES RLS; if
--       also granted to anon, anyone with the public anon key reads ALL tenants'
--       data (the v_owner_*/Tier-A/-C leak class). New owner/reporting views MUST
--       be security_invoker=true and not granted to anon.
--
--   R2  A base table with an anon/public SELECT policy whose USING is literally
--       `true` — i.e. anon can read every row (the "Public read" policy class
--       dropped from profiles/precheckin_tokens/etc. in the base-table audit).
--
-- Companion to writepath_rls_guard.sql (which covers RLS-off tables + unscoped
-- writes). Together they ratchet the full read+write RLS perimeter.
--
-- HOW TO RUN locally (fully-migrated DB):
--   supabase db query --local --file supabase/tests/readpath_rls_guard.sql
-- CI runs it via .github/workflows/rpc-security-guard.yml on a fresh migrated DB.
--
-- IF THIS FAILS on your migration, do ONE of:
--   1. Fix it: ALTER VIEW ... SET (security_invoker = true) and/or REVOKE SELECT
--      FROM anon (R1); replace the USING(true) policy with a tenancy/ownership
--      predicate (R2). See migrations 20260620000010-0016.
--   2. If the read is INTENTIONALLY public (e.g. a v_public_hotels-style anon
--      bridge, a self-filtering guest view, or non-sensitive reference/menu data),
--      add it to the reviewed allowlist below WITH a one-line justification.
-- ============================================================================

DO $$
DECLARE
  v_r1 text;
  v_r2 text;
  v_msg text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname='checkout_stay' AND pronamespace='public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'Read-path RLS guard cannot run: schema not migrated (checkout_stay missing).';
  END IF;

  -- ── R1: anon-readable SECURITY DEFINER views ───────────────────────────────
  SELECT string_agg(c.relname, E'\n  ' ORDER BY c.relname)
  INTO v_r1
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'v'
    AND has_table_privilege('anon', c.oid, 'SELECT')
    AND NOT COALESCE(
          (SELECT option_value::bool FROM pg_options_to_table(c.reloptions) WHERE option_name='security_invoker'),
          false)
    -- ── Reviewed allowlist: intentional anon-readable definer views ──
    AND c.relname <> ALL (ARRAY[
      'v_public_hotels',        -- the intentional anon bridge (anon can't read raw hotels)
      'hotels_for_user',        -- self-filters by auth.uid()
      'user_bills_overview',    -- self-filters (returns 0 to plain anon)
      'v_guest_food_orders',    -- guest portal, self-filters by current_guest_id()
      'v_guest_tickets'         -- guest portal, self-filters
    ]);
    -- REMOVED from this allowlist 2026-06-21 (both now sealed, no longer anon-readable):
    --  • v_food_orders_sla_risk — was NOT self-filtering (no tenant predicate; spanned
    --    3 hotels on prod) → real cross-tenant leak. Sealed by 20260621000001
    --    (security_invoker + REVOKE anon).
    --  • v_api_24h / v_api_top_fns_24h — aggregate ops telemetry that was anon-readable
    --    only because obs.ts authenticated as anon. obs.ts moved to the service-role
    --    key; sealed by 20260621000002 (security_invoker + REVOKE anon,authenticated).

  -- ── R2: base tables with an anon/public USING(true) SELECT policy ──────────
  SELECT string_agg(p.tablename || '.' || p.policyname, E'\n  ' ORDER BY p.tablename, p.policyname)
  INTO v_r2
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.cmd IN ('SELECT', 'ALL')
    AND p.roles && ARRAY['anon','public']::name[]
    AND lower(regexp_replace(COALESCE(p.qual,'true'), '\s', '', 'g')) = 'true'
    AND p.tablename IN (
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r'
    )
    -- ── Reviewed allowlist: tables intentionally anon-readable (non-sensitive
    --    reference data + public QR-menu data) ──
    AND p.tablename <> ALL (ARRAY[
      'block_reasons','block_unblock_compatibility','cancel_reasons',
      'department_templates','hotel_onboarding_required_steps','service_templates',
      'sla_exception_reasons','system_role_template_permissions','system_role_templates',
      'system_room_type_templates','unblock_reasons','workforce_roles',  -- global reference data
      'menu_categories','menu_item_availability','menu_items'            -- public QR menu
    ]);

  IF v_r1 IS NOT NULL THEN
    v_msg := v_msg || E'\n[R1] anon-readable SECURITY DEFINER view(s) (bypass RLS → every-tenant read leak):\n  ' || v_r1 || E'\n';
  END IF;
  IF v_r2 IS NOT NULL THEN
    v_msg := v_msg || E'\n[R2] base table(s) with an anon/public USING(true) SELECT policy (anon reads every row):\n  ' || v_r2 || E'\n';
  END IF;

  IF v_msg <> '' THEN
    RAISE EXCEPTION E'READ-PATH RLS GUARD FAILED:%\nFix: security_invoker=true / REVOKE anon (R1), or a tenancy predicate on the SELECT policy (R2); or add to the reviewed allowlist in supabase/tests/readpath_rls_guard.sql with a justification.', v_msg;
  END IF;

  RAISE NOTICE 'Read-path RLS guard: OK — no anon-readable definer views and no anon USING(true) reads outside the allowlist.';
END $$;
