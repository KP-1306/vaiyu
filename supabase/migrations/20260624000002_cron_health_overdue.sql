-- 20260624000002_cron_health_overdue.sql
--
-- WHY: the operator console + alert email counted a cron as "failing" if it had
-- ANY failure in the trailing 24h (fails_24h > 0). A transient blip (e.g. the
-- 2026-06-24 40-min "job startup timeout" storm) therefore kept the board red and
-- re-sent alert emails for a FULL 24h after every job had already recovered —
-- alert fatigue that trains operators to ignore the banner.
--
-- FIX: surface whether a job is broken RIGHT NOW. "Currently broken" =
--   (a) its most recent run FAILED  (last_status = 'failed'), or
--   (b) it is OVERDUE — active but hasn't run within a grace multiple of its
--       schedule interval (catches a cron that silently stopped firing; the old
--       fails_24h check missed this case entirely, so this is strictly better).
-- We compute `overdue` HERE, once, so the banner (admin-metrics), the email
-- (admin-alerts) and the badge (PlatformConsole) all read one source of truth
-- instead of duplicating cron-schedule parsing across two TypeScript files.
-- fails_24h stays in the result as a secondary "N in 24h" footnote.
--
-- Adding a RETURNS TABLE column changes the signature, so DROP + CREATE (no view
-- depends on this fn; admin-metrics/admin-alerts call it dynamically via rpc()).

DROP FUNCTION IF EXISTS public.va_admin_cron_health();

CREATE FUNCTION public.va_admin_cron_health()
RETURNS TABLE (
  jobname     text,
  schedule    text,
  active      boolean,
  last_run    timestamptz,
  last_status text,
  runs_24h    integer,
  fails_24h   integer,
  overdue     boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cron, pg_temp
AS $$
  WITH base AS (
    SELECT
      j.jobid,
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
  ),
  -- Expected interval (minutes) from the minute+hour fields of a 5-field cron:
  -- "* * * * *" (1m), "*/N * * * *" (Nm), fixed-minute hourly (60m), "*/N" on the
  -- hour field (N*60m), else a fixed daily time (1440m).
  expected AS (
    SELECT b.*,
      CASE
        WHEN split_part(b.schedule, ' ', 1) = '*'           THEN 1
        WHEN split_part(b.schedule, ' ', 1) ~ '^\*/[0-9]+$' THEN substring(split_part(b.schedule, ' ', 1) from 3)::int
        WHEN split_part(b.schedule, ' ', 2) = '*'           THEN 60
        WHEN split_part(b.schedule, ' ', 2) ~ '^\*/[0-9]+$' THEN substring(split_part(b.schedule, ' ', 2) from 3)::int * 60
        ELSE 1440
      END AS expected_min
    FROM base b
  )
  SELECT
    e.jobname,
    e.schedule,
    e.active,
    e.last_run,
    e.last_status,
    e.runs_24h,
    e.fails_24h,
    -- Overdue = active, has RUN BEFORE (evidence it was firing, then stopped), and
    -- the gap exceeds 3× its expected interval (floored at 15 min so a single miss
    -- on a per-minute job doesn't flap). Deliberately CONSERVATIVE — judged only for
    -- pure minute/hour schedules (day-of-month AND day-of-week both '*'). Weekly /
    -- monthly / never-run jobs are NOT flagged, because reconstructing their true
    -- next-fire time needs a full cron parser; flagging them risks false alarms (the
    -- thing this whole change is fixing). Such a job stays caught by last_status.
    (e.active
       AND e.last_run IS NOT NULL
       AND split_part(e.schedule, ' ', 3) = '*'   -- no day-of-month constraint
       AND split_part(e.schedule, ' ', 5) = '*'   -- no day-of-week constraint
       AND now() - e.last_run > make_interval(mins => GREATEST(e.expected_min * 3, 15))
    ) AS overdue
  FROM expected e
  ORDER BY e.jobname;
$$;

-- Re-lock down (DROP cleared the grants): anon/authenticated must never call this;
-- only service_role (used by the gated admin-metrics / admin-alerts paths).
REVOKE ALL ON FUNCTION public.va_admin_cron_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.va_admin_cron_health() TO service_role;
