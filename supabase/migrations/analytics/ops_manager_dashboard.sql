-- ============================================================
-- OPS MANAGER DASHBOARD ANALYTICS (FINAL PACK - DYNAMIC SLA)
-- Purpose: Dedicated read-ready views with DYNAMIC SLA CALCULATION
-- ============================================================

-- 1️⃣ v_ops_kpi_current (Current State Only)
-- Replaces v_ops_kpi_summary
CREATE OR REPLACE VIEW v_ops_kpi_current AS
SELECT
  t.hotel_id,

  -- SLA Compliance %
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE t.status = 'COMPLETED' AND ss.breached = false)
    / NULLIF(COUNT(*) FILTER (WHERE t.status = 'COMPLETED'), 0),
    1
  ) AS sla_compliance_percent,

  -- SLA Breach %
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE t.status = 'COMPLETED' AND ss.breached = true)
    / NULLIF(COUNT(*) FILTER (WHERE t.status = 'COMPLETED'), 0),
    1
  ) AS sla_breach_percent,

  -- Active tickets at risk (< 30 min remaining)
  -- DYNAMIC CALCULATION: target_seconds - elapsed + paused
  COUNT(*) FILTER (
    WHERE t.status IN ('NEW','IN_PROGRESS')
      AND ss.breached = false 
      AND (
          (sp.target_minutes * 60) 
          - EXTRACT(EPOCH FROM (NOW() - ss.sla_started_at)) 
          + ss.total_paused_seconds
      ) <= 1800
  ) AS at_risk_count,

  -- Today volume
  COUNT(*) FILTER (WHERE t.created_at::date = CURRENT_DATE) AS created_today,
  COUNT(*) FILTER (
    WHERE t.status = 'COMPLETED'
      AND t.completed_at::date = CURRENT_DATE
  ) AS resolved_today

FROM tickets t
JOIN ticket_sla_state ss ON ss.ticket_id = t.id
JOIN sla_policies sp ON sp.id = ss.sla_policy_id
GROUP BY t.hotel_id;

GRANT SELECT ON v_ops_kpi_current TO authenticated;


-- 2️⃣ v_ops_created_resolved_30d (Last 30 Days – Safe)
-- Replaces v_ops_tickets_created_resolved
CREATE OR REPLACE VIEW v_ops_created_resolved_30d AS
WITH created AS (
  SELECT
    hotel_id,
    created_at::date AS day,
    COUNT(*) AS created_count
  FROM tickets
  WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY hotel_id, day
),
resolved AS (
  SELECT
    hotel_id,
    completed_at::date AS day,
    COUNT(*) AS resolved_count
  FROM tickets
  WHERE status = 'COMPLETED'
    AND completed_at >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY hotel_id, day
)
SELECT
  COALESCE(c.hotel_id, r.hotel_id) AS hotel_id,
  COALESCE(c.day, r.day) AS day,
  COALESCE(c.created_count, 0) AS created_count,
  COALESCE(r.resolved_count, 0) AS resolved_count
FROM created c
FULL OUTER JOIN resolved r
  ON c.hotel_id = r.hotel_id AND c.day = r.day
ORDER BY day;

GRANT SELECT ON v_ops_created_resolved_30d TO authenticated;


-- 3️⃣ v_ops_sla_breach_reasons (30 Days)
-- Updated logic
CREATE OR REPLACE VIEW v_ops_sla_breach_reasons AS
SELECT
  t.hotel_id,
  COALESCE(br.label, 'Other') AS reason_label,
  COUNT(*) AS breach_count,
  ROUND(
    100.0 * COUNT(*) /
    SUM(COUNT(*)) OVER (PARTITION BY t.hotel_id),
    1
  ) AS percentage
FROM tickets t
JOIN ticket_sla_state ss ON ss.ticket_id = t.id
LEFT JOIN LATERAL (
  SELECT reason_code
  FROM ticket_events te
  WHERE te.ticket_id = t.id
    AND te.event_type = 'BLOCKED'
  ORDER BY created_at DESC
  LIMIT 1
) blk ON true
LEFT JOIN block_reasons br ON br.code = blk.reason_code
WHERE t.status = 'COMPLETED'
  AND ss.breached = true
  AND t.completed_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY t.hotel_id, br.label;

GRANT SELECT ON v_ops_sla_breach_reasons TO authenticated;


-- 4️⃣ v_ops_at_risk_departments (Next 4 Hours)
-- Replaces v_ops_at_risk_list
CREATE OR REPLACE VIEW v_ops_at_risk_departments AS
SELECT
  t.hotel_id,
  d.name AS department_name,
  COUNT(*) AS at_risk_count,
  -- DYNAMIC CALCULATION for worst remaining
  MIN(
      GREATEST(
          (sp.target_minutes * 60) 
          - EXTRACT(EPOCH FROM (NOW() - ss.sla_started_at)) 
          + ss.total_paused_seconds,
          0
      )
  ) AS worst_remaining_seconds
FROM tickets t
JOIN services s ON s.id = t.service_id
JOIN departments d ON d.id = s.department_id
JOIN ticket_sla_state ss ON ss.ticket_id = t.id
JOIN sla_policies sp ON sp.id = ss.sla_policy_id
WHERE t.status IN ('NEW','IN_PROGRESS')
  AND ss.breached = false
  AND (
      (sp.target_minutes * 60) 
      - EXTRACT(EPOCH FROM (NOW() - ss.sla_started_at)) 
      + ss.total_paused_seconds
  ) <= 14400
GROUP BY t.hotel_id, d.name
ORDER BY at_risk_count DESC;

GRANT SELECT ON v_ops_at_risk_departments TO authenticated;


-- 5️⃣ v_ops_open_breaches (Actionable Table)
-- Updated logic
CREATE OR REPLACE VIEW v_ops_open_breaches AS
SELECT
  t.hotel_id,
  t.id AS ticket_id,
  SUBSTRING(t.id::text, 1, 8) AS display_id,
  d.name AS department_name,
  p.full_name AS assignee_name,
  p.profile_photo_url AS assignee_avatar, 
  COALESCE(br.label, 'Unspecified') AS breach_reason,
  ROUND(EXTRACT(EPOCH FROM (NOW() - ss.breached_at)) / 3600, 1) AS hours_overdue
FROM tickets t
JOIN ticket_sla_state ss ON ss.ticket_id = t.id
JOIN services s ON s.id = t.service_id
JOIN departments d ON d.id = s.department_id
LEFT JOIN hotel_members hm ON hm.id = t.current_assignee_id
LEFT JOIN profiles p ON p.id = hm.user_id
LEFT JOIN LATERAL (
  SELECT reason_code
  FROM ticket_events te
  WHERE te.ticket_id = t.id
    AND te.event_type = 'BLOCKED'
  ORDER BY created_at DESC
  LIMIT 1
) blk ON true
LEFT JOIN block_reasons br ON br.code = blk.reason_code
WHERE t.status IN ('NEW','IN_PROGRESS')
  AND ss.breached = true
ORDER BY hours_overdue DESC
LIMIT 20;

GRANT SELECT ON v_ops_open_breaches TO authenticated;


-- 6️⃣ v_ops_backlog_trend (Last 30 Days – Safe Version)
-- Optimized
CREATE OR REPLACE VIEW v_ops_backlog_trend AS
WITH daily AS (
  SELECT
    hotel_id,
    generate_series(
      CURRENT_DATE - INTERVAL '29 days',
      CURRENT_DATE,
      '1 day'
    )::date AS day
  FROM tickets
  GROUP BY hotel_id
)
SELECT
  d.hotel_id,
  d.day,
  COUNT(t.id) AS backlog_count
FROM daily d
LEFT JOIN tickets t
  ON t.hotel_id = d.hotel_id
 AND t.created_at::date <= d.day
 AND (t.completed_at IS NULL OR t.completed_at::date > d.day)
GROUP BY d.hotel_id, d.day
ORDER BY d.day;

GRANT SELECT ON v_ops_backlog_trend TO authenticated;


-- 7️⃣ v_ops_agent_risk (Limited Agent Risk)
-- Optimized
CREATE OR REPLACE VIEW v_ops_agent_risk AS
SELECT
  hm.hotel_id,
  p.full_name AS agent_name,
  p.profile_photo_url AS avatar_url, 
  d.name AS department_name,
  COUNT(*) AS at_risk_count
FROM tickets t
JOIN ticket_sla_state ss ON ss.ticket_id = t.id
JOIN sla_policies sp ON sp.id = ss.sla_policy_id
JOIN hotel_members hm ON hm.id = t.current_assignee_id
JOIN profiles p ON p.id = hm.user_id
JOIN services s ON s.id = t.service_id
JOIN departments d ON d.id = s.department_id
WHERE t.status IN ('NEW','IN_PROGRESS')
  AND ss.breached = false
  AND (
      (sp.target_minutes * 60) 
      - EXTRACT(EPOCH FROM (NOW() - ss.sla_started_at)) 
      + ss.total_paused_seconds
  ) <= 3600
GROUP BY hm.hotel_id, p.full_name, p.profile_photo_url, d.name
ORDER BY at_risk_count DESC
LIMIT 5;

GRANT SELECT ON v_ops_agent_risk TO authenticated;


-- 8️⃣ v_ops_sla_breaches_by_dept (Preserved & Updated)
CREATE OR REPLACE VIEW v_ops_sla_breaches_by_dept AS
SELECT
    t.hotel_id,
    d.name as department_name,
    COUNT(*) FILTER (WHERE br.category = 'guest_constraint') as count_guest,
    COUNT(*) FILTER (WHERE br.category = 'dependency') as count_dependency,
    COUNT(*) FILTER (WHERE br.category = 'inventory') as count_inventory,
    COUNT(*) FILTER (WHERE br.category = 'approval') as count_approval,
    COUNT(*) FILTER (WHERE br.category IS NULL OR br.category = 'other') as count_other
FROM tickets t
JOIN services s ON s.id = t.service_id
JOIN departments d ON d.id = s.department_id
JOIN ticket_sla_state ss ON ss.ticket_id = t.id
LEFT JOIN LATERAL (
    SELECT reason_code FROM ticket_events te 
    WHERE te.ticket_id = t.id AND te.event_type = 'BLOCKED' 
    ORDER BY created_at DESC LIMIT 1
) latest_block ON true
LEFT JOIN block_reasons br ON br.code = latest_block.reason_code
WHERE t.status = 'COMPLETED'
  AND ss.breached = true
  AND t.completed_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY t.hotel_id, d.name
ORDER BY COUNT(*) DESC
LIMIT 5;

GRANT SELECT ON v_ops_sla_breaches_by_dept TO authenticated;


-- ⚡ REQUIRED INDEXES
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets (created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_completed_at
  ON tickets (completed_at) WHERE status = 'COMPLETED';
CREATE INDEX IF NOT EXISTS idx_tickets_service_id ON tickets (service_id);
CREATE INDEX IF NOT EXISTS idx_ticket_sla_state_ticket_id
  ON ticket_sla_state (ticket_id);
CREATE INDEX IF NOT EXISTS idx_services_department_id
  ON services (department_id);
CREATE INDEX IF NOT EXISTS idx_ticket_sla_state_started_at
  ON ticket_sla_state (sla_started_at);
