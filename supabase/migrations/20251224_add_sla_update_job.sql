-- ============================================================
-- SQL Migration: SLA Auto-Update Job
-- ============================================================

-- 1. Enable pg_cron extension (often needs to be enabled in Supabase dashboard)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Create the update function
CREATE OR REPLACE FUNCTION public.update_ticket_sla_statuses()
RETURNS void
LANGUAGE plpgsql
VOLATILE
AS $$
BEGIN
  WITH updated AS (
    UPDATE ticket_sla_state ss
    SET
      current_remaining_seconds =
        GREATEST(
          (sp.target_minutes * 60)
          - EXTRACT(EPOCH FROM (now() - ss.sla_started_at))::INT
          - ss.total_paused_seconds,
          0
        )
    FROM tickets t
    JOIN sla_policies sp
      ON sp.department_id = t.service_department_id
    WHERE ss.ticket_id = t.id
      AND ss.sla_started_at IS NOT NULL
      AND ss.sla_paused_at IS NULL
      AND ss.breached = false
    RETURNING ss.ticket_id, ss.current_remaining_seconds
  )
  UPDATE ticket_sla_state
  SET
    breached = true,
    breached_at = now()
  WHERE ticket_id IN (
    SELECT ticket_id
    FROM updated
    WHERE current_remaining_seconds = 0
  )
  AND breached = false;

  -- Safety net: no SLA should sit at 0 unbreached
    UPDATE ticket_sla_state
    SET
    breached = true,
    breached_at = COALESCE(breached_at, now())
    WHERE breached = false
    AND current_remaining_seconds = 0
    AND sla_started_at IS NOT NULL
    AND sla_paused_at IS NULL;

END;
$$;


-- 3. Schedule the job to run every 2 minutes
-- Note: 'cron' schema is usually where cron table lives in Supabase
SELECT cron.schedule(
    'update-sla-statuses-every-2m',
    '*/2 * * * *',
    'SELECT public.update_ticket_sla_statuses()'
);
