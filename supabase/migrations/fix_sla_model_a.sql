-- ============================================================
-- 🏆 MODEL A: DERIVED SLA (Math Fix Edition)
-- Purpose:
--   1. Calculate SLA remaining time LIVE in the view (Zero Lag)
--   2. Downgrade Cron Job to ONLY check for breaches (Low Write)
--   3. Corrects Math: Adds paused time back to budget
-- ============================================================

-- 1. DROP EXISTING VIEW (Required to change column types/order)
DROP VIEW IF EXISTS v_staff_runner_tickets;

-- 2. RECREATE VIEW (Live Calculation)
CREATE OR REPLACE VIEW v_staff_runner_tickets AS
SELECT
    t.id                                  AS ticket_id,

    -- Location
    COALESCE(CONCAT('Room ', r.number), z.name) AS location_label,
    r.number                              AS room_number,
    r.floor                               AS room_floor,
    z.id                                 AS zone_id,
    z.name                               AS zone_name,

    -- Hotel ID
    t.hotel_id                           AS hotel_id,

    -- Header
    t.title                              AS title,
    t.status                             AS status,
    d.name                               AS department_name,
    t.created_at                         AS created_at,

    -- Assignment
    t.current_assignee_id                AS assigned_staff_id,
    hm.user_id                           AS assigned_user_id,
    COALESCE(p.full_name, 'Auto-queue')  AS assigned_to_name,

    -- SLA
    sp.target_minutes                    AS sla_target_minutes,
    ss.sla_started_at                    AS sla_started_at,
    ss.breached                          AS sla_breached,

    -- 🧮 LIVE CALCULATION (Corrected Math)
    -- Formula: Target - ActiveWork
    -- ActiveWork = (Now - Start) - TotalPaused - CurrentPaused
    CASE
        WHEN ss.sla_started_at IS NULL THEN NULL
        ELSE
          GREATEST(
            (sp.target_minutes * 60)
            - (
                EXTRACT(EPOCH FROM (clock_timestamp() - ss.sla_started_at))::INT
                - COALESCE(ss.total_paused_seconds, 0)
                - CASE
                    WHEN ss.sla_paused_at IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (clock_timestamp() - ss.sla_paused_at))::INT
                    ELSE 0
                  END
            ),
            0
          )
    END AS sla_remaining_seconds,

    -- SLA State
    CASE
        WHEN ss.sla_started_at IS NULL THEN 'NOT_STARTED'
        WHEN ss.breached = true THEN 'BREACHED'
        WHEN ss.sla_paused_at IS NOT NULL THEN 'PAUSED'
        ELSE 'RUNNING'
    END AS sla_state,

    -- SLA Label (Uses Calculated Value)
    CASE
        WHEN ss.sla_started_at IS NULL THEN 'Not started'
        WHEN ss.breached = true THEN 'SLA breached'
        WHEN ss.sla_paused_at IS NOT NULL THEN 'SLA paused'
        ELSE CONCAT(CEIL(
            GREATEST(
                (sp.target_minutes * 60)
                - (
                    EXTRACT(EPOCH FROM (clock_timestamp() - ss.sla_started_at))::INT
                    - COALESCE(ss.total_paused_seconds, 0)
                    - CASE
                        WHEN ss.sla_paused_at IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (clock_timestamp() - ss.sla_paused_at))::INT
                        ELSE 0
                      END
                ),
                0
            ) / 60.0
        ), ' min remaining')
    END AS sla_label,

    -- Active Work Seconds (For UI Local Timer)
    -- Time spent actively working = Wall - HistoryPaused
    CASE
        WHEN t.status = 'IN_PROGRESS'
            AND ss.sla_paused_at IS NULL
            AND ss.sla_started_at IS NOT NULL
            THEN 
              EXTRACT(EPOCH FROM (clock_timestamp() - ss.sla_started_at))::INT
              - COALESCE(ss.total_paused_seconds, 0)
        ELSE NULL
    END AS active_work_seconds,

    -- Blocked Seconds
    CASE
        WHEN ss.sla_paused_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (clock_timestamp() - ss.sla_paused_at))::INT
        ELSE NULL
    END AS blocked_seconds,

    t.created_by_type                    AS requested_by,

    CASE
        WHEN t.status = 'NEW' THEN 'START'
        WHEN t.status = 'IN_PROGRESS' THEN 'COMPLETE_OR_BLOCK'
        WHEN t.status = 'BLOCKED' THEN 'UNBLOCK'
        ELSE 'NONE'
    END AS allowed_actions

FROM tickets t
LEFT JOIN departments d ON d.id = t.service_department_id
LEFT JOIN rooms r ON r.id = t.room_id
LEFT JOIN hotel_zones z ON z.id = t.zone_id
LEFT JOIN hotel_members hm ON hm.id = t.current_assignee_id
LEFT JOIN profiles p ON p.id = hm.user_id
LEFT JOIN ticket_sla_state ss ON ss.ticket_id = t.id

-- Joint Policy
LEFT JOIN sla_policies sp 
  ON sp.department_id = t.service_department_id 
 AND sp.is_active = true

WHERE t.status IN ('NEW','IN_PROGRESS','BLOCKED');


-- 3. DOWNGRADE CRON JOB (Breach Marker Only - Math Fixed)
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
