-- ============================================================================
-- Make the owner "System Health (24h)" card show REAL data
-- ============================================================================
-- Until now api_hits only ever received rate-limiter rows (key only); fn/ms/status
-- were never written, so v_api_24h / v_api_top_fns_24h could only ever report
-- 0 latency / 0 errors and a NULL function name. Edge functions now record full
-- request telemetry via _shared/http-telemetry.ts (withObs): rows with a non-null
-- `fn` and populated method/path/status/ms.
--
-- This migration:
--   1. Recreates both views to aggregate ONLY telemetry rows (fn IS NOT NULL) so
--      rate-limiter rows (fn NULL) are never counted as "calls", and to drop the
--      NULL-fn group from Top Functions. Re-asserts security_invoker + service_role-
--      only grants (the obs endpoint reads them as service_role; closed to anon).
--   2. Adds a partial index for the 24h telemetry scan.
--   3. Adds va_prune_api_hits() + a daily pg_cron job so the table can't grow
--      unbounded (the 24h views only need a short window; keep 7 days of margin).
-- ============================================================================

-- 1. Views — telemetry rows only --------------------------------------------------
CREATE OR REPLACE VIEW public.v_api_24h AS
  SELECT date_trunc('hour'::text, at) AS hour_bucket,
         count(*)                     AS calls,
         COALESCE(avg(ms)::integer, 0) AS avg_ms,
         sum(CASE WHEN status >= 400 AND status <= 499 THEN 1 ELSE 0 END) AS err_4xx,
         sum(CASE WHEN status >= 500 THEN 1 ELSE 0 END)                   AS err_5xx
    FROM public.api_hits
   WHERE at >= (now() - '24:00:00'::interval)
     AND fn IS NOT NULL
   GROUP BY (date_trunc('hour'::text, at))
   ORDER BY (date_trunc('hour'::text, at));

CREATE OR REPLACE VIEW public.v_api_top_fns_24h AS
  SELECT fn,
         count(*)                      AS calls,
         COALESCE(avg(ms)::integer, 0) AS avg_ms
    FROM public.api_hits
   WHERE at >= (now() - '24:00:00'::interval)
     AND fn IS NOT NULL
   GROUP BY fn
   ORDER BY (count(*)) DESC
   LIMIT 10;

-- Re-assert the security posture (CREATE OR REPLACE may not preserve options):
-- security_invoker so the caller's perms apply, and service-role-only access (the
-- obs endpoint reads these as service_role; anon/authenticated stay revoked).
ALTER VIEW public.v_api_24h         SET (security_invoker = true);
ALTER VIEW public.v_api_top_fns_24h SET (security_invoker = true);
REVOKE SELECT ON public.v_api_24h         FROM anon, authenticated;
REVOKE SELECT ON public.v_api_top_fns_24h FROM anon, authenticated;
GRANT  SELECT ON public.v_api_24h         TO service_role;
GRANT  SELECT ON public.v_api_top_fns_24h TO service_role;

-- 2. Index for the 24h telemetry scan --------------------------------------------
CREATE INDEX IF NOT EXISTS idx_api_hits_telemetry_at
  ON public.api_hits (at)
  WHERE fn IS NOT NULL;

-- 3. Retention -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.va_prune_api_hits()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE n bigint;
BEGIN
  DELETE FROM public.api_hits WHERE ts < now() - interval '7 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;
REVOKE ALL ON FUNCTION public.va_prune_api_hits() FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune_api_hits') THEN
      PERFORM cron.unschedule('prune_api_hits');
    END IF;
    PERFORM cron.schedule('prune_api_hits', '23 3 * * *', 'SELECT public.va_prune_api_hits();');
  END IF;
END $$;
