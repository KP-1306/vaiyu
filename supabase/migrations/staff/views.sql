-- ============================================================
-- LEGACY VIEWS (Retained for Backward Compatibility)
-- ============================================================

-- ============================================================
-- View: v_staff_runner_tickets
-- Purpose: Used by ticketService.ts (Staff UI)
--          Maps closely to v_ops_board_tickets but with
--          legacy column names/structure from V1.
-- ============================================================
CREATE OR REPLACE VIEW v_staff_runner_tickets AS
SELECT
    t.id                                  AS ticket_id,
    COALESCE(CONCAT('Room ', r.number), z.name) AS location_label,
    r.number                              AS room_number,
    r.floor                               AS room_floor,
    z.id                                 AS zone_id,
    z.name                               AS zone_name,
    t.hotel_id                           AS hotel_id,
    t.title                              AS title,
    t.description                        AS description,
    t.status                             AS status,
    t.reason_code                        AS reason_code,
    d.name                               AS department_name,
    t.created_at                         AS created_at,
    t.current_assignee_id                AS assigned_staff_id,
    hm.user_id                           AS assigned_user_id,
    COALESCE(p.full_name, 'Auto-queue')  AS assigned_to_name,
    sp.target_minutes                    AS sla_target_minutes,
    ss.sla_started_at                    AS sla_started_at,
    ss.breached                          AS sla_breached,
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
    CASE
        WHEN ss.sla_started_at IS NULL THEN 'NOT_STARTED'
        WHEN ss.breached = true THEN 'BREACHED'
        WHEN ss.sla_paused_at IS NOT NULL THEN 'PAUSED'
        ELSE 'RUNNING'
    END AS sla_state,
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
    CASE
        WHEN t.status = 'IN_PROGRESS'
            AND ss.sla_paused_at IS NULL
            AND ss.sla_started_at IS NOT NULL
            THEN
              EXTRACT(EPOCH FROM (clock_timestamp() - ss.sla_started_at))::INT
              - COALESCE(ss.total_paused_seconds, 0)
        ELSE NULL
    END AS active_work_seconds,
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
    END AS allowed_actions,

    -- =========================================================================
    -- Supervisor decision status for BLOCKED + supervisor_approval tickets
    -- =========================================================================
    CASE
        WHEN t.status = 'BLOCKED' AND t.reason_code = 'supervisor_approval' THEN
            COALESCE(
                (
                    SELECT 
                        CASE 
                            WHEN res.event_type = 'SUPERVISOR_APPROVED' THEN 'APPROVED'
                            WHEN res.event_type = 'SUPERVISOR_REJECTED' THEN 'REJECTED'
                        END
                    FROM ticket_events res
                    WHERE res.ticket_id = t.id
                      AND res.event_type IN ('SUPERVISOR_APPROVED', 'SUPERVISOR_REJECTED')
                      AND res.created_at > (
                          SELECT te_block.created_at
                          FROM ticket_events te_block
                          WHERE te_block.ticket_id = t.id
                            AND te_block.event_type = 'BLOCKED'
                          ORDER BY te_block.created_at DESC
                          LIMIT 1
                      )
                    ORDER BY res.created_at DESC
                    LIMIT 1
                ),
                'PENDING'
            )
        ELSE NULL
    END AS supervisor_decision_status

FROM tickets t
LEFT JOIN departments d ON d.id = t.service_department_id
LEFT JOIN rooms r ON r.id = t.room_id
LEFT JOIN hotel_zones z ON z.id = t.zone_id
LEFT JOIN hotel_members hm ON hm.id = t.current_assignee_id
LEFT JOIN profiles p ON p.id = hm.user_id
LEFT JOIN ticket_sla_state ss ON ss.ticket_id = t.id
LEFT JOIN sla_policies sp
  ON sp.department_id = t.service_department_id
 AND sp.is_active = true
WHERE t.status IN ('NEW','IN_PROGRESS','BLOCKED');

GRANT SELECT ON v_staff_runner_tickets TO authenticated;
