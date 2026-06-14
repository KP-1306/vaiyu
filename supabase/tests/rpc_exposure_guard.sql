-- ============================================================================
-- RPC EXPOSURE GUARD (security ratchet)
-- ============================================================================
-- Fails (RAISE EXCEPTION → psql exits non-zero) if ANY public function is:
--     • executable by the anon role (directly or via the PUBLIC default grant),
--     • SECURITY DEFINER and VOLATILE (i.e. it mutates),
--     • a normal function (not a trigger / aggregate), and
--     • has NO authorization check in its body (no reference to any of the
--       known auth helpers / membership tables),
-- UNLESS it is in the reviewed allowlist below.
--
-- WHY: Postgres grants EXECUTE to PUBLIC by default and Supabase's `anon` role
-- inherits it, so every new SECURITY DEFINER function is born anon-callable. This
-- guard is the ratchet that stops a new migration from silently reintroducing the
-- anon-exposed-mutation class that the 2026-06-14 authorization sweep cleaned up.
--
-- HOW TO RUN locally (against a DB with all migrations applied):
--   docker exec -i supabase_db_<ref> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/rpc_exposure_guard.sql
-- CI runs it via .github/workflows/rpc-security-guard.yml on a fresh migrated DB.
--
-- IF THIS FAILS on your new function, do ONE of:
--   1. Add an authorization guard (e.g. vaiyu_is_hotel_member(hotel_id) /
--      is_platform_admin() / current_guest_id() ownership) AND
--      `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon;` (+ GRANT to the roles that
--      genuinely need it). This is the default — see migrations 20260614000001+.
--   2. If the function is INTENTIONALLY public (token-gated or public-by-design),
--      add it to the allowlist below WITH a one-line justification. Adding to the
--      allowlist is a security decision — it should be reviewed like one.
-- ============================================================================

DO $$
DECLARE
  v_violations text;
BEGIN
  -- Sanity: make sure migrations actually applied, so this can never give a
  -- false PASS against an empty/misconfigured schema (e.g. a CI run where the
  -- DB wasn't migrated). checkout_stay is a stable, always-present RPC.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'checkout_stay' AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'RPC exposure guard cannot run: schema not migrated (checkout_stay missing).';
  END IF;

  SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', E'\n  ' ORDER BY p.proname)
  INTO v_violations
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.prosecdef
    AND p.provolatile = 'v'
    AND p.prokind = 'f'
    AND p.prorettype <> 'pg_catalog.trigger'::regtype
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
    AND pg_get_functiondef(p.oid) !~* '(auth\.uid|auth\.role|is_platform_admin|vaiyu_is_hotel_member|vaiyu_is_hotel_finance_manager|vaiyu_can_view|current_guest_id|hotel_members|current_setting|session_user|current_user|jwt|platform_admin|is_hotel_member|has_role)'
    AND pg_get_functiondef(p.oid) ~* '(INSERT |UPDATE |DELETE )'
    -- ── Reviewed allowlist: intentionally public (token-gated / public-by-design) ──
    AND p.proname <> ALL (ARRAY[
      'create_lead_public',        -- public lead-capture form (anon by design)
      'record_package_view',       -- public package-page view analytics
      'submit_precheckin',         -- guest; validates the precheckin token internally
      'submit_public_feedback',    -- guest; validates the feedback token internally
      'validate_precheckin_token'  -- guest; validates the token it is handed
    ]);

  IF v_violations IS NOT NULL THEN
    RAISE EXCEPTION E'RPC EXPOSURE GUARD FAILED — anon-callable mutating SECURITY DEFINER function(s) with no auth guard and not allowlisted:\n  %\n\nFix: add an authorization guard + REVOKE EXECUTE FROM PUBLIC, anon (see migrations 20260614000001+); or, if intentionally public, add to the reviewed allowlist in supabase/tests/rpc_exposure_guard.sql with a justification.', v_violations;
  END IF;

  RAISE NOTICE 'RPC exposure guard: OK — no unguarded anon-exposed mutating functions outside the allowlist.';
END $$;
