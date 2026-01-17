-- ============================================================
-- View: v_supervisor_inbox
-- Purpose: Supervisor decision queue (Needs Supervisor Action)
-- Notes:
--   - Thin semantic wrapper on v_ops_board_tickets
--   - Contains ONLY tickets requiring supervisor decisions
--   - No workflow logic duplicated here
-- ============================================================

CREATE OR REPLACE VIEW v_supervisor_inbox AS
SELECT
  -- -------------------------------------------------------------------------
  -- Identity
  -- -------------------------------------------------------------------------
  v.id                         AS ticket_id,
  v.hotel_id,

  -- -------------------------------------------------------------------------
  -- Service context
  -- -------------------------------------------------------------------------
  v.service_id,
  v.service_key,
  v.service_label,
  v.service_department_id,
  v.department_name,

  -- -------------------------------------------------------------------------
  -- Location context
  -- -------------------------------------------------------------------------
  v.room_id,
  v.room_number,
  v.zone_id,

  -- -------------------------------------------------------------------------
  -- Ticket lifecycle
  -- -------------------------------------------------------------------------
  v.status,
  v.created_at,
  v.updated_at,

  -- -------------------------------------------------------------------------
  -- Supervisor decision context (PRIMARY PURPOSE)
  -- -------------------------------------------------------------------------
  v.supervisor_request_type,
  v.supervisor_reason_code,
  v.supervisor_requested_at,

  -- -------------------------------------------------------------------------
  -- SLA visibility (read-only)
  -- -------------------------------------------------------------------------
  v.sla_minutes,
  v.sla_deadline,
  v.mins_remaining,

  -- -------------------------------------------------------------------------
  -- UI helpers
  -- -------------------------------------------------------------------------
  v.assignee_id,
  v.primary_reason_code

FROM v_ops_board_tickets v
WHERE v.needs_supervisor_action = true;


-- Permissions
GRANT SELECT ON v_supervisor_inbox TO authenticated;
