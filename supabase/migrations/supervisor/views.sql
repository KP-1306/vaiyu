-- ============================================================
-- SUPERVISOR VIEWS
-- ============================================================

-- ============================================================
-- View: v_supervisor_inbox
-- Purpose: Supervisor decision queue (Needs Supervisor Action)
-- ============================================================
CREATE OR REPLACE VIEW v_supervisor_inbox AS
SELECT
  -- Identity
  v.id                         AS ticket_id,
  v.hotel_id,

  -- Service context
  v.service_id,
  v.service_key,
  v.service_label,
  v.service_department_id,
  v.department_name,

  -- Location context
  v.room_id,
  v.room_number,
  v.zone_id,

  -- Ticket lifecycle
  v.status,
  v.created_at,
  v.updated_at,

  -- Supervisor decision context (PRIMARY PURPOSE)
  v.supervisor_request_type,
  v.supervisor_reason_code,
  v.supervisor_requested_at,

  -- SLA visibility (read-only)
  v.sla_minutes,
  v.sla_deadline,
  v.mins_remaining,
  v.sla_state,
  v.sla_exception_granted,

  -- UI helpers
  v.assignee_id,
  v.primary_reason_code

FROM v_ops_board_tickets v
WHERE v.needs_supervisor_action = true;

GRANT SELECT ON v_supervisor_inbox TO authenticated;


-- ============================================================
-- View: v_supervisor_task_header
-- Purpose: UI-ready single task view for supervisor
-- ============================================================
CREATE OR REPLACE VIEW v_supervisor_task_header AS
SELECT
  t.id AS ticket_id,
  d.name AS task_type,
  t.created_by_type AS requested_by_type,
  CASE
    WHEN t.created_by_type IN ('STAFF','FRONT_DESK') AND hm.id IS NOT NULL THEN p.full_name
    ELSE NULL
  END AS requested_by_name,
  CASE
    WHEN ss.breached THEN 'SLA breached'
    WHEN ss.sla_started_at IS NULL THEN 'Not started'
    ELSE CONCAT(CEIL(ss.current_remaining_seconds / 60.0), ' min')
  END AS sla_label,
  NULL AS priority, -- deprecated concept?
  t.status,
  t.reason_code,
  t.created_at

FROM tickets t
JOIN departments d ON d.id = t.service_department_id
LEFT JOIN ticket_sla_state ss ON ss.ticket_id = t.id
LEFT JOIN hotel_members hm ON hm.id = t.created_by_id
LEFT JOIN profiles p ON p.id = hm.user_id;

GRANT SELECT ON v_supervisor_task_header TO authenticated;


-- ============================================================
-- View: v_ticket_timeline
-- Purpose: UI-ready timeline events
-- ============================================================
CREATE OR REPLACE VIEW v_ticket_timeline AS
SELECT
  e.ticket_id,
  e.created_at,
  CASE e.event_type
    WHEN 'CREATED' THEN 'New Task'
    WHEN 'STARTED' THEN 'In Progress'
    WHEN 'BLOCKED' THEN 'Blocked'
    WHEN 'COMPLETED' THEN 'Completed'
    ELSE INITCAP(e.event_type)
  END AS title,
  CASE
    WHEN e.event_type = 'CREATED' THEN 'Created'
    WHEN e.event_type = 'STARTED' THEN
      CASE
        WHEN e.actor_type IN ('STAFF','FRONT_DESK') AND p.full_name IS NOT NULL THEN 'Started by ' || p.full_name
        WHEN e.actor_type = 'GUEST' THEN 'Started by guest'
        ELSE 'Started'
      END
    WHEN e.event_type = 'BLOCKED' THEN COALESCE(e.comment, 'Blocked')
    ELSE e.comment
  END AS description
FROM ticket_events e
LEFT JOIN hotel_members hm ON hm.id = e.actor_id AND e.actor_type IN ('STAFF','FRONT_DESK')
LEFT JOIN profiles p ON p.id = hm.user_id;

GRANT SELECT ON v_ticket_timeline TO authenticated;
