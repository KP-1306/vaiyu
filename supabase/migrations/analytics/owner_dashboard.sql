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


-- 🔐 Permissions
-- ============================================================
GRANT SELECT ON
  v_owner_kpi_summary,
  v_owner_sla_trend_daily,
  v_owner_sla_breach_breakdown,
  v_owner_block_reason_analysis,
  v_owner_staff_performance
TO authenticated;
