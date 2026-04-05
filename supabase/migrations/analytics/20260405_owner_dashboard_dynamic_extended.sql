-- ============================================================
-- REFACTORED OWNER DASHBOARD VIEWS (PART 2)
-- Removing hardcoded intervals and adding 'day' for dynamic UI.
-- ============================================================

-- 1. v_owner_sla_impact_waterfall (Dynamic)
DROP VIEW IF EXISTS v_owner_sla_impact_waterfall;
CREATE OR REPLACE VIEW v_owner_sla_impact_waterfall AS
SELECT
  t.hotel_id,
  DATE(t.completed_at) as day,
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
GROUP BY t.hotel_id, DATE(t.completed_at), sd.name;


-- 2. v_owner_activity_breakdown (Dynamic)
DROP VIEW IF EXISTS v_owner_activity_breakdown;
CREATE OR REPLACE VIEW v_owner_activity_breakdown AS
SELECT
  hotel_id,
  day,
  department_name,
  SUM(created_count) as created_count,
  SUM(resolved_count) as resolved_count
FROM (
  -- Created
  SELECT
    t.hotel_id,
    DATE(t.created_at) as day,
    sd.name as department_name,
    COUNT(*) as created_count,
    0 as resolved_count
  FROM tickets t
  JOIN services s ON s.id = t.service_id
  JOIN departments sd ON sd.id = s.department_id
  GROUP BY t.hotel_id, DATE(t.created_at), sd.name
  
  UNION ALL
  
  -- Resolved
  SELECT
    t.hotel_id,
    DATE(t.completed_at) as day,
    sd.name as department_name,
    0 as created_count,
    COUNT(*) as resolved_count
  FROM tickets t
  JOIN services s ON s.id = t.service_id
  JOIN departments sd ON sd.id = s.department_id
  WHERE t.status = 'COMPLETED'
  GROUP BY t.hotel_id, DATE(t.completed_at), sd.name
) raw
GROUP BY hotel_id, day, department_name;

GRANT SELECT ON v_owner_sla_impact_waterfall TO authenticated, service_role;
GRANT SELECT ON v_owner_activity_breakdown TO authenticated, service_role;
