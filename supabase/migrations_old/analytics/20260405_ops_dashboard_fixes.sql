-- ============================================================
-- FIX: Ops Manager Dashboard Gaps & Security
-- 1. Apply `security_invoker = on` to all Ops views
-- 2. Ensure continuous 30-day timeline for Charts (replaces sparse joins)
-- 3. Use LEFT JOIN in KPI current state to avoid dropping tickets without SLA
-- ============================================================

DROP VIEW IF EXISTS v_ops_kpi_current CASCADE;
CREATE OR REPLACE VIEW v_ops_kpi_current WITH (security_invoker = on) AS
SELECT
  t.hotel_id,

  -- SLA Compliance %
  ROUND(
    100.0 * COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'COMPLETED' AND ss.breached = false)
    / NULLIF(COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'COMPLETED'), 0),
    1
  ) AS sla_compliance_percent,

  -- SLA Breach %
  ROUND(
    100.0 * COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'COMPLETED' AND ss.breached = true)
    / NULLIF(COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'COMPLETED'), 0),
    1
  ) AS sla_breach_percent,

  -- Active tickets at risk (< 30 min remaining)
  COUNT(DISTINCT t.id) FILTER (
    WHERE t.status IN ('NEW','IN_PROGRESS')
      AND ss.breached = false 
      AND (
          (sp.target_minutes * 60) 
          - EXTRACT(EPOCH FROM (NOW() - ss.sla_started_at)) 
          + ss.total_paused_seconds
      ) <= (
        LEAST(
            srp.max_risk_minutes,
            GREATEST(
                srp.min_risk_minutes,
                (sp.target_minutes * srp.risk_percent / 100.0)
            )
        ) * 60
      )
  ) AS at_risk_count,

  -- Avg Remaining % for At-Risk
  ROUND(
    AVG(
      CASE WHEN
        t.status IN ('NEW','IN_PROGRESS')
        AND ss.breached = false
        AND (
            (sp.target_minutes * 60)
            - EXTRACT(EPOCH FROM (NOW() - ss.sla_started_at))
            + ss.total_paused_seconds
        ) <= (
            LEAST(
                srp.max_risk_minutes,
                GREATEST(
                    srp.min_risk_minutes,
                    (sp.target_minutes * srp.risk_percent / 100.0)
                )
            ) * 60
        )
      THEN 
        (
          (
            (sp.target_minutes * 60)
            - EXTRACT(EPOCH FROM (NOW() - ss.sla_started_at))
            + ss.total_paused_seconds
          )
          / NULLIF((sp.target_minutes * 60), 0)
        ) * 100
      ELSE NULL END
    )
  ) AS avg_at_risk_sla_percent,

  -- Today volume
  COUNT(DISTINCT t.id) FILTER (WHERE t.created_at::date = CURRENT_DATE) AS created_today,
  COUNT(DISTINCT t.id) FILTER (
    WHERE t.status = 'COMPLETED'
      AND t.completed_at::date = CURRENT_DATE
  ) AS resolved_today

FROM tickets t
LEFT JOIN ticket_sla_state ss ON ss.ticket_id = t.id
LEFT JOIN services s ON s.id = t.service_id
LEFT JOIN sla_policies sp ON sp.id = ss.sla_policy_id
LEFT JOIN sla_risk_policies srp 
  ON srp.department_id = s.department_id 
 AND srp.hotel_id = t.hotel_id 
 AND srp.is_active = true
GROUP BY t.hotel_id;
GRANT SELECT ON v_ops_kpi_current TO authenticated, service_role;


DROP VIEW IF EXISTS v_ops_created_resolved_30d CASCADE;
CREATE OR REPLACE VIEW v_ops_created_resolved_30d WITH (security_invoker = on) AS
WITH daily AS (
  SELECT hotel_id,
         generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day')::date AS day
  FROM tickets
  GROUP BY hotel_id
)
SELECT
  d.hotel_id,
  d.day,
  COUNT(t_created.id) AS created_count,
  COUNT(t_resolved.id) AS resolved_count
FROM daily d
LEFT JOIN tickets t_created 
  ON t_created.hotel_id = d.hotel_id 
 AND t_created.created_at::date = d.day
LEFT JOIN tickets t_resolved 
  ON t_resolved.hotel_id = d.hotel_id 
 AND t_resolved.status = 'COMPLETED' 
 AND t_resolved.completed_at::date = d.day
GROUP BY d.hotel_id, d.day
ORDER BY d.day;
GRANT SELECT ON v_ops_created_resolved_30d TO authenticated, service_role;


DROP VIEW IF EXISTS v_ops_sla_breach_reasons CASCADE;
CREATE OR REPLACE VIEW v_ops_sla_breach_reasons WITH (security_invoker = on) AS
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
GRANT SELECT ON v_ops_sla_breach_reasons TO authenticated, service_role;


DROP VIEW IF EXISTS v_ops_at_risk_departments CASCADE;
CREATE OR REPLACE VIEW v_ops_at_risk_departments WITH (security_invoker = on) AS
SELECT
    t.hotel_id,
    d.name AS department_name,
    COUNT(*) AS at_risk_count,
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
         LEFT JOIN sla_risk_policies srp 
           ON srp.department_id = d.id 
          AND srp.hotel_id = t.hotel_id 
          AND srp.is_active = true
WHERE t.status IN ('NEW','IN_PROGRESS')
  AND ss.breached = false
  AND ss.sla_started_at IS NOT NULL
  AND (
          (sp.target_minutes * 60)
              - EXTRACT(EPOCH FROM (NOW() - ss.sla_started_at))
              + ss.total_paused_seconds
          ) <= (
            LEAST(
                srp.max_risk_minutes,
                GREATEST(
                    srp.min_risk_minutes,
                    (sp.target_minutes * srp.risk_percent / 100.0)
                )
            ) * 60
          )
GROUP BY t.hotel_id, d.name
ORDER BY at_risk_count DESC;
GRANT SELECT ON v_ops_at_risk_departments TO authenticated, service_role;

DROP VIEW IF EXISTS v_ops_blocked_stagnation_risk CASCADE;
CREATE OR REPLACE VIEW v_ops_blocked_stagnation_risk WITH (security_invoker = on) AS
SELECT
    t.hotel_id,
    d.name AS department_name,
    COUNT(*) AS blocked_count,
    MAX(
            GREATEST(
                    EXTRACT(EPOCH FROM (NOW() - ss.sla_paused_at)) / 3600,
                    0
            )
    ) AS max_hours_blocked
FROM tickets t
         JOIN services s ON s.id = t.service_id
         JOIN departments d ON d.id = s.department_id
         JOIN ticket_sla_state ss ON ss.ticket_id = t.id
WHERE t.status = 'BLOCKED'
  AND ss.sla_paused_at IS NOT NULL
  AND NOW() - ss.sla_paused_at > INTERVAL '2 hours'
  AND t.completed_at IS NULL
  AND t.cancelled_at IS NULL
GROUP BY t.hotel_id, d.name
ORDER BY blocked_count DESC;
GRANT SELECT ON v_ops_blocked_stagnation_risk TO authenticated, service_role;

DROP VIEW IF EXISTS v_ops_open_breaches CASCADE;
CREATE OR REPLACE VIEW v_ops_open_breaches WITH (security_invoker = on) AS
SELECT
  t.hotel_id,
  t.id AS ticket_id,
  SUBSTRING(t.id::text, 1, 8) AS display_id,
  d.name AS department_name,
  p.full_name AS assignee_name,
  p.profile_photo_url AS assignee_avatar, 
  COALESCE(br.label, 'Direct SLA Breach') AS breach_context,
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
GRANT SELECT ON v_ops_open_breaches TO authenticated, service_role;

DROP VIEW IF EXISTS v_ops_backlog_trend CASCADE;
CREATE OR REPLACE VIEW v_ops_backlog_trend WITH (security_invoker = on) AS
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
GRANT SELECT ON v_ops_backlog_trend TO authenticated, service_role;


DROP VIEW IF EXISTS v_ops_agent_risk CASCADE;
CREATE OR REPLACE VIEW v_ops_agent_risk WITH (security_invoker = on) AS
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
GRANT SELECT ON v_ops_agent_risk TO authenticated, service_role;

