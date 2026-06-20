-- ============================================================================
-- WRITE-PATH RLS GUARD (security ratchet)
-- ============================================================================
-- Fails (RAISE EXCEPTION → psql exits non-zero) if a migration reintroduces any
-- of the write-path holes closed by the 2026-06-20 write-path audit
-- (migrations 20260620000010-0014). Three checks:
--
--   W1  A public BASE TABLE has RLS DISABLED. Postgres + Supabase grant anon/
--       authenticated blanket DML on `public` by default, so an RLS-off table is
--       client-writable. Repo convention is RLS-on for every base table.
--
--   W2  A PERMISSIVE policy granted to a CLIENT role (anon / authenticated /
--       public — i.e. NOT service_role-only) permits an UNSCOPED INSERT: its
--       effective INSERT check is literally `true`. The effective check is
--       COALESCE(with_check, qual) because for an ALL/UPDATE policy with WITH
--       CHECK omitted, Postgres uses the USING expression as the check — so a
--       scoped "Staff manage X" ALL policy (USING <hotel scope>, no WITH CHECK)
--       is correctly NOT flagged. This also catches the {public}-ALL gotcha
--       (USING (auth.role()='service_role') WITH CHECK (true) still lets anon
--       INSERT, because INSERT ignores USING).
--
--   W3  A PERMISSIVE policy granted to a CLIENT role permits an UNSCOPED
--       UPDATE/DELETE: its USING qual is literally `true`.
--
-- WHY: these are exactly the classes the write-path audit cleaned up, and which
-- Postgres' default grants + RLS semantics make easy to reintroduce. Read-side
-- exposure (SELECT policies) is intentionally OUT OF SCOPE here — public
-- reference-data reads (e.g. cancel_reasons SELECT USING(true)) are by design.
--
-- HOW TO RUN locally (against a fully-migrated DB):
--   supabase db query --local --file supabase/tests/writepath_rls_guard.sql
-- CI runs it via .github/workflows/rpc-security-guard.yml on a fresh migrated DB.
--
-- IF THIS FAILS on your new migration, do ONE of:
--   1. Fix it: ENABLE RLS (+ a scoped policy / revoke client grants) for W1; add a
--      real tenancy predicate (vaiyu_is_hotel_member(hotel_id) / EXISTS(...) /
--      a column constraint like status='pending') to WITH CHECK / USING for
--      W2/W3. See migrations 20260620000010-0014 for the patterns.
--   2. If the open write is INTENTIONAL (public-by-design intake), add the
--      table.policy (W2/W3) or table (W1) to the reviewed allowlist below WITH a
--      one-line justification. Allowlisting is a security decision — review it.
-- ============================================================================

DO $$
DECLARE
  v_w1 text;
  v_w2 text;
  v_w3 text;
  v_msg text := '';
BEGIN
  -- Sanity: ensure migrations actually applied, so this can never false-PASS on
  -- an empty/unmigrated schema. checkout_stay is a stable, always-present RPC.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'checkout_stay' AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'Write-path RLS guard cannot run: schema not migrated (checkout_stay missing).';
  END IF;

  -- ── W1: base tables with RLS disabled ──────────────────────────────────────
  SELECT string_agg(c.relname, E'\n  ' ORDER BY c.relname)
  INTO v_w1
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'                 -- ordinary base tables only (not views/partitioned parents)
    AND c.relrowsecurity = false
    -- ── Reviewed allowlist: base tables intentionally RLS-off ──
    AND c.relname <> ALL (ARRAY[
      ''::name   -- (none yet) e.g. extension-owned helper tables with no client grant
    ]);

  -- ── W2: client-role policies permitting an UNSCOPED INSERT ──────────────────
  SELECT string_agg(p.tablename || '.' || p.policyname, E'\n  ' ORDER BY p.tablename, p.policyname)
  INTO v_w2
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.cmd IN ('INSERT', 'ALL')
    AND p.roles && ARRAY['anon','authenticated','public']::name[]
    AND NOT (p.roles = ARRAY['service_role']::name[])
    AND lower(regexp_replace(COALESCE(p.with_check, p.qual, 'true'), '\s', '', 'g')) = 'true'
    -- ── Reviewed allowlist: intentional public-by-design INSERT ──
    AND (p.tablename || '.' || p.policyname) <> ALL (ARRAY[
      ''::text   -- (none) public intakes are column-scoped (status='pending', stage='applied', job_id NOT NULL)
    ]);

  -- ── W3: client-role policies permitting an UNSCOPED UPDATE/DELETE ───────────
  SELECT string_agg(p.tablename || '.' || p.policyname, E'\n  ' ORDER BY p.tablename, p.policyname)
  INTO v_w3
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.cmd IN ('UPDATE', 'DELETE', 'ALL')
    AND p.roles && ARRAY['anon','authenticated','public']::name[]
    AND NOT (p.roles = ARRAY['service_role']::name[])
    AND p.qual IS NOT NULL
    AND lower(regexp_replace(p.qual, '\s', '', 'g')) = 'true'
    -- ── Reviewed allowlist: intentional public-by-design UPDATE/DELETE ──
    AND (p.tablename || '.' || p.policyname) <> ALL (ARRAY[
      ''::text   -- (none)
    ]);

  IF v_w1 IS NOT NULL THEN
    v_msg := v_msg || E'\n[W1] base table(s) with RLS DISABLED (client-writable via default grant):\n  ' || v_w1 || E'\n';
  END IF;
  IF v_w2 IS NOT NULL THEN
    v_msg := v_msg || E'\n[W2] policy(ies) permitting an UNSCOPED INSERT by a client role (effective WITH CHECK is true):\n  ' || v_w2 || E'\n';
  END IF;
  IF v_w3 IS NOT NULL THEN
    v_msg := v_msg || E'\n[W3] policy(ies) permitting an UNSCOPED UPDATE/DELETE by a client role (USING is true):\n  ' || v_w3 || E'\n';
  END IF;

  IF v_msg <> '' THEN
    RAISE EXCEPTION E'WRITE-PATH RLS GUARD FAILED:%\nFix: add RLS / a tenancy predicate (see migrations 20260620000010-0014), or add to the reviewed allowlist in supabase/tests/writepath_rls_guard.sql with a justification.', v_msg;
  END IF;

  RAISE NOTICE 'Write-path RLS guard: OK — no RLS-off base tables and no unscoped client write policies outside the allowlist.';
END $$;
