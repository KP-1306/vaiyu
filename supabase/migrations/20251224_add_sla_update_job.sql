-- ============================================================
-- SQL Migration: SLA Auto-Update Job (Downgraded for Model A)
-- Purpose: ONLY mark breaches. Math aligned with Live View.
-- ============================================================

-- 1. Enable pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Create the update function (Low Write / Correct Math)
CREATE OR REPLACE FUNCTION public.update_ticket_sla_statuses()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only update breaches. Correct math (Subtract pauses).
  UPDATE ticket_sla_state ss
  SET
    breached = true,
    breached_at = COALESCE(breached_at, clock_timestamp())
  FROM tickets t
  JOIN sla_policies sp
    ON sp.department_id = t.service_department_id
  WHERE ss.ticket_id = t.id
    AND ss.breached = false
    AND ss.sla_started_at IS NOT NULL
    AND ss.sla_paused_at IS NULL
    AND (
      (sp.target_minutes * 60)
      - (
          EXTRACT(EPOCH FROM (clock_timestamp() - ss.sla_started_at))::INT
          - COALESCE(ss.total_paused_seconds, 0)
      )
    ) <= 0;
END;
$$;

-- 3. Schedule the job (Run every minute)
SELECT cron.schedule(
    'update-sla-statuses-every-min',
    '* * * * *',
    'SELECT public.update_ticket_sla_statuses()'
);
