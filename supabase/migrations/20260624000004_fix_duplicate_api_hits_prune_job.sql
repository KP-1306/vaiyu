-- 20260624000004_fix_duplicate_api_hits_prune_job.sql
--
-- WHY: 20260624000003 upserted the canonical 7-day prune under the name
-- 'va_prune_api_hits', but the pre-existing job was named 'prune_api_hits'
-- (it already ran va_prune_api_hits()). cron.schedule keys its upsert on jobname,
-- so it CREATED a second job instead of updating the existing one — leaving TWO
-- identical 7-day prunes firing at 03:23 (jobids 83 + 94 on prod). This converges
-- to exactly one canonical job regardless of which aliases exist.
--
-- Also drops the now-orphaned 1-hour prune_api_hits(integer) function: its only
-- caller (the vaiyu_prune_api_hits */15 job) was removed in 20260624000003, and
-- the only remaining references are GRANT/REVOKE lines in 20260614000006 (no
-- callers). Removing it prevents it from being mistakenly re-scheduled and once
-- again capping the "System Health · 24h" telemetry card at one hour.
--
-- Idempotent + convergent: safe on a fresh DB, on prod, and on re-run.

-- 1. Converge to exactly ONE 7-day prune job, whatever aliases currently exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune_api_hits') THEN
    PERFORM cron.unschedule('prune_api_hits');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'va_prune_api_hits') THEN
    PERFORM cron.unschedule('va_prune_api_hits');
  END IF;
END $$;

SELECT cron.schedule(
  'va_prune_api_hits',
  '23 3 * * *',
  'SELECT public.va_prune_api_hits()'
);

-- 2. Remove the orphaned 1-hour prune function (no remaining callers).
DROP FUNCTION IF EXISTS public.prune_api_hits(integer);
