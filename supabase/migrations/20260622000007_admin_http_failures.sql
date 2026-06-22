-- ============================================================================
-- va_admin_http_failures — surface pg_net HTTP failures the cron view can't see
-- ============================================================================
-- Blind spot found 2026-06-22: a cron job can report status 'succeeded' (it merely
-- ENQUEUES a net.http_post) while the actual HTTP call to the edge function times
-- out or returns 4xx/5xx. va_admin_cron_health() only reads cron.job_run_details,
-- so it shows green while a function is silently failing. This RPC reads
-- net._http_response (the request OUTCOMES) so admin-alerts + the Operator Console
-- summary can alert on it.
--
-- SECURITY DEFINER because the `net` schema is not PostgREST-exposed (same reason
-- as va_admin_cron_health for `cron`). service_role only. Buckets are disjoint:
-- failures = timeouts + http_4xx + http_5xx.
-- NOTE: a pg_net timeout/connection error stores status_code=NULL AND timed_out=NULL
-- (NOT true) — so detect no-response failures via status_code IS NULL, never timed_out.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.va_admin_http_failures(p_minutes int DEFAULT 15)
RETURNS TABLE(failures bigint, timeouts bigint, http_4xx bigint, http_5xx bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    count(*) FILTER (WHERE r.status_code IS NULL OR r.status_code >= 400) AS failures,
    count(*) FILTER (WHERE r.status_code IS NULL)                         AS timeouts,
    count(*) FILTER (WHERE r.status_code BETWEEN 400 AND 499)             AS http_4xx,
    count(*) FILTER (WHERE r.status_code >= 500)                          AS http_5xx
  FROM net._http_response r
  WHERE r.created > now() - make_interval(mins => greatest(1, coalesce(p_minutes, 15)));
$$;

REVOKE ALL ON FUNCTION public.va_admin_http_failures(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.va_admin_http_failures(int) TO service_role;

COMMENT ON FUNCTION public.va_admin_http_failures(int) IS
  'Counts recent pg_net HTTP failures (timeouts + 4xx/5xx) from cron->edge-function calls in the last p_minutes. Catches functions failing while their cron shows "succeeded". SECURITY DEFINER (net schema not PostgREST-exposed); service_role only.';
