-- Drip-tick scheduling — pg_cron-driven worker invocation.
--
-- Position 2's worker (claim_pending_drip_steps) runs inside the DB, so we
-- don't need a separate edge function for it. pg_cron fires the RPC every
-- 5 minutes; the RPC enqueues notification_queue rows; the existing
-- send-notifications cron-triggered edge function drains those rows.
--
-- 5-minute cadence chosen because:
--   • Step delays are in hours/days — minute-level precision adds nothing.
--   • Resend rate limits are per-second, so batching by 5min keeps us well
--     within free-tier headroom.
--   • Cap latency for "operator marks LOST → drip cancels" is at most one
--     tick, plus send-notifications tick — bounded at ~10 minutes worst-case.

DO $$
BEGIN
  -- Idempotent: unschedule any prior version of this job (no-op if absent),
  -- then schedule fresh. This is the pattern used by other cron entries in
  -- the project (see 20260426000001 / 20260513000001).
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
      FROM cron.job WHERE jobname = 'vaiyu_lead_drip_tick';

    PERFORM cron.schedule(
      'vaiyu_lead_drip_tick',
      '*/5 * * * *',  -- every 5 minutes
      $cron$ SELECT public.claim_pending_drip_steps(100); $cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- pg_cron may not be fully wired (e.g., in local dev without the extension
  -- enabled). Don't fail the migration over scheduling.
  RAISE NOTICE 'pg_cron schedule skipped: %', SQLERRM;
END $$;

COMMENT ON FUNCTION public.claim_pending_drip_steps IS
  'Drip worker entrypoint. Scheduled by pg_cron job `vaiyu_lead_drip_tick` every 5 minutes. Returns one row per subscription it touched for observability.';
