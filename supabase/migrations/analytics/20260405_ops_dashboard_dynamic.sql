-- ============================================================
-- DYNAMIC OPS MANAGER ANALYTICS (RPC)
-- ============================================================

DROP FUNCTION IF EXISTS get_ops_dashboard_dynamic(uuid, date, date);
CREATE OR REPLACE FUNCTION get_ops_dashboard_dynamic(
  p_hotel_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_result jsonb;
  v_kpi jsonb;
  v_trend jsonb;
  v_reasons jsonb;
  v_backlog_trend jsonb;
  v_exceptions jsonb;
  v_exception_decisions jsonb;
BEGIN

  -------------------------------------------------------------
  -- 1. Dynamic KPIs (SLA Compliance, Breach Rate, Created, Resolved)
  -------------------------------------------------------------
  SELECT jsonb_build_object(
    'sla_compliance_percent', ROUND(
      100.0 * COUNT(DISTINCT CASE WHEN t.status = 'COMPLETED' AND ss.breached = false THEN t.id END)
      / NULLIF(COUNT(DISTINCT CASE WHEN t.status = 'COMPLETED' AND ss.breached IS NOT NULL THEN t.id END), 0),
      1
    ),
    'sla_breach_percent', ROUND(
      100.0 * COUNT(DISTINCT CASE WHEN t.status = 'COMPLETED' AND ss.breached = true THEN t.id END)
      / NULLIF(COUNT(DISTINCT CASE WHEN t.status = 'COMPLETED' AND ss.breached IS NOT NULL THEN t.id END), 0),
      1
    ),
    'created_in_period', COUNT(DISTINCT CASE WHEN t.created_at::date >= p_start_date AND t.created_at::date <= p_end_date THEN t.id END),
    'resolved_in_period', COUNT(DISTINCT CASE WHEN t.status = 'COMPLETED' AND t.completed_at::date >= p_start_date AND t.completed_at::date <= p_end_date THEN t.id END)
  ) INTO v_kpi
  FROM tickets t
  LEFT JOIN ticket_sla_state ss ON ss.ticket_id = t.id
  WHERE t.hotel_id = p_hotel_id
    -- Only evaluate completed SLA tickets if they completed inside the window. 
    -- BUT Wait! If they created them in the window but haven't completed? 
    -- The KPI logic historically counts all SLA compliance over all time. We want it scoped to tickets completed in the period.
    AND (
      (t.status = 'COMPLETED' AND t.completed_at::date >= p_start_date AND t.completed_at::date <= p_end_date)
      OR
      (t.created_at::date >= p_start_date AND t.created_at::date <= p_end_date)
    );

  -------------------------------------------------------------
  -- 2. Dynamic Created vs Resolved Trend
  -------------------------------------------------------------
  WITH days AS (
    SELECT generate_series(p_start_date::timestamp, p_end_date::timestamp, '1 day'::interval)::date AS day
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'day', d.day,
      'created_count', COALESCE(c.created_count, 0),
      'resolved_count', COALESCE(r.resolved_count, 0)
    )
  ), '[]'::jsonb) INTO v_trend
  FROM days d
  LEFT JOIN (
    SELECT created_at::date AS day, COUNT(*) AS created_count
    FROM tickets
    WHERE hotel_id = p_hotel_id AND created_at::date >= p_start_date AND created_at::date <= p_end_date
    GROUP BY created_at::date
  ) c ON c.day = d.day
  LEFT JOIN (
    SELECT completed_at::date AS day, COUNT(*) AS resolved_count
    FROM tickets
    WHERE hotel_id = p_hotel_id AND status = 'COMPLETED' AND completed_at::date >= p_start_date AND completed_at::date <= p_end_date
    GROUP BY completed_at::date
  ) r ON r.day = d.day;

  -------------------------------------------------------------
  -- 3. Dynamic SLA Breach Reasons
  -------------------------------------------------------------
  WITH breach_data AS (
    SELECT
      COALESCE(br.label, 'Other') AS reason_label,
      COUNT(t.id) AS breach_count
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
    WHERE t.hotel_id = p_hotel_id
      AND t.status = 'COMPLETED'
      AND ss.breached = true
      AND t.completed_at::date >= p_start_date 
      AND t.completed_at::date <= p_end_date
    GROUP BY br.label
  ),
  total_breaches AS (
    SELECT SUM(breach_count) AS total FROM breach_data
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'reason_label', bd.reason_label,
      'breach_count', bd.breach_count,
      'percentage', ROUND(100.0 * bd.breach_count / NULLIF(tb.total, 0), 1)
    )
  ), '[]'::jsonb) INTO v_reasons
  FROM breach_data bd, total_breaches tb;

  -------------------------------------------------------------
  -- 4. Dynamic Backlog Trend
  -------------------------------------------------------------
  WITH days AS (
    SELECT generate_series(p_start_date::timestamp, p_end_date::timestamp, '1 day'::interval)::date AS day
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'day', d.day,
      'backlog_count', COALESCE(bl.cnt, 0)
    )
  ), '[]'::jsonb) INTO v_backlog_trend
  FROM days d
  LEFT JOIN LATERAL (
    SELECT COUNT(t.id) AS cnt
    FROM tickets t
    WHERE t.hotel_id = p_hotel_id
      AND t.created_at::date <= d.day
      AND (t.completed_at IS NULL OR t.completed_at::date > d.day)
  ) bl ON true;

  -------------------------------------------------------------
  -- 5. Dynamic Exceptions by Department
  -------------------------------------------------------------
  WITH exception_requests AS (
    SELECT DISTINCT ON (te.ticket_id)
      te.ticket_id,
      te.reason_code,
      te.created_at AS requested_at
    FROM ticket_events te
    JOIN tickets t ON t.id = te.ticket_id
    WHERE t.hotel_id = p_hotel_id
      AND te.event_type = 'SLA_EXCEPTION_REQUESTED'
      AND te.created_at::date >= p_start_date 
      AND te.created_at::date <= p_end_date
    ORDER BY te.ticket_id, te.created_at ASC
  ),
  agg_exceptions AS (
    SELECT
      d.name AS department_name,
      COUNT(er.ticket_id) FILTER (WHERE ser.category = 'GUEST_DEPENDENCY') AS guest_count,
      COUNT(er.ticket_id) FILTER (WHERE ser.category = 'INFRASTRUCTURE') AS infra_count,
      COUNT(er.ticket_id) FILTER (WHERE ser.category = 'POLICY') AS policy_count,
      COUNT(er.ticket_id) FILTER (WHERE ser.category = 'EXTERNAL_DEPENDENCY') AS external_count,
      COUNT(er.ticket_id) FILTER (WHERE ser.category = 'MANAGEMENT') AS approval_count,
      COUNT(er.ticket_id) FILTER (WHERE ser.category IS NULL OR ser.category = 'OTHER') AS other_count,
      COUNT(er.ticket_id) AS total_exception_requests
    FROM departments d
    JOIN services s ON s.department_id = d.id
    JOIN tickets t ON t.service_id = s.id AND t.hotel_id = p_hotel_id
    JOIN exception_requests er ON er.ticket_id = t.id
    LEFT JOIN sla_exception_reasons ser ON ser.code = er.reason_code AND ser.is_active = true
    GROUP BY d.name
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'department_name', department_name,
      'guest_count', guest_count,
      'infra_count', infra_count,
      'policy_count', policy_count,
      'external_count', external_count,
      'approval_count', approval_count,
      'other_count', other_count,
      'total_exception_requests', total_exception_requests
    )
  ), '[]'::jsonb) INTO v_exceptions
  FROM agg_exceptions;

  -------------------------------------------------------------
  -- 6. Dynamic Exception Decisions
  -------------------------------------------------------------
  WITH exception_requests AS (
    SELECT
      te.ticket_id,
      te.reason_code,
      MIN(te.created_at) AS requested_at
    FROM ticket_events te
    JOIN tickets t ON t.id = te.ticket_id
    WHERE t.hotel_id = p_hotel_id
      AND te.event_type = 'SLA_EXCEPTION_REQUESTED'
    GROUP BY te.ticket_id, te.reason_code
  ),
  decision_events AS (
    SELECT
      te.ticket_id,
      MAX(te.created_at) AS decided_at,
      BOOL_OR(te.event_type = 'SLA_EXCEPTION_GRANTED') AS is_granted,
      BOOL_OR(te.event_type = 'SLA_EXCEPTION_REJECTED') AS is_rejected
    FROM ticket_events te
    JOIN tickets t ON t.id = te.ticket_id
    WHERE t.hotel_id = p_hotel_id
      AND te.event_type IN ('SLA_EXCEPTION_GRANTED', 'SLA_EXCEPTION_REJECTED')
    GROUP BY te.ticket_id
  ),
  agg_decisions AS (
    SELECT
      d.name AS department_name,
      COALESCE(ser.label, 'Other') AS reason_label,
      ser.category AS reason_category,
      COUNT(DISTINCT er.ticket_id) AS requested_count,
      COUNT(DISTINCT er.ticket_id) FILTER (WHERE de.is_granted = true) AS granted_count,
      COUNT(DISTINCT er.ticket_id) FILTER (WHERE de.is_rejected = true) AS rejected_count,
      COUNT(DISTINCT er.ticket_id) FILTER (WHERE de.decided_at IS NULL) AS pending_count
    FROM exception_requests er
    JOIN tickets t ON t.id = er.ticket_id AND t.hotel_id = p_hotel_id
    JOIN services s ON s.id = t.service_id
    JOIN departments d ON d.id = s.department_id
    LEFT JOIN sla_exception_reasons ser ON ser.code = er.reason_code AND ser.is_active = true
    LEFT JOIN decision_events de ON de.ticket_id = er.ticket_id
    WHERE er.requested_at::date >= p_start_date AND er.requested_at::date <= p_end_date
    GROUP BY d.name, ser.label, ser.category
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'department_name', department_name,
      'reason_label', reason_label,
      'reason_category', reason_category,
      'requested_count', requested_count,
      'granted_count', granted_count,
      'rejected_count', rejected_count,
      'pending_count', pending_count
    )
  ), '[]'::jsonb) INTO v_exception_decisions
  FROM agg_decisions;

  -------------------------------------------------------------
  -- Final Result Object
  -------------------------------------------------------------
  v_result = jsonb_build_object(
    'kpi', v_kpi,
    'trend', v_trend,
    'reasons', v_reasons,
    'backlog_trend', v_backlog_trend,
    'exceptions', v_exceptions,
    'exception_decisions', v_exception_decisions
  );

  RETURN v_result;

END;
$$;
GRANT EXECUTE ON FUNCTION get_ops_dashboard_dynamic(uuid, date, date) TO authenticated, service_role;
