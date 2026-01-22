-- ============================================================
-- OWNER DASHBOARD ANALYTICS
-- Purpose: Read-only views for Owner Dashboard (KPIs, Charts, Risks)
-- ============================================================

-- 1️⃣ v_owner_kpi_summary (Top tiles)
-- ============================================================
CREATE OR REPLACE VIEW v_owner_kpi_summary AS
SELECT
  t.hotel_id,

  COUNT(*) FILTER (WHERE t.status NOT IN ('CANCELLED'))                      AS total_tickets,

  COUNT(*) FILTER (
    WHERE t.status = 'COMPLETED'
      AND ss.breached = false
      AND NOT EXISTS (
        SELECT 1 FROM ticket_events te
        WHERE te.ticket_id = t.id
          AND te.event_type = 'SLA_EXCEPTION_GRANTED'
      )
  ) AS completed_within_sla,

  COUNT(*) FILTER (
    WHERE ss.breached = true
  ) AS breached_sla,

  COUNT(*) FILTER (
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
    COUNT(*) FILTER (
      WHERE t.status = 'COMPLETED'
        AND ss.breached = false
        AND NOT EXISTS (
          SELECT 1 FROM ticket_events te
          WHERE te.ticket_id = t.id
            AND te.event_type = 'SLA_EXCEPTION_GRANTED'
        )
    )
    /
    NULLIF(COUNT(*) FILTER (WHERE t.status = 'COMPLETED'), 0),
    2
  ) AS sla_compliance_percent

FROM tickets t
LEFT JOIN ticket_sla_state ss ON ss.ticket_id = t.id
LEFT JOIN services s ON s.id = t.service_id
LEFT JOIN sla_policies sp ON sp.department_id = s.department_id
GROUP BY t.hotel_id;


-- 2️⃣ v_owner_sla_trend_daily (Charts)
-- ============================================================
CREATE OR REPLACE VIEW v_owner_sla_trend_daily AS
SELECT
  t.hotel_id,
  DATE(t.completed_at) AS day,

  COUNT(*) FILTER (
    WHERE ss.breached = false
      AND NOT EXISTS (
        SELECT 1 FROM ticket_events te
        WHERE te.ticket_id = t.id
          AND te.event_type = 'SLA_EXCEPTION_GRANTED'
      )
  ) AS completed_within_sla,

  COUNT(*) FILTER (
    WHERE ss.breached = true
  ) AS breached_sla,

  COUNT(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM ticket_events te
      WHERE te.ticket_id = t.id
        AND te.event_type = 'SLA_EXCEPTION_GRANTED'
    )
  ) AS sla_exempted

FROM tickets t
JOIN ticket_sla_state ss ON ss.ticket_id = t.id
WHERE t.completed_at IS NOT NULL
GROUP BY t.hotel_id, DATE(t.completed_at)
ORDER BY day DESC;


-- 3️⃣ v_owner_sla_breach_breakdown (Replaces Exception Breakdown logic for Breaches)
-- ============================================================
CREATE OR REPLACE VIEW v_owner_sla_breach_breakdown AS
SELECT
  t.hotel_id,
  COALESCE(br.label, 'Other') AS reason_label,
  te.reason_code,
  COUNT(DISTINCT t.id) AS breached_count,
  ROUND(
    100.0 * COUNT(DISTINCT t.id)
    / NULLIF(SUM(COUNT(DISTINCT t.id)) OVER (PARTITION BY t.hotel_id), 0),
    2
  ) AS breached_percent
FROM tickets t
JOIN ticket_sla_state ss
  ON ss.ticket_id = t.id
  AND ss.breached = true

-- Find the LAST blocking reason before breach
JOIN LATERAL (
  SELECT reason_code
  FROM ticket_events te
  WHERE te.ticket_id = t.id
    AND te.event_type = 'BLOCKED'
  ORDER BY te.created_at DESC
  LIMIT 1
) te ON TRUE

LEFT JOIN block_reasons br
  ON br.code = te.reason_code

-- IMPORTANT: exclude tickets that were SLA-exempted
WHERE NOT EXISTS (
  SELECT 1
  FROM ticket_events ex
  WHERE ex.ticket_id = t.id
    AND ex.event_type = 'SLA_EXCEPTION_GRANTED'
)

GROUP BY t.hotel_id, te.reason_code, br.label
ORDER BY breached_count DESC;


-- 4️⃣ v_owner_block_reason_analysis
-- ============================================================
CREATE OR REPLACE VIEW v_owner_block_reason_analysis AS
SELECT
  t.hotel_id,
  te.reason_code,
  COUNT(*) AS block_count
FROM ticket_events te
JOIN tickets t ON t.id = te.ticket_id
WHERE te.event_type = 'BLOCKED'
GROUP BY t.hotel_id, te.reason_code
ORDER BY block_count DESC;


-- 5️⃣ v_owner_staff_performance (High level)
-- ============================================================
CREATE OR REPLACE VIEW v_owner_staff_performance AS
SELECT
  hm.hotel_id,
  hm.id AS staff_id,
  p.full_name,

  COUNT(*) FILTER (WHERE t.status = 'COMPLETED') AS completed_tasks,

  COUNT(*) FILTER (
    WHERE t.status = 'COMPLETED'
      AND ss.breached = false
  ) AS completed_within_sla,

  ROUND(
    100.0 *
    COUNT(*) FILTER (
      WHERE t.status = 'COMPLETED'
        AND ss.breached = false
    )
    /
    NULLIF(COUNT(*) FILTER (WHERE t.status = 'COMPLETED'), 0),
    2
  ) AS sla_success_rate

FROM tickets t
JOIN hotel_members hm ON hm.id = t.current_assignee_id
JOIN profiles p ON p.id = hm.user_id
LEFT JOIN ticket_sla_state ss ON ss.ticket_id = t.id
GROUP BY hm.hotel_id, hm.id, p.full_name;


-- 6️⃣ v_owner_ticket_activity (Created vs Resolved)
-- ============================================================
CREATE OR REPLACE VIEW v_owner_ticket_activity AS
SELECT
  hotel_id,
  day,
  SUM(created_count) as created_count,
  SUM(resolved_count) as resolved_count
FROM (
  -- 1. Created tickets
  SELECT
    hotel_id,
    DATE(created_at) as day,
    COUNT(*) as created_count,
    0 as resolved_count
  FROM tickets
  GROUP BY hotel_id, DATE(created_at)
  
  UNION ALL
  
  -- 2. Resolved (Completed) tickets
  SELECT
    hotel_id,
    DATE(completed_at) as day,
    0 as created_count,
    COUNT(*) as resolved_count
  FROM tickets
  WHERE status = 'COMPLETED'
  GROUP BY hotel_id, DATE(completed_at)
) raw
GROUP BY hotel_id, day
ORDER BY day DESC;


-- 7️⃣ v_owner_sla_impact_waterfall (SLA Breakdown)
-- ============================================================
CREATE OR REPLACE VIEW v_owner_sla_impact_waterfall AS
WITH hotel_stats AS (
  SELECT
    hotel_id,
    COUNT(*) as total_completed
  FROM tickets
  WHERE status = 'COMPLETED'
  GROUP BY hotel_id
),
dept_breaches AS (
  SELECT
    t.hotel_id,
    sd.name as department_name,
    COUNT(*) as breached_count
  FROM tickets t
  JOIN ticket_sla_state ss ON ss.ticket_id = t.id
  JOIN services s ON s.id = t.service_id
  JOIN departments sd ON sd.id = s.department_id
  WHERE t.status = 'COMPLETED'
    AND ss.breached = true
    AND NOT EXISTS (
       SELECT 1 FROM ticket_events te
       WHERE te.ticket_id = t.id AND te.event_type = 'SLA_EXCEPTION_GRANTED'
    )
  GROUP BY t.hotel_id, sd.name
)
SELECT
  db.hotel_id,
  db.department_name,
  db.breached_count,
  hs.total_completed,
  ROUND((db.breached_count::numeric / NULLIF(hs.total_completed, 0)) * 100, 2) as impact_percent
FROM dept_breaches db
JOIN hotel_stats hs ON hs.hotel_id = db.hotel_id
ORDER BY impact_percent DESC;


-- 🔐 Permissions
-- ============================================================
GRANT SELECT ON
  v_owner_kpi_summary,
  v_owner_sla_trend_daily,
  v_owner_sla_breach_breakdown,
  v_owner_block_reason_analysis,
  v_owner_staff_performance,
  v_owner_ticket_activity,
  v_owner_sla_impact_waterfall
TO authenticated;

-- 8️⃣ v_owner_at_risk_breakdown (Risk Explanation)
-- ============================================================
CREATE OR REPLACE VIEW v_owner_at_risk_breakdown AS
SELECT
  t.hotel_id,
  CASE
    -- 1. BLOCKED: Ticket is currently in a blocked state
    WHEN EXISTS (
      SELECT 1 FROM ticket_events te
      WHERE te.ticket_id = t.id
        AND te.event_type = 'BLOCKED'
        AND NOT EXISTS (
           SELECT 1 FROM ticket_events unblock 
           WHERE unblock.ticket_id = t.id 
             AND unblock.event_type = 'UNBLOCKED' 
             AND unblock.created_at > te.created_at
        )
    ) THEN 'Blocked'
    
    -- 2. UNASSIGNED: No current assignee
    WHEN t.current_assignee_id IS NULL THEN 'Unassigned'
    
    -- 3. TIME CRITICAL: Otherwise, it's just low time
    ELSE 'Time Critical'
  END AS risk_category,
  COUNT(*) as ticket_count
FROM tickets t
JOIN ticket_sla_state ss ON ss.ticket_id = t.id
LEFT JOIN services s ON s.id = t.service_id
LEFT JOIN sla_policies sp ON sp.department_id = s.department_id
WHERE t.status IN ('NEW', 'IN_PROGRESS')
  -- Reuse "At Risk" logic from KPI view
  AND ss.current_remaining_seconds <= LEAST(
        30 * 60,
        sp.target_minutes * 60 * 0.25
      )
  AND NOT EXISTS (
    SELECT 1 FROM ticket_events te
    WHERE te.ticket_id = t.id
      AND te.event_type = 'SLA_EXCEPTION_GRANTED'
  )
GROUP BY t.hotel_id, 
  CASE
    WHEN EXISTS (
      SELECT 1 FROM ticket_events te
      WHERE te.ticket_id = t.id
        AND te.event_type = 'BLOCKED'
        AND NOT EXISTS (
           SELECT 1 FROM ticket_events unblock 
           WHERE unblock.ticket_id = t.id 
             AND unblock.event_type = 'UNBLOCKED' 
             AND unblock.created_at > te.created_at
        )
    ) THEN 'Blocked'
    WHEN t.current_assignee_id IS NULL THEN 'Unassigned'
    ELSE 'Time Critical'
  END
ORDER BY ticket_count DESC;

GRANT SELECT ON v_owner_at_risk_breakdown TO authenticated;

-- 9️⃣ v_owner_activity_breakdown (Activity Explanation - Created vs Resolved by Dept)
-- ============================================================
CREATE OR REPLACE VIEW v_owner_activity_breakdown AS
WITH dept_services AS (
  SELECT
    d.id AS department_id,
    d.hotel_id,
    d.name AS department_name,
    s.id AS service_id
  FROM departments d
  JOIN services s ON s.department_id = d.id
),

created AS (
  SELECT
    ds.department_id,
    COUNT(DISTINCT t.id) AS created_count
  FROM dept_services ds
  JOIN tickets t
    ON t.service_id = ds.service_id
   AND t.created_at >= CURRENT_DATE - INTERVAL '7 days'
  GROUP BY ds.department_id
),

resolved AS (
  SELECT
    ds.department_id,
    COUNT(DISTINCT t.id) AS resolved_count
  FROM dept_services ds
  JOIN tickets t
    ON t.service_id = ds.service_id
   AND t.status = 'COMPLETED'
   AND t.completed_at >= CURRENT_DATE - INTERVAL '7 days'
  GROUP BY ds.department_id
)

SELECT
  ds.hotel_id,
  ds.department_name,
  COALESCE(c.created_count, 0)  AS created_count,
  COALESCE(r.resolved_count, 0) AS resolved_count,
  COALESCE(c.created_count, 0) - COALESCE(r.resolved_count, 0) AS backlog_delta
FROM (
  SELECT DISTINCT department_id, hotel_id, department_name
  FROM dept_services
) ds
LEFT JOIN created  c ON c.department_id = ds.department_id
LEFT JOIN resolved r ON r.department_id = ds.department_id
ORDER BY created_count DESC;

GRANT SELECT ON v_owner_activity_breakdown TO authenticated;

-- ⚡ Performance Indices for Analytics
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets (created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_completed_at ON tickets (completed_at) WHERE status = 'COMPLETED';
CREATE INDEX IF NOT EXISTS idx_tickets_service_id ON tickets (service_id);
CREATE INDEX IF NOT EXISTS idx_services_department_id ON services (department_id);


