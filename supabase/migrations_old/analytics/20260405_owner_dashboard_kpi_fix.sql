-- ============================================================
-- FIX: Analytics View RLS Bypass and Data Fan-out Issues
-- 1. Adding `security_invoker = on` to ensure RLS is not bypassed.
-- 2. Changing COUNT(*) to COUNT(DISTINCT t.id) for KPI summary to fix fan-out.
-- 3. Updating Active Issues to strictly count NEW/IN_PROGRESS.
-- ============================================================

-- 1. v_owner_kpi_summary (Fix: Distinct Count & Active logic)
DROP VIEW IF EXISTS v_owner_kpi_summary;
CREATE OR REPLACE VIEW v_owner_kpi_summary 
WITH (security_invoker = on) AS
SELECT
  t.hotel_id,

  -- Only count currently active backlog issues
  COUNT(DISTINCT t.id) FILTER (WHERE t.status IN ('NEW', 'IN_PROGRESS')) AS total_tickets,

  COUNT(DISTINCT t.id) FILTER (
    WHERE t.status = 'COMPLETED'
      AND ss.breached = false
      AND NOT EXISTS (
        SELECT 1 FROM ticket_events te
        WHERE te.ticket_id = t.id
          AND te.event_type = 'SLA_EXCEPTION_GRANTED'
      )
  ) AS completed_within_sla,

  COUNT(DISTINCT t.id) FILTER (
    WHERE ss.breached = true
  ) AS breached_sla,

  COUNT(DISTINCT t.id) FILTER (
    WHERE t.status IN ('NEW','IN_PROGRESS')
      AND ss.current_remaining_seconds <= LEAST(
        30 * 60,
        sp.target_minutes * 60 * 0.25
      )
      AND NOT EXISTS (
        SELECT 1 FROM ticket_events te
        WHERE te.ticket_id = t.id
          AND te.event_type = 'SLA_EXCEPTION_GRANTED'
      )
  ) AS at_risk_tickets,

  ROUND(
    100.0 *
    COUNT(DISTINCT t.id) FILTER (
      WHERE t.status = 'COMPLETED'
        AND ss.breached = false
        AND NOT EXISTS (
          SELECT 1 FROM ticket_events te
          WHERE te.ticket_id = t.id
            AND te.event_type = 'SLA_EXCEPTION_GRANTED'
        )
    )
    /
    NULLIF(COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'COMPLETED'), 0),
    2
  ) AS sla_compliance_percent

FROM tickets t
LEFT JOIN ticket_sla_state ss ON ss.ticket_id = t.id
LEFT JOIN services s ON s.id = t.service_id
LEFT JOIN sla_policies sp ON sp.department_id = s.department_id
GROUP BY t.hotel_id;

GRANT SELECT ON v_owner_kpi_summary TO authenticated, service_role;


-- 2. Securing the other dynamic views created earlier
DROP VIEW IF EXISTS v_owner_sla_breach_breakdown;
CREATE OR REPLACE VIEW v_owner_sla_breach_breakdown 
WITH (security_invoker = on) AS
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


DROP VIEW IF EXISTS v_owner_block_reason_analysis;
CREATE OR REPLACE VIEW v_owner_block_reason_analysis 
WITH (security_invoker = on) AS
SELECT
  t.hotel_id,
  DATE(te.created_at) AS day,
  te.reason_code,
  COUNT(*) AS block_count
FROM ticket_events te
JOIN tickets t ON t.id = te.ticket_id
WHERE te.event_type = 'BLOCKED'
GROUP BY t.hotel_id, DATE(te.created_at), te.reason_code;


DROP VIEW IF EXISTS v_owner_staff_performance;
CREATE OR REPLACE VIEW v_owner_staff_performance 
WITH (security_invoker = on) AS
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
