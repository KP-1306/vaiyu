-- ============================================================================
-- Platform Operator Console — supporting objects
-- ============================================================================
-- Backs the platform-admin "Operator Console" (/admin/platform). All cross-tenant
-- data is read server-side by the admin-metrics Netlify function (service-role,
-- gated by platform_admins). Most panels use plain PostgREST aggregation; this
-- migration adds only what PostgREST can't reach:
--   1. va_admin_cron_health() — the cron schema is not exposed via PostgREST, so a
--      SECURITY DEFINER function (owner = postgres) surfaces job liveness.
--   2. idx_payments_created_at — the GMV panel scans payments by created_at across
--      all hotels; the only existing index is (booking_id, created_at), which does
--      not serve a created_at-only range scan.
-- ============================================================================

-- 1) Cron health (jobs + last-run status). Service-role only; the function is
--    invoked by admin-metrics after it has verified the caller is a platform admin.
CREATE OR REPLACE FUNCTION public.va_admin_cron_health()
RETURNS TABLE (
  jobname     text,
  schedule    text,
  active      boolean,
  last_run    timestamptz,
  last_status text,
  runs_24h    integer,
  fails_24h   integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cron, pg_temp
AS $$
  SELECT
    j.jobname,
    j.schedule,
    j.active,
    (SELECT max(d.start_time) FROM cron.job_run_details d WHERE d.jobid = j.jobid) AS last_run,
    (SELECT d.status FROM cron.job_run_details d WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 1) AS last_status,
    (SELECT count(*)::int FROM cron.job_run_details d
       WHERE d.jobid = j.jobid AND d.start_time >= now() - interval '24 hours') AS runs_24h,
    (SELECT count(*)::int FROM cron.job_run_details d
       WHERE d.jobid = j.jobid AND d.start_time >= now() - interval '24 hours' AND d.status <> 'succeeded') AS fails_24h
  FROM cron.job j
  ORDER BY j.jobname;
$$;

-- Lock down: anon/authenticated must never call this (Supabase grants EXECUTE to
-- them by default). Only service_role (used by the gated admin-metrics function).
REVOKE ALL ON FUNCTION public.va_admin_cron_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.va_admin_cron_health() TO service_role;

-- 2) Index for the cross-tenant GMV scan (payments by created_at over a date window).
CREATE INDEX IF NOT EXISTS idx_payments_created_at
  ON public.payments (created_at DESC);
