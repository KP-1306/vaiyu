-- 20260624000003_consolidate_api_hits_prune_and_sla_cadence.sql
--
-- WHY (two fixes — one correctness, one cadence; both about cron hygiene):
--
-- 1. The owner "System Health · 24h" card reads v_api_24h / v_api_top_fns_24h,
--    which aggregate public.api_hits over the trailing 24h WHERE fn IS NOT NULL.
--    api_hits had THREE overlapping prune jobs with CONTRADICTORY retention:
--      - vaiyu_prune_api_hits  (*/15)  -> prune_api_hits(1): DELETE rows older than 1 HOUR
--      - prune_api_hits_7d     (daily) -> DELETE rows older than 7 days (ts-based)
--      - va_prune_api_hits     (daily) -> DELETE rows older than 7 days (the telemetry-era job)
--    The */15 one-hour prune WON (most aggressive + most frequent), so the table
--    never held more than ~1h of telemetry and the "24h" card was silently capped
--    at one hour (verified on prod 2026-06-24: oldest telemetry row was 64 min old).
--    The one-hour job was built in 20260513 for the RATE-LIMITER (key-only rows);
--    when full request telemetry was added to the SAME table in 20260621 nobody
--    re-scoped it, so it began deleting telemetry too.
--
--    FIX: drop the 1-hour prune and the duplicate 7-day prune; keep exactly ONE
--    canonical 7-day retention job (va_prune_api_hits). Rate-limiter correctness is
--    UNAFFECTED: both public.va_rate_limit_hit and the visibility-refresh limiter
--    (20260531000001) read api_hits with a windowed count (ts >= now() - <minutes>),
--    and idx_api_hits_key_ts range-scans that window regardless of how many older
--    rows remain. 7-day retention of rate-limit rows is negligible storage on this
--    workload and harmless to those reads.
--
-- 2. Job "update-sla-statuses-every-2m" was scheduled '*/1' (every minute) despite
--    its own name. Restore the intended every-2-minute cadence.
--
-- This is a cron-hygiene + telemetry-correctness fix, NOT a Disk-IO remedy: the
-- recurring write rate on this DB is ~0 KB/s at idle and the prune job was ~1% of
-- WAL. The Disk-IO budget warning seen 2026-06-24 was the one-time aftermath of the
-- cron-log bloat cleanup (20260624000001 + VACUUM FULL), which recovers on its own.
--
-- Idempotent + environment-agnostic: each drop is guarded by existence; the kept
-- jobs are upserted by name via cron.schedule (no-op when already correct). Safe on
-- a fresh DB, on prod, and on re-run. The "exactly one 7-day prune exists" invariant
-- is enforced HERE rather than assumed from 20260621000003.

-- 1a. Drop the 1-hour blanket prune that was capping the 24h telemetry card.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vaiyu_prune_api_hits') THEN
    PERFORM cron.unschedule('vaiyu_prune_api_hits');
  END IF;
END $$;

-- 1b. Drop the duplicate 7-day prune (functionally identical to va_prune_api_hits).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune_api_hits_7d') THEN
    PERFORM cron.unschedule('prune_api_hits_7d');
  END IF;
END $$;

-- 1c. Guarantee exactly ONE canonical 7-day retention job exists (upsert by name).
--     va_prune_api_hits() is created + locked by 20260621000003 / 20260621000004.
SELECT cron.schedule(
  'va_prune_api_hits',
  '23 3 * * *',
  'SELECT public.va_prune_api_hits()'
);

-- 2. Restore the SLA breach-detector to its intended 2-minute cadence (was */1).
SELECT cron.schedule(
  'update-sla-statuses-every-2m',
  '*/2 * * * *',
  'SELECT public.update_ticket_sla_statuses()'
);
