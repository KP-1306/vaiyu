-- ============================================================
-- OWNER DASHBOARD ANALYTICS - STABLE & SMOOTH (30D)
-- Purpose: Strict 30-day window with empty-day padding.
-- Security: SECURITY DEFINER (Default) for cross-hotel analytics consistency.
-- ============================================================

-- Clean up
DROP VIEW IF EXISTS v_owner_kpi_summary CASCADE;
DROP VIEW IF EXISTS v_owner_sla_trend_daily CASCADE;
DROP VIEW IF EXISTS v_owner_sla_breach_breakdown CASCADE;
DROP VIEW IF EXISTS v_owner_block_reason_analysis CASCADE;
DROP VIEW IF EXISTS v_owner_staff_performance CASCADE;
DROP VIEW IF EXISTS v_owner_ticket_activity CASCADE;
DROP VIEW IF EXISTS v_owner_sla_impact_waterfall CASCADE;
DROP VIEW IF EXISTS v_owner_at_risk_breakdown CASCADE;
DROP VIEW IF EXISTS v_owner_activity_breakdown CASCADE;

-- 1️⃣ v_owner_kpi_summary (Strict 30D - Realtime Snapshot)
CREATE OR REPLACE VIEW v_owner_kpi_summary AS
SELECT
  t.hotel_id,
  COUNT(DISTINCT t.id) FILTER (WHERE t.status IN ('NEW', 'IN_PROGRESS')) AS total_tickets,
  COUNT(DISTINCT t.id) FILTER (
    WHERE t.status = 'COMPLETED'
      AND ss.breached = false
      AND t.completed_at >= CURRENT_DATE - INTERVAL '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM ticket_events te WHERE te.ticket_id = t.id AND te.event_type = 'SLA_EXCEPTION_GRANTED'
      )
  ) AS completed_within_sla,
  COUNT(DISTINCT t.id) FILTER (
    WHERE (ss.breached = true OR (t.status IN ('NEW', 'IN_PROGRESS') AND ss.current_remaining_seconds <= 0))
      AND (t.completed_at >= CURRENT_DATE - INTERVAL '30 days' OR t.status IN ('NEW', 'IN_PROGRESS'))
  ) AS breached_sla,
  COUNT(DISTINCT t.id) FILTER (
    WHERE t.status IN ('NEW','IN_PROGRESS')
      AND ss.current_remaining_seconds <= 1800
      AND NOT EXISTS (
        SELECT 1 FROM ticket_events te WHERE te.ticket_id = t.id AND te.event_type = 'SLA_EXCEPTION_GRANTED'
      )
  ) AS at_risk_tickets,
  ROUND(
    100.0 *
    COUNT(DISTINCT t.id) FILTER (
      WHERE t.status = 'COMPLETED'
        AND ss.breached = false
        AND t.completed_at >= CURRENT_DATE - INTERVAL '30 days'
    )
    /
    NULLIF(COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'COMPLETED' AND t.completed_at >= CURRENT_DATE - INTERVAL '30 days'), 0),
    2
  ) AS sla_compliance_percent
FROM tickets t
LEFT JOIN ticket_sla_state ss ON ss.ticket_id = t.id
GROUP BY t.hotel_id;

-- 2️⃣ v_owner_sla_trend_daily (SMOOTH 30D)
CREATE OR REPLACE VIEW v_owner_sla_trend_daily AS
WITH daily AS (
  SELECT hotel_id,
         generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day')::date AS day
  FROM tickets
  GROUP BY hotel_id
)
SELECT
  d.hotel_id,
  d.day,
  COUNT(t.id) FILTER (WHERE ss.breached = false AND NOT EXISTS (SELECT 1 FROM ticket_events te WHERE te.ticket_id = t.id AND te.event_type = 'SLA_EXCEPTION_GRANTED')) AS completed_within_sla,
  COUNT(t.id) FILTER (WHERE ss.breached = true) AS breached_sla,
  COUNT(t.id) FILTER (WHERE EXISTS (SELECT 1 FROM ticket_events te WHERE te.ticket_id = t.id AND te.event_type = 'SLA_EXCEPTION_GRANTED')) AS sla_exempted
FROM daily d
LEFT JOIN tickets t ON t.hotel_id = d.hotel_id AND DATE(t.completed_at) = d.day
LEFT JOIN ticket_sla_state ss ON ss.ticket_id = t.id
GROUP BY d.hotel_id, d.day
ORDER BY d.day DESC;

-- 3️⃣ v_owner_sla_breach_breakdown (Strict 30D)
CREATE OR REPLACE VIEW v_owner_sla_breach_breakdown AS
SELECT
  t.hotel_id,
  DATE(t.completed_at) AS day,
  COALESCE(br.label, 'Other') AS reason_label,
  te.reason_code,
  COUNT(DISTINCT t.id) AS breached_count
FROM tickets t
JOIN ticket_sla_state ss ON ss.ticket_id = t.id AND ss.breached = true
JOIN LATERAL (
  SELECT reason_code FROM ticket_events te WHERE te.ticket_id = t.id AND te.event_type = 'BLOCKED' ORDER BY te.created_at DESC LIMIT 1
) te ON TRUE
LEFT JOIN block_reasons br ON br.code = te.reason_code
WHERE t.completed_at >= CURRENT_DATE - INTERVAL '30 days'
  AND NOT EXISTS (SELECT 1 FROM ticket_events ex WHERE ex.ticket_id = t.id AND ex.event_type = 'SLA_EXCEPTION_GRANTED')
GROUP BY t.hotel_id, DATE(t.completed_at), te.reason_code, br.label;

-- 4️⃣ v_owner_block_reason_analysis (Strict 30D)
CREATE OR REPLACE VIEW v_owner_block_reason_analysis AS
SELECT
  t.hotel_id,
  DATE(te.created_at) AS day,
  te.reason_code,
  COUNT(*) AS block_count
FROM ticket_events te
JOIN tickets t ON t.id = te.ticket_id
WHERE te.event_type = 'BLOCKED'
  AND te.created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY t.hotel_id, DATE(te.created_at), te.reason_code;

-- 5️⃣ v_owner_staff_performance (Strict 30D)
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
WHERE t.completed_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY hm.hotel_id, DATE(t.completed_at), hm.id, p.full_name;

-- 6️⃣ v_owner_ticket_activity (SMOOTH & ACCURATE 30D)
CREATE OR REPLACE VIEW v_owner_ticket_activity AS
WITH daily AS (
  SELECT hotel_id,
         generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day')::date AS day
  FROM tickets
  GROUP BY hotel_id
),
events AS (
  SELECT hotel_id, DATE(created_at) as day, 1 as created_count, 0 as resolved_count
  FROM tickets
  WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
  UNION ALL
  SELECT hotel_id, DATE(completed_at) as day, 0 as created_count, 1 as resolved_count
  FROM tickets
  WHERE status = 'COMPLETED' AND completed_at >= CURRENT_DATE - INTERVAL '30 days'
)
SELECT
  d.hotel_id,
  d.day,
  COALESCE(SUM(e.created_count), 0) AS created_count,
  COALESCE(SUM(e.resolved_count), 0) AS resolved_count
FROM daily d
LEFT JOIN events e ON e.hotel_id = d.hotel_id AND e.day = d.day
GROUP BY d.hotel_id, d.day
ORDER BY d.day DESC;

-- 7️⃣ v_owner_sla_impact_waterfall (Strict 30D)
CREATE OR REPLACE VIEW v_owner_sla_impact_waterfall AS
SELECT
  t.hotel_id,
  DATE(t.completed_at) AS day,
  sd.name as department_name,
  COUNT(*) as breached_count
FROM tickets t
JOIN ticket_sla_state ss ON ss.ticket_id = t.id
JOIN services s ON s.id = t.service_id
JOIN departments sd ON sd.id = s.department_id
WHERE t.status = 'COMPLETED'
  AND ss.breached = true
  AND t.completed_at >= CURRENT_DATE - INTERVAL '30 days'
  AND NOT EXISTS (SELECT 1 FROM ticket_events te WHERE te.ticket_id = t.id AND te.event_type = 'SLA_EXCEPTION_GRANTED')
GROUP BY t.hotel_id, DATE(t.completed_at), sd.name;

-- 8️⃣ v_owner_at_risk_breakdown (Live snapshot)
CREATE OR REPLACE VIEW v_owner_at_risk_breakdown AS
SELECT
  t.hotel_id,
  CASE
    WHEN EXISTS (SELECT 1 FROM ticket_events te WHERE te.ticket_id = t.id AND te.event_type = 'BLOCKED' AND NOT EXISTS (SELECT 1 FROM ticket_events unblock WHERE unblock.ticket_id = t.id AND unblock.event_type = 'UNBLOCKED' AND unblock.created_at > te.created_at)) THEN 'Blocked'
    WHEN t.current_assignee_id IS NULL THEN 'Unassigned'
    ELSE 'Time Critical'
  END AS risk_category,
  COUNT(DISTINCT t.id) AS risk_count
FROM tickets t
JOIN ticket_sla_state ss ON ss.ticket_id = t.id
WHERE t.status IN ('NEW', 'IN_PROGRESS')
  AND ss.current_remaining_seconds <= 1800
GROUP BY t.hotel_id, 2;

-- 9️⃣ v_owner_activity_breakdown (Strict 30D)
CREATE OR REPLACE VIEW v_owner_activity_breakdown AS
SELECT
  hotel_id,
  day,
  department_name,
  SUM(created_count) as created_count,
  SUM(resolved_count) as resolved_count
FROM (
  SELECT t.hotel_id, DATE(t.created_at) as day, sd.name as department_name, COUNT(*) as created_count, 0 as resolved_count
  FROM tickets t
  JOIN services s ON s.id = t.service_id
  JOIN departments sd ON sd.id = s.department_id
  WHERE t.created_at >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY t.hotel_id, DATE(t.created_at), sd.name
  UNION ALL
  SELECT t.hotel_id, DATE(t.completed_at) as day, sd.name as department_name, 0 as created_count, COUNT(*) as resolved_count
  FROM tickets t
  JOIN services s ON s.id = t.service_id
  JOIN departments sd ON sd.id = s.department_id
  WHERE t.status = 'COMPLETED' AND t.completed_at >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY t.hotel_id, DATE(t.completed_at), sd.name
) raw
GROUP BY hotel_id, day, department_name;

-- Permissions
GRANT SELECT ON v_owner_kpi_summary TO anon, authenticated;
GRANT SELECT ON v_owner_sla_trend_daily TO anon, authenticated;
GRANT SELECT ON v_owner_sla_breach_breakdown TO anon, authenticated;
GRANT SELECT ON v_owner_block_reason_analysis TO anon, authenticated;
GRANT SELECT ON v_owner_staff_performance TO anon, authenticated;
GRANT SELECT ON v_owner_ticket_activity TO anon, authenticated;
GRANT SELECT ON v_owner_sla_impact_waterfall TO anon, authenticated;
GRANT SELECT ON v_owner_at_risk_breakdown TO anon, authenticated;
GRANT SELECT ON v_owner_activity_breakdown TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
