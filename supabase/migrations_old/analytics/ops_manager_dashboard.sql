-- ============================================================
-- OPS MANAGER DASHBOARD ANALYTICS (FINAL PACK - DYNAMIC SLA)
-- Purpose: Dedicated read-ready views with DYNAMIC SLA CALCULATION
-- ============================================================

-- 1️⃣ v_ops_kpi_current (Current State Only)
-- Replaces v_ops_kpi_summary
DROP VIEW IF EXISTS v_ops_kpi_current CASCADE;
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
        -- Same At-Risk Logic
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
  COUNT(*) FILTER (WHERE t.created_at::date = CURRENT_DATE) AS created_today,
  COUNT(*) FILTER (
    WHERE t.status = 'COMPLETED'
      AND t.completed_at::date = CURRENT_DATE
  ) AS resolved_today

FROM tickets t
JOIN ticket_sla_state ss ON ss.ticket_id = t.id
JOIN services s ON s.id = t.service_id
JOIN sla_policies sp ON sp.id = ss.sla_policy_id
LEFT JOIN sla_risk_policies srp 
  ON srp.department_id = s.department_id 
 AND srp.hotel_id = t.hotel_id 
 AND srp.is_active = true
GROUP BY t.hotel_id;

GRANT SELECT ON v_ops_kpi_current TO authenticated;


-- 2️⃣ v_ops_created_resolved_30d (Last 30 Days – Safe)
-- Replaces v_ops_tickets_created_resolved
DROP VIEW IF EXISTS v_ops_created_resolved_30d CASCADE;
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
DROP VIEW IF EXISTS v_ops_sla_breach_reasons CASCADE;
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
DROP VIEW IF EXISTS v_ops_at_risk_departments CASCADE;
CREATE OR REPLACE VIEW v_ops_at_risk_departments AS
SELECT
    t.hotel_id,
    d.name AS department_name,
    COUNT(*) AS at_risk_count,

    -- Worst remaining SLA time (seconds)
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

  -- 🔑 AT-RISK RULE: last 30% of SLA
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

GRANT SELECT ON v_ops_at_risk_departments TO authenticated;

-- v_ops_blocked_stagnation_risk
-- Purpose: Track tickets blocked for > 2 hours
DROP VIEW IF EXISTS v_ops_blocked_stagnation_risk CASCADE;
CREATE OR REPLACE VIEW v_ops_blocked_stagnation_risk AS
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

GRANT SELECT ON v_ops_blocked_stagnation_risk TO authenticated;

-- 5️⃣ v_ops_open_breaches (Actionable Table)
-- Updated logic
DROP VIEW IF EXISTS v_ops_open_breaches CASCADE;
CREATE OR REPLACE VIEW v_ops_open_breaches AS
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

GRANT SELECT ON v_ops_open_breaches TO authenticated;


-- 6️⃣ v_ops_backlog_trend (Last 30 Days – Safe Version)
-- Optimized
DROP VIEW IF EXISTS v_ops_backlog_trend CASCADE;
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
DROP VIEW IF EXISTS v_ops_agent_risk CASCADE;
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


-- 8️⃣ v_ops_agent_risk_details (Drill-down)
-- Matches logic of v_ops_agent_risk
DROP VIEW IF EXISTS v_ops_agent_risk_details CASCADE;
CREATE OR REPLACE VIEW v_ops_agent_risk_details AS
SELECT
  t.hotel_id,
  t.id AS ticket_id,
  SUBSTRING(t.id::text, 1, 8) AS display_id,
  t.title,
  t.status,
  d.name AS department_name,
  p.full_name AS agent_name,
  p.profile_photo_url AS assignee_avatar,

  -- Remaining Seconds
  (
      (sp.target_minutes * 60)
      - EXTRACT(EPOCH FROM (NOW() - ss.sla_started_at))
      + ss.total_paused_seconds
  ) AS remaining_seconds,

  -- Total Target Seconds
  (sp.target_minutes * 60) AS target_seconds

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
  ) <= 3600;

GRANT SELECT ON v_ops_agent_risk_details TO authenticated;


-- 9️⃣ v_ops_at_risk_details (Drill-down for Departments)
-- Matches logic of v_ops_at_risk_departments
DROP VIEW IF EXISTS v_ops_at_risk_details CASCADE;
CREATE OR REPLACE VIEW v_ops_at_risk_details AS
SELECT
  t.hotel_id,
  t.id AS ticket_id,
  SUBSTRING(t.id::text, 1, 8) AS display_id,
  t.title,
  t.status,
  d.name AS department_name,
  
  -- Assignee info (if any)
  COALESCE(p.full_name, 'Unassigned') AS assignee_name,
  p.profile_photo_url AS assignee_avatar,

  -- Remaining Seconds
  (
      (sp.target_minutes * 60)
      - EXTRACT(EPOCH FROM (NOW() - ss.sla_started_at))
      + ss.total_paused_seconds
  ) AS remaining_seconds,

  -- Total Target Seconds
  (sp.target_minutes * 60) AS target_seconds

FROM tickets t
JOIN ticket_sla_state ss ON ss.ticket_id = t.id
JOIN sla_policies sp ON sp.id = ss.sla_policy_id
JOIN services s ON s.id = t.service_id
JOIN departments d ON d.id = s.department_id
LEFT JOIN sla_risk_policies srp 
  ON srp.department_id = d.id 
 AND srp.hotel_id = t.hotel_id 
 AND srp.is_active = true
LEFT JOIN hotel_members hm ON hm.id = t.current_assignee_id
LEFT JOIN profiles p ON p.id = hm.user_id

WHERE t.status IN ('NEW','IN_PROGRESS')
  AND ss.breached = false
  AND ss.sla_started_at IS NOT NULL

  -- 🔑 AT-RISK RULE: last 30% of SLA (Matches KPI/List)
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
        );

GRANT SELECT ON v_ops_at_risk_details TO authenticated;


-- 8️⃣ v_ops_sla_breaches_by_dept (Preserved & Updated)
DROP VIEW IF EXISTS v_ops_sla_breaches_by_dept CASCADE;
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

--block-stuck tickets details
--block-stuck tickets details
DROP VIEW IF EXISTS v_ops_blocked_tickets_detail CASCADE;
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


-- ============================================================
-- SLA EXCEPTIONS BY DEPARTMENT (Redesign)
-- ============================================================

-- 1. Summary View (User Provided)
DROP VIEW IF EXISTS v_ops_sla_exceptions_by_department CASCADE;
CREATE OR REPLACE VIEW v_ops_sla_exceptions_by_department AS
WITH exception_requests AS (
  -- One SLA exception request per ticket (earliest request)
  SELECT DISTINCT ON (te.ticket_id)
    te.ticket_id,
    te.reason_code,
    te.created_at AS requested_at
  FROM ticket_events te
  WHERE te.event_type = 'SLA_EXCEPTION_REQUESTED'
    AND te.created_at >= CURRENT_DATE - INTERVAL '30 days'
  ORDER BY te.ticket_id, te.created_at ASC
)

SELECT
  d.hotel_id,
  d.id AS department_id,
  d.name AS department_name,

  -- Category buckets for stacked bar
  COUNT(er.ticket_id) FILTER (WHERE ser.category = 'GUEST_DEPENDENCY')      AS guest_count,
  COUNT(er.ticket_id) FILTER (WHERE ser.category = 'INFRASTRUCTURE')        AS infra_count,
  COUNT(er.ticket_id) FILTER (WHERE ser.category = 'POLICY')                AS policy_count,
  COUNT(er.ticket_id) FILTER (WHERE ser.category = 'EXTERNAL_DEPENDENCY')   AS external_count,
  COUNT(er.ticket_id) FILTER (WHERE ser.category = 'MANAGEMENT')            AS approval_count,

  -- Fallback / legacy
  COUNT(er.ticket_id) FILTER (
    WHERE ser.category IS NULL
  ) AS other_count,

  -- Total exceptions (for sorting / tooltip)
  COUNT(er.ticket_id) AS total_exception_requests

FROM departments d
LEFT JOIN services s
  ON s.department_id = d.id
LEFT JOIN tickets t
  ON t.service_id = s.id
LEFT JOIN exception_requests er
  ON er.ticket_id = t.id
LEFT JOIN sla_exception_reasons ser
  ON ser.code = er.reason_code
 AND ser.is_active = true

GROUP BY
  d.hotel_id,
  d.id,
  d.name

ORDER BY
  total_exception_requests DESC;

GRANT SELECT ON v_ops_sla_exceptions_by_department TO authenticated;

-- 2. Detail View for Drill-down (New)
-- Matches the logic of the summary view but returns ticket details.
DROP VIEW IF EXISTS v_ops_sla_exception_details CASCADE;
CREATE OR REPLACE VIEW v_ops_sla_exception_details AS
SELECT
    t.hotel_id,
    t.id AS ticket_id,
    SUBSTRING(t.id::text, 1, 8) AS display_id,
    t.title,
    t.status,
    d.name AS department_name,

    -- Assignee
    p.full_name AS assignee_name,
    p.profile_photo_url AS assignee_avatar,

    -- Exception Details
    COALESCE(ser.label, 'Other') AS block_reason,
    ser.category AS exception_category,
    te.created_at AS exception_occurred_at,
    
    -- No longer tracking "blocked seconds" for exception requests. 
    -- Returning 0 to satisfy frontend type.
    0::numeric AS blocked_seconds

FROM ticket_events te
JOIN tickets t ON t.id = te.ticket_id
JOIN services s ON s.id = t.service_id
JOIN departments d ON d.id = s.department_id
LEFT JOIN sla_exception_reasons ser ON ser.code = te.reason_code
LEFT JOIN hotel_members hm ON hm.id = t.current_assignee_id
LEFT JOIN profiles p ON p.id = hm.user_id

WHERE te.event_type = 'SLA_EXCEPTION_REQUESTED'
  AND te.created_at >= CURRENT_DATE - INTERVAL '30 days';

GRANT SELECT ON v_ops_sla_exception_details TO authenticated;


-- ============================================================
-- SLA EXCEPTION DECISIONS (New Section)
-- ============================================================
DROP VIEW IF EXISTS v_ops_sla_exception_decisions_by_reason CASCADE;
CREATE OR REPLACE VIEW v_ops_sla_exception_decisions_by_reason AS
WITH exception_requests AS (
  SELECT
    te.ticket_id,
    te.reason_code,
    MIN(te.created_at) AS requested_at
  FROM ticket_events te
  WHERE te.event_type = 'SLA_EXCEPTION_REQUESTED'
  GROUP BY te.ticket_id, te.reason_code
),
decision_events AS (
  SELECT
    te.ticket_id,
    MAX(te.created_at) FILTER (
      WHERE te.event_type IN (
        'SLA_EXCEPTION_GRANTED',
        'SLA_EXCEPTION_REJECTED'
      )
    ) AS decided_at
  FROM ticket_events te
  GROUP BY te.ticket_id
)
SELECT
  t.hotel_id,
  d.name AS department_name,

  COALESCE(ser.label, 'Other') AS reason_label,
  ser.category AS reason_category,

  COUNT(DISTINCT er.ticket_id) AS requested_count,

  COUNT(DISTINCT er.ticket_id) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM ticket_events te2
      WHERE te2.ticket_id = er.ticket_id
        AND te2.event_type = 'SLA_EXCEPTION_GRANTED'
      )
  ) AS granted_count,

  COUNT(DISTINCT er.ticket_id) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM ticket_events te2
      WHERE te2.ticket_id = er.ticket_id
        AND te2.event_type = 'SLA_EXCEPTION_REJECTED'
      )
  ) AS rejected_count,

  COUNT(DISTINCT er.ticket_id) FILTER (
    WHERE de.decided_at IS NULL
  ) AS pending_count

FROM exception_requests er
JOIN tickets t ON t.id = er.ticket_id
JOIN services s ON s.id = t.service_id
JOIN departments d ON d.id = s.department_id
LEFT JOIN sla_exception_reasons ser
  ON ser.code = er.reason_code
 AND ser.is_active = true
LEFT JOIN decision_events de
  ON de.ticket_id = er.ticket_id

WHERE er.requested_at >= CURRENT_DATE - INTERVAL '30 days'

GROUP BY
  t.hotel_id,
  d.name,
  COALESCE(ser.label, 'Other'),
  ser.category;

GRANT SELECT ON v_ops_sla_exception_decisions_by_reason TO authenticated;
