-- 20260513000001_api_hits_cleanup.sql
--
-- The api_hits table backs the per-user rate limiter (`rateLimitForUser` in
-- _shared/auth.ts). Every authenticated request to a rate-limited Edge
-- Function inserts a row, but the rate-limit window is only 60s. Without
-- cleanup, the table grows unbounded — a year of moderate traffic = millions
-- of dead rows hammering query latency.
--
-- This migration:
--   1. Adds a partial index on `ts` (for time-window queries).
--   2. Creates `prune_api_hits()` that deletes rows older than 1 hour
--      (10× the longest live window — generous safety margin).
--   3. Schedules it via pg_cron every 15 minutes.
--
-- Apply: docker exec | psql | INSERT into supabase_migrations.schema_migrations
-- This is local-only; prod will get it as part of the next migration push.

-- 1. Index on ts for fast deletion + range queries.
--    Already covered by the existing rate-limit queries which filter on `ts`
--    + key, but a dedicated index on ts alone helps the cleanup pass.
CREATE INDEX IF NOT EXISTS api_hits_ts_idx ON public.api_hits (ts);

-- 2. Cleanup function. Returns count of deleted rows for monitoring.
CREATE OR REPLACE FUNCTION public.prune_api_hits(p_retention_hours INT DEFAULT 1)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM public.api_hits
  WHERE ts < (NOW() - (p_retention_hours || ' hours')::interval);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.prune_api_hits(INT) IS
  'Deletes api_hits rows older than the retention window. Defaults to 1 hour. Returns row count.';

-- 3. Schedule via pg_cron. Matches the pattern used by
--    20260426000002_extension_production_hardening.sql.
--    Runs every 15 minutes (00:00, 00:15, 00:30, 00:45 of each hour).
--    Idempotent: unschedule any prior version of this job first so re-applies
--    don't pile up duplicates.
DO $$
BEGIN
  PERFORM cron.unschedule('vaiyu_prune_api_hits');
EXCEPTION WHEN OTHERS THEN
  -- First-time apply: job doesn't exist yet, ignore.
  NULL;
END $$;

SELECT cron.schedule(
  'vaiyu_prune_api_hits',
  '*/15 * * * *',
  $$ SELECT public.prune_api_hits(1); $$
);
