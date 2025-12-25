-- UI-ready Supervisor Task Header View (recommended)
--Header view single UI-ready view

CREATE OR REPLACE VIEW v_supervisor_task_header AS
SELECT
  t.id AS ticket_id,

  -- Task Type
  d.name AS task_type,

  -- Requested by
  t.created_by_type AS requested_by_type,

  CASE
    WHEN t.created_by_type IN ('STAFF','FRONT_DESK')
         AND hm.id IS NOT NULL
      THEN p.full_name
    ELSE NULL
  END AS requested_by_name,

  -- SLA
  CASE
    WHEN ss.breached THEN 'SLA breached'
    WHEN ss.sla_started_at IS NULL THEN 'Not started'
    ELSE CONCAT(CEIL(ss.current_remaining_seconds / 60.0), ' min')
  END AS sla_label,

  -- Priority
  t.priority,

  -- Status
  t.status,

  -- Created time
  t.created_at

FROM tickets t
JOIN departments d ON d.id = t.service_department_id
LEFT JOIN ticket_sla_state ss ON ss.ticket_id = t.id
LEFT JOIN hotel_members hm ON hm.id = t.created_by_id
LEFT JOIN profiles p ON p.id = hm.user_id;


SELECT *
FROM v_supervisor_task_header
WHERE ticket_id = :id;



-- UI-ready Timeline View (recommended)

--If you want zero frontend logic, create a small view:

CREATE OR REPLACE VIEW v_ticket_timeline AS
SELECT
  e.ticket_id,
  e.created_at,

  -- Title (status-like)
  CASE e.event_type
    WHEN 'CREATED' THEN 'New Task'
    WHEN 'STARTED' THEN 'In Progress'
    WHEN 'BLOCKED' THEN 'Blocked'
    WHEN 'COMPLETED' THEN 'Completed'
    ELSE INITCAP(e.event_type)
  END AS title,

  -- Description (human readable, name-aware)
  CASE
    WHEN e.event_type = 'CREATED' THEN
      'Created'

    WHEN e.event_type = 'STARTED' THEN
      CASE
        WHEN e.actor_type IN ('STAFF','FRONT_DESK')
             AND p.full_name IS NOT NULL
          THEN 'Started by ' || p.full_name
        WHEN e.actor_type = 'GUEST'
          THEN 'Started by guest'
        ELSE
          'Started'
      END

    WHEN e.event_type = 'BLOCKED' THEN
      COALESCE(e.comment, 'Blocked')

    ELSE
      e.comment
  END AS description

FROM ticket_events e
LEFT JOIN hotel_members hm
  ON hm.id = e.actor_id
 AND e.actor_type IN ('STAFF','FRONT_DESK')
LEFT JOIN profiles p
  ON p.id = hm.user_id;



--Then UI does:

SELECT *
FROM v_ticket_timeline
WHERE ticket_id = :ticket_id
ORDER BY created_at DESC;
