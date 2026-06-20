-- ============================================================================
-- Close anon read of internal ops telemetry: v_api_24h / v_api_top_fns_24h
-- ============================================================================
-- Both were SECURITY DEFINER views over api_hits (which is service_role-only since
-- 20260620000008) and were granted to anon. api_hits has NO tenant dimension and no
-- PII — so this was information disclosure of aggregate ops metrics (traffic volume,
-- edge-function names, latency, error counts) to anyone with the public anon key,
-- NOT a cross-tenant data leak. They were anon+definer only because the obs endpoint
-- (web/functions/obs.ts) authenticated as anon.
--
-- COORDINATED CHANGE: obs.ts now authenticates with the SERVICE-ROLE key. This
-- migration flips both views to security_invoker and revokes anon/authenticated, so
-- only service_role (the obs endpoint, which bypasses RLS and can read api_hits) can
-- read them. Deploy ORDER matters — see the migration's PR note:
--   1. set SUPABASE_SERVICE_ROLE_KEY in the Netlify env,
--   2. deploy obs.ts (so the endpoint uses the service-role key),
--   3. THEN push this migration.
-- Deploying this before step 2 would make the ObservabilityCard error until the
-- function is redeployed (cosmetic only — api_hits is currently empty on prod).
-- ============================================================================

ALTER VIEW public.v_api_24h        SET (security_invoker = true);
ALTER VIEW public.v_api_top_fns_24h SET (security_invoker = true);

-- Service-role-only ops telemetry: revoke every client role, (re)assert service_role.
REVOKE SELECT ON public.v_api_24h        FROM anon, authenticated;
REVOKE SELECT ON public.v_api_top_fns_24h FROM anon, authenticated;
GRANT  SELECT ON public.v_api_24h        TO service_role;
GRANT  SELECT ON public.v_api_top_fns_24h TO service_role;
