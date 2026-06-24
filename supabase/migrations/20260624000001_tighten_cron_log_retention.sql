-- 20260624000001_tighten_cron_log_retention.sql
--
-- WHY: cron.job_run_details had grown to ~16 MB / ~59k rows on prod (7-day
-- retention × ~6.7k log rows/day from 4 jobs that fire every minute). pg_cron's
-- timeout-reaper runs `UPDATE cron.job_run_details SET status=... WHERE status
-- IN ('starting','running')`, and that table has NO index on `status` (only the
-- runid PK) — so the reaper SEQ-SCANS the whole table from disk. On 2026-06-24 a
-- transient IO crunch made every cron fail with "job startup timeout" (07:54–
-- 08:34) and the reaper re-scanned 16 MB repeatedly (observed: 1906 disk reads /
-- 18.9 s in a single call — the #1 disk-IO consumer on the instance), amplifying
-- the crunch. The table is owned by supabase_admin, so we can't add an index;
-- the lever we control is RETENTION. Cutting 7d → 1d bounds the working set to
-- ~8k rows / ~2 MB so the reaper's scan stays cheap and cached.
--
-- master-cleanup-job's ONLY task is pruning this log (verified: its command is
-- exactly the DELETE below with a 7-day window), so replacing it wholesale is
-- safe. Idempotent + guarded for environments without pg_cron (e.g. local).

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Re-point the daily cleanup job at a 1-day retention window (was 7 days).
    -- cron.schedule upserts by jobname, so this updates the existing job in place.
    perform cron.schedule(
      'master-cleanup-job',
      '0 1 * * *',
      $cmd$DELETE FROM cron.job_run_details WHERE start_time < now() - interval '1 day';$cmd$
    );

    -- One-time immediate prune so relief doesn't wait until the 01:00 run.
    -- (Daily job keeps it bounded thereafter; autovacuum reclaims the dead space.)
    delete from cron.job_run_details where start_time < now() - interval '1 day';
  end if;
end $$;
