CREATE OR REPLACE VIEW v_ops_blocked_tickets_detail AS
SELECT
  t.hotel_id,
  t.id AS ticket_id,

  -- Display-friendly reference
  SUBSTRING(t.id::text, 1, 8) AS display_id,

  t.title,
  d.name AS department_name,

  -- Assignee (Ops-safe)
  p.full_name AS assignee_name,
  p.profile_photo_url AS assignee_avatar,

  -- Block context
  br.label AS block_reason,
  ss.sla_paused_at,

  -- How long it has been blocked (seconds)
  GREATEST(
    EXTRACT(EPOCH FROM (NOW() - ss.sla_paused_at)),
    0
  ) AS blocked_seconds

FROM tickets t
JOIN services s ON s.id = t.service_id
JOIN departments d ON d.id = s.department_id
JOIN ticket_sla_state ss ON ss.ticket_id = t.id

LEFT JOIN hotel_members hm ON hm.id = t.current_assignee_id
LEFT JOIN profiles p ON p.id = hm.user_id

-- Latest block reason (if any)
LEFT JOIN LATERAL (
  SELECT reason_code
  FROM ticket_events te
  WHERE te.ticket_id = t.id
    AND te.event_type = 'BLOCKED'
  ORDER BY te.created_at DESC
  LIMIT 1
) blk ON true
LEFT JOIN block_reasons br ON br.code = blk.reason_code

WHERE t.status = 'BLOCKED'
  AND ss.sla_paused_at IS NOT NULL
  AND NOW() - ss.sla_paused_at > INTERVAL '2 hours'
  AND t.completed_at IS NULL
  AND t.cancelled_at IS NULL

ORDER BY blocked_seconds DESC;

GRANT SELECT ON v_ops_blocked_tickets_detail TO authenticated;
