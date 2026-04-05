-- ============================================================
-- OPS MANAGER ANALYTICS DASHBOARD - STABLE & SECURE VIEWS
-- Purpose: Optimized "Top-Down" views that strictly mirror Owner Patterns.
-- ============================================================

-- Clean up any broken or inefficient views
DROP VIEW IF EXISTS v_ops_kpi_current CASCADE;
DROP VIEW IF EXISTS v_ops_created_resolved_30d CASCADE;
DROP VIEW IF EXISTS v_ops_exception_reasons_30d CASCADE;
DROP VIEW IF EXISTS v_ops_ticket_backlog_30d CASCADE;
DROP VIEW IF EXISTS v_ops_exceptions_30d CASCADE;
DROP VIEW IF EXISTS v_ops_decisions_30d CASCADE;

-- 1️⃣ v_ops_kpi_current (Top Tiles)
-- Inherits RLS from tickets to ensure secure multi-tenant access.
CREATE OR REPLACE VIEW v_ops_kpi_current
WITH (security_invoker = on) AS
SELECT 
    t.hotel_id,
    ROUND(
      100.0 * COUNT(DISTINCT CASE WHEN t.status = 'COMPLETED' AND ss.breached = false THEN t.id END)
      / NULLIF(COUNT(DISTINCT CASE WHEN t.status = 'COMPLETED' AND ss.breached IS NOT NULL THEN t.id END), 0),
      1
    ) AS sla_compliance_percent,
    ROUND(
      100.0 * COUNT(DISTINCT CASE WHEN t.status = 'COMPLETED' AND ss.breached = true THEN t.id END)
      / NULLIF(COUNT(DISTINCT CASE WHEN t.status = 'COMPLETED' AND ss.breached IS NOT NULL THEN t.id END), 0),
      1
    ) AS sla_breach_percent,
    COUNT(DISTINCT t.id) AS active_tasks_count,
    ROUND(
      AVG(CASE WHEN t.status != 'COMPLETED' AND ss.breached = false THEN (ss.current_remaining_seconds / 60.0) ELSE NULL END)
    ) AS avg_time_to_breach
FROM tickets t
LEFT JOIN ticket_sla_state ss ON ss.ticket_id = t.id
GROUP BY t.hotel_id;

-- 2️⃣ v_ops_created_resolved_30d (Main Performance Trend)
CREATE OR REPLACE VIEW v_ops_created_resolved_30d
WITH (security_invoker = on) AS
WITH daily AS (
  SELECT hotel_id,
         generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day')::date AS day
  FROM tickets
  GROUP BY hotel_id
)
SELECT d.hotel_id,
       d.day,
       COUNT(DISTINCT CASE WHEN t.created_at::date = d.day THEN t.id END) AS created_count,
       COUNT(DISTINCT CASE WHEN t.status = 'COMPLETED' AND t.completed_at::date = d.day THEN t.id END) AS resolved_count
FROM daily d
LEFT JOIN tickets t ON t.hotel_id = d.hotel_id AND (t.created_at::date = d.day OR t.completed_at::date = d.day)
GROUP BY d.hotel_id, d.day
ORDER BY d.day DESC;

-- 3️⃣ v_ops_exception_reasons_30d (Pie Chart: Breach Reasons)
CREATE OR REPLACE VIEW v_ops_exception_reasons_30d
WITH (security_invoker = on) AS
SELECT 
  t.hotel_id,
  COALESCE(ser.label, 'Other') AS reason_label,
  COUNT(t.id) AS breach_count,
  ROUND(100.0 * COUNT(t.id) / NULLIF(SUM(COUNT(t.id)) OVER (PARTITION BY t.hotel_id), 0), 1) AS percentage
FROM tickets t
JOIN ticket_sla_state ss ON ss.ticket_id = t.id
LEFT JOIN ticket_events te ON te.ticket_id = t.id 
  AND te.event_type = 'SLA_EXCEPTION_REQUESTED'
LEFT JOIN sla_exception_reasons ser ON ser.code = te.reason_code
WHERE ss.breached = true
  AND t.status = 'COMPLETED'
  AND t.completed_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY t.hotel_id, ser.label;

-- 4️⃣ v_ops_ticket_backlog_30d (Center Chart: Active Backlog Trend)
CREATE OR REPLACE VIEW v_ops_ticket_backlog_30d
WITH (security_invoker = on) AS
WITH daily AS (
  SELECT hotel_id,
         generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day')::date AS day
  FROM tickets
  GROUP BY hotel_id
)
SELECT d.hotel_id,
       d.day,
       COUNT(DISTINCT t.id) AS backlog_count
FROM daily d
LEFT JOIN tickets t ON t.hotel_id = d.hotel_id 
  AND t.created_at::date <= d.day 
  AND (t.completed_at IS NULL OR t.completed_at::date > d.day)
GROUP BY d.hotel_id, d.day
ORDER BY d.day DESC;

-- 5️⃣ v_ops_exceptions_30d (Bottom Left: Stacked Bar Chart by Dept)
CREATE OR REPLACE VIEW v_ops_exceptions_30d
WITH (security_invoker = on) AS
SELECT 
  t.hotel_id,
  d.name AS department_name,
  COUNT(te.id) FILTER (WHERE ser.category = 'GUEST_DEPENDENCY') AS guest_count,
  COUNT(te.id) FILTER (WHERE ser.category = 'INFRASTRUCTURE') AS infra_count,
  COUNT(te.id) FILTER (WHERE ser.category = 'POLICY') AS policy_count,
  COUNT(te.id) AS total_exception_requests
FROM tickets t
JOIN departments d ON d.id = t.service_department_id
JOIN ticket_events te ON te.ticket_id = t.id AND te.event_type = 'SLA_EXCEPTION_REQUESTED'
LEFT JOIN sla_exception_reasons ser ON ser.code = te.reason_code
WHERE te.created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY t.hotel_id, d.name;

-- 6️⃣ v_ops_decisions_30d (Bottom Right: Stacked Bar Decisions)
CREATE OR REPLACE VIEW v_ops_decisions_30d
WITH (security_invoker = on) AS
SELECT 
  t.hotel_id,
  d.name AS department_name,
  ser.category AS reason_category,
  COUNT(DISTINCT te.id) AS requested_count,
  COUNT(DISTINCT CASE WHEN de.event_type = 'SLA_EXCEPTION_GRANTED' THEN te.id END) AS granted_count,
  COUNT(DISTINCT CASE WHEN de.event_type = 'SLA_EXCEPTION_REJECTED' THEN te.id END) AS rejected_count,
  COUNT(DISTINCT CASE WHEN de.event_type IS NULL THEN te.id END) AS pending_count
FROM tickets t
JOIN departments d ON d.id = t.service_department_id
JOIN ticket_events te ON te.ticket_id = t.id AND te.event_type = 'SLA_EXCEPTION_REQUESTED'
LEFT JOIN sla_exception_reasons ser ON ser.code = te.reason_code
LEFT JOIN ticket_events de ON de.ticket_id = t.id 
  AND de.event_type IN ('SLA_EXCEPTION_GRANTED', 'SLA_EXCEPTION_REJECTED')
  AND de.created_at > te.created_at
WHERE te.created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY t.hotel_id, d.name, ser.category;

-- Security: Enable access for the frontend (Inherits RLS from tickets table)
GRANT SELECT ON v_ops_kpi_current TO anon;
GRANT SELECT ON v_ops_created_resolved_30d TO anon;
GRANT SELECT ON v_ops_exception_reasons_30d TO anon;
GRANT SELECT ON v_ops_ticket_backlog_30d TO anon;
GRANT SELECT ON v_ops_exceptions_30d TO anon;
GRANT SELECT ON v_ops_decisions_30d TO anon;

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';
