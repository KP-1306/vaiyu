CREATE OR REPLACE VIEW v_staff_runner_tickets AS
SELECT
  t.id                                  AS ticket_id,

  -- Location
  COALESCE(CONCAT('Room ', r.number), z.name) AS location_label,
  r.number                              AS room_number,
  r.floor                               AS room_floor,
  z.id                                 AS zone_id,
  z.name                               AS zone_name,

  -- ✅ MUST be exposed for Supabase filtering
  d.hotel_id                           AS hotel_id,

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
  ss.current_remaining_seconds         AS sla_remaining_seconds,
  ss.breached                          AS sla_breached,

  CASE
    WHEN ss.sla_started_at IS NULL THEN 'NOT_STARTED'
    WHEN ss.breached = true THEN 'BREACHED'
    WHEN ss.current_remaining_seconds > 0 THEN 'RUNNING'
    ELSE 'UNKNOWN'
  END AS sla_state,

  CASE
    WHEN ss.sla_started_at IS NULL THEN 'Not started'
    WHEN ss.breached = true THEN 'SLA breached'
    WHEN ss.current_remaining_seconds > 0
      THEN CONCAT(CEIL(ss.current_remaining_seconds / 60.0), ' min remaining')
    ELSE NULL
  END AS sla_label,

  CASE
    WHEN t.status = 'IN_PROGRESS'
      THEN EXTRACT(EPOCH FROM (now() - ss.sla_started_at))::INT
    ELSE NULL
  END AS time_spent_seconds,

  CASE
    WHEN t.status = 'BLOCKED'
      THEN EXTRACT(EPOCH FROM (now() - ss.sla_paused_at))::INT
    ELSE NULL
  END AS blocked_seconds,

  t.created_by_type                    AS requested_by,

  CASE
    WHEN t.status = 'NEW' THEN 'START'
    WHEN t.status = 'IN_PROGRESS' THEN 'COMPLETE_OR_BLOCK'
    WHEN t.status = 'BLOCKED' THEN 'RESOLVE'
    ELSE 'NONE'
  END AS allowed_actions

FROM tickets t
JOIN departments d
  ON d.id = t.service_department_id
LEFT JOIN rooms r
  ON r.id = t.room_id
LEFT JOIN hotel_zones z
  ON z.id = t.zone_id
LEFT JOIN hotel_members hm
  ON hm.id = t.current_assignee_id
LEFT JOIN profiles p
  ON p.id = hm.user_id
LEFT JOIN ticket_sla_state ss
  ON ss.ticket_id = t.id

-- ✅ FIXED JOIN
LEFT JOIN sla_policies sp
  ON sp.id = ss.sla_policy_id

WHERE t.status IN ('NEW','IN_PROGRESS','BLOCKED');
