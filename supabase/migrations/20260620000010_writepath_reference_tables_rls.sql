-- ============================================================
-- VAiyu WRITE-PATH AUDIT (1/5): global reference/template tables
-- ============================================================
-- FINDING (class A): 12 GLOBAL reference/template tables shipped with RLS
-- DISABLED. Postgres + Supabase grant INSERT/UPDATE/DELETE to `anon` by default,
-- and with RLS off that grant is LIVE — so an unauthenticated client could
-- DELETE or corrupt the templates EVERY hotel onboards from (e.g. wipe
-- system_role_templates / hotel_onboarding_required_steps → new hotels can't
-- onboard; inject junk cancel_reasons shown in every hotel's UI). Cross-tenant
-- blast radius, integrity/availability (not PII).
--
-- These tables are GLOBAL (verified: none has hotel_id) and READ-ONLY from the
-- app: every web/src reference is a `.select` (dropdowns / onboarding clone
-- sources). The ONLY writers are seed.sql + migrations, which run as `postgres`
-- (table owner → exempt from RLS). sla_policies is NOT in this list — it is
-- owner-written and hotel-scoped; handled in migration ...0011.
--
-- FIX: enable RLS, add a public SELECT policy (preserves all reads), and revoke
-- the anon/authenticated/PUBLIC write grants (defense-in-depth on top of the
-- now-deny-by-default write path). service_role keeps full access for any
-- server-side maintenance. Idempotent.
-- ============================================================

DO $$
DECLARE
  t text;
  ref_tables text[] := ARRAY[
    'block_reasons',
    'block_unblock_compatibility',
    'cancel_reasons',
    'department_templates',
    'hotel_onboarding_required_steps',
    'service_templates',
    'sla_exception_reasons',
    'system_role_template_permissions',
    'system_role_templates',
    'system_room_type_templates',
    'unblock_reasons',
    'workforce_roles'
  ];
BEGIN
  FOREACH t IN ARRAY ref_tables LOOP
    -- Skip cleanly if a table is absent in some environment.
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
    ) THEN
      RAISE NOTICE 'writepath ref-tables: % not present, skipping', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);

    -- Public read: global, non-sensitive reference data; reads must keep working
    -- for anon (public pages) and authenticated (owner console dropdowns).
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_ref_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true);',
      t || '_ref_read', t
    );

    -- Deny client writes (belt-and-suspenders alongside the no-write-policy RLS
    -- default). Seed/migrations write as postgres (owner) and bypass RLS.
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon, authenticated, PUBLIC;', t);
    EXECUTE format('GRANT  SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role;', t);
  END LOOP;
END $$;
