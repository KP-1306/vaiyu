-- ============================================================================
-- va_admin_api_latency — p95/p99 latency for the Operator Console health panel
-- ============================================================================
-- The health panel showed avg latency only, which hides the tail. PostgREST can't
-- do percentiles, so this RPC computes them over api_hits.ms for the window. Matches
-- the existing "calls" definition (fn IS NOT NULL — excludes rate-limit-rejected
-- requests, which carry fn=NULL). service_role only (same as va_admin_cron_health).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.va_admin_api_latency(p_hours int DEFAULT 24)
RETURNS TABLE(p95_ms int, p99_ms int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY ms), 0)::int AS p95_ms,
    coalesce(percentile_cont(0.99) WITHIN GROUP (ORDER BY ms), 0)::int AS p99_ms
  FROM public.api_hits
  WHERE at > now() - make_interval(hours => greatest(1, coalesce(p_hours, 24)))
    AND fn IS NOT NULL
    AND ms IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.va_admin_api_latency(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.va_admin_api_latency(int) TO service_role;
