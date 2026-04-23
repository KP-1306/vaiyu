-- ============================================================
-- REFACTORED OWNER DASHBOARD VIEWS (FOR DYNAMIC FILTERS)
-- Adding 'day' column to all breakdown views so UI can filter.
-- ============================================================

-- 1. v_owner_sla_breach_breakdown (Daily)
DROP VIEW IF EXISTS v_owner_sla_breach_breakdown;
CREATE OR REPLACE VIEW v_owner_sla_breach_breakdown AS
SELECT
  t.hotel_id,
  DATE(t.completed_at) AS day,
  COALESCE(br.label, 'Other') AS reason_label,
  te.reason_code,
  COUNT(DISTINCT t.id) AS breached_count
FROM tickets t
JOIN ticket_sla_state ss
  ON ss.ticket_id = t.id
  AND ss.breached = true
JOIN LATERAL (
  SELECT reason_code
  FROM ticket_events te_inner
  WHERE te_inner.ticket_id = t.id
    AND te_inner.event_type = 'BLOCKED'
  ORDER BY te_inner.created_at DESC
  LIMIT 1
) te ON TRUE
LEFT JOIN block_reasons br
  ON br.code = te.reason_code
WHERE t.completed_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM ticket_events ex
    WHERE ex.ticket_id = t.id AND ex.event_type = 'SLA_EXCEPTION_GRANTED'
  )
GROUP BY t.hotel_id, DATE(t.completed_at), te.reason_code, br.label;


-- 2. v_owner_block_reason_analysis (Daily)
DROP VIEW IF EXISTS v_owner_block_reason_analysis;
CREATE OR REPLACE VIEW v_owner_block_reason_analysis AS
SELECT
  t.hotel_id,
  DATE(te.created_at) AS day,
  te.reason_code,
  COUNT(*) AS block_count
FROM ticket_events te
JOIN tickets t ON t.id = te.ticket_id
WHERE te.event_type = 'BLOCKED'
GROUP BY t.hotel_id, DATE(te.created_at), te.reason_code;


-- 3. v_owner_staff_performance (Daily)
DROP VIEW IF EXISTS v_owner_staff_performance;
CREATE OR REPLACE VIEW v_owner_staff_performance AS
SELECT
  hm.hotel_id,
  DATE(t.completed_at) AS day,
  hm.id AS staff_id,
  p.full_name,
  COUNT(*) FILTER (WHERE t.status = 'COMPLETED') AS completed_tasks,
  COUNT(*) FILTER (WHERE t.status = 'COMPLETED' AND ss.breached = false) AS completed_within_sla
FROM tickets t
JOIN hotel_members hm ON hm.id = t.current_assignee_id
JOIN profiles p ON p.id = hm.user_id
LEFT JOIN ticket_sla_state ss ON ss.ticket_id = t.id
WHERE t.completed_at IS NOT NULL
GROUP BY hm.hotel_id, DATE(t.completed_at), hm.id, p.full_name;

GRANT SELECT ON v_owner_sla_breach_breakdown TO authenticated, service_role;
GRANT SELECT ON v_owner_block_reason_analysis TO authenticated, service_role;
GRANT SELECT ON v_owner_staff_performance TO authenticated, service_role;
