-- ============================================================================
-- va_admin_api_series / va_admin_api_top_fns — windowed telemetry for the
-- Operator Console System-Health range toggle (24h / 7d)
-- ============================================================================
-- The health panel previously read the FIXED 24h views v_api_24h /
-- v_api_top_fns_24h. Those are shared with the owner-facing ObservabilityCard,
-- so they stay untouched; these RPCs are the parameterized equivalents that let
-- the operator pick a window. api_hits retains 7 days (va_prune_api_hits), so the
-- window is capped at 168h — never offer a range the data can't honestly serve.
--
-- Adaptive bucketing keeps the sparkline readable across windows: hourly buckets
-- for <=48h (<=48 bars), 6-hour buckets beyond (7d -> 28 bars). Both filter
-- fn IS NOT NULL (telemetry rows only; rate-limiter rows carry fn=NULL) so the
-- partial index idx_api_hits_telemetry_at applies. service_role only, matching
-- va_admin_api_latency / va_admin_cron_health.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.va_admin_api_series(p_hours int DEFAULT 24)
RETURNS TABLE(hour_bucket timestamptz, calls bigint, avg_ms int, err_4xx bigint, err_5xx bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    to_timestamp(floor(extract(epoch FROM at) / b.bsec) * b.bsec)  AS hour_bucket,
    count(*)                                                        AS calls,
    coalesce(avg(ms)::int, 0)                                       AS avg_ms,
    sum(CASE WHEN status BETWEEN 400 AND 499 THEN 1 ELSE 0 END)     AS err_4xx,
    sum(CASE WHEN status >= 500 THEN 1 ELSE 0 END)                  AS err_5xx
  FROM public.api_hits
  CROSS JOIN LATERAL (SELECT least(168, greatest(1, coalesce(p_hours, 24))) AS hrs) h
  CROSS JOIN LATERAL (SELECT CASE WHEN h.hrs <= 48 THEN 3600 ELSE 21600 END AS bsec) b
  WHERE at >= now() - make_interval(hours => h.hrs)
    AND fn IS NOT NULL
  GROUP BY 1
  ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION public.va_admin_api_top_fns(p_hours int DEFAULT 24)
RETURNS TABLE(fn text, calls bigint, avg_ms int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT fn, count(*) AS calls, coalesce(avg(ms)::int, 0) AS avg_ms
  FROM public.api_hits
  WHERE at >= now() - make_interval(hours => least(168, greatest(1, coalesce(p_hours, 24))))
    AND fn IS NOT NULL
  GROUP BY fn
  ORDER BY count(*) DESC
  LIMIT 10;
$$;

REVOKE ALL ON FUNCTION public.va_admin_api_series(int)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.va_admin_api_top_fns(int)  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.va_admin_api_series(int)  TO service_role;
GRANT EXECUTE ON FUNCTION public.va_admin_api_top_fns(int) TO service_role;
