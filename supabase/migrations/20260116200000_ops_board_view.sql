-- View: v_ops_board_tickets
-- Purpose: Expose tickets with computed 'needs_supervisor_action' flag and relevant reason code
-- avoiding the need to mutate 'tickets' table for event-driven states.

-- ============================================================================
-- View: v_ops_board_tickets
-- Purpose:
--   Full operational dashboard view for Vaiyu.
--   Exposes ALL tickets with:
--     - lifecycle state (NEW / IN_PROGRESS / BLOCKED / etc.)
--     - SLA state (derived)
--     - supervisor decision flags (event-derived, explicit only)
--
--   IMPORTANT:
--   - This view is NOT filtered.
--   - BLOCKED ≠ Needs Supervisor Action.
--   - Supervisor intent is derived ONLY from supervisor events.
-- ============================================================================

CREATE OR REPLACE VIEW v_ops_board_tickets AS
SELECT
  ---------------------------------------------------------------------------
  -- Core identity
  ---------------------------------------------------------------------------
  t.id,
  t.hotel_id,
  t.service_id,

  s.department_id              AS service_department_id,
  t.room_id,
  t.zone_id,

  ---------------------------------------------------------------------------
  -- Service (derived, never joined by clients)
  ---------------------------------------------------------------------------
  s.label                      AS service_label,
  s.key                        AS service_key,
  t.title                      AS legacy_title,     -- historical snapshot

  ---------------------------------------------------------------------------
  -- Ticket lifecycle
  ---------------------------------------------------------------------------
  t.description,
  t.status,                    -- NEW / IN_PROGRESS / BLOCKED / COMPLETED / CANCELLED
  CAST(NULL AS text)           AS priority,          -- placeholder (future)
  t.current_assignee_id        AS assignee_id,
  t.created_by_type,
  t.created_by_id,
  t.created_at,
  t.updated_at,
  t.completed_at,

  ---------------------------------------------------------------------------
  -- SLA (fully derived)
  ---------------------------------------------------------------------------
  sp.target_minutes            AS sla_minutes,

  (ss.sla_started_at
    + (sp.target_minutes || ' minutes')::interval
  )                            AS sla_deadline,

  CASE
    WHEN ss.current_remaining_seconds IS NOT NULL
    THEN (ss.current_remaining_seconds / 60)::int
    ELSE NULL
  END                          AS mins_remaining,

  ---------------------------------------------------------------------------
  -- Supervisor decision context (EXPLICIT ONLY)
  ---------------------------------------------------------------------------
  (
    pending_action.event_type IS NOT NULL
    AND t.status NOT IN ('COMPLETED', 'CANCELLED')
  )                            AS needs_supervisor_action,

  pending_action.event_type    AS supervisor_request_type,
  pending_action.reason_code   AS supervisor_reason_code,
  pending_action.created_at    AS supervisor_requested_at,

  ---------------------------------------------------------------------------
  -- Current operational reason (BLOCK reasons live here)
  ---------------------------------------------------------------------------
  t.reason_code                AS primary_reason_code,

  ---------------------------------------------------------------------------
  -- UI convenience joins
  ---------------------------------------------------------------------------
  r.number                     AS room_number,
  d.name                       AS department_name

FROM tickets t

-- ---------------------------------------------------------------------------
-- Service is the source of truth
-- ---------------------------------------------------------------------------
LEFT JOIN services s
  ON s.id = t.service_id

-- ---------------------------------------------------------------------------
-- Room & department
-- ---------------------------------------------------------------------------
LEFT JOIN rooms r
  ON r.id = t.room_id

LEFT JOIN departments d
  ON d.id = s.department_id

-- ---------------------------------------------------------------------------
-- SLA policy (department-scoped, current schema)
-- ---------------------------------------------------------------------------
LEFT JOIN sla_policies sp
  ON sp.department_id = s.department_id
 AND sp.is_active = true

-- ---------------------------------------------------------------------------
-- SLA runtime state (derived, event-driven)
-- ---------------------------------------------------------------------------
LEFT JOIN ticket_sla_state ss
  ON ss.ticket_id = t.id

-- ---------------------------------------------------------------------------
-- Pending supervisor action (DECISION EVENTS ONLY)
-- ---------------------------------------------------------------------------
LEFT JOIN LATERAL (
  SELECT
    te.event_type,
    te.reason_code,
    te.created_at
    FROM ticket_events te
    WHERE te.ticket_id = t.id
      AND te.event_type IN (
        'SUPERVISOR_REQUESTED',
        'SLA_EXCEPTION_REQUESTED'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM ticket_events res
        WHERE res.ticket_id = t.id
          AND res.created_at > te.created_at
          AND res.event_type IN (
            'SUPERVISOR_APPROVED',
            'SUPERVISOR_REJECTED',
            'SLA_EXCEPTION_GRANTED',
            'SLA_EXCEPTION_REJECTED',
            'SUPERVISOR_REQUEST_CANCELLED'
          )
      )
    ORDER BY te.created_at DESC
    LIMIT 1
) pending_action ON TRUE;
GRANT SELECT ON v_ops_board_tickets TO authenticated;
CREATE INDEX IF NOT EXISTS idx_tickets_hotel_id
ON tickets(hotel_id);
CREATE INDEX IF NOT EXISTS idx_tickets_active_status
ON tickets(status)
WHERE status NOT IN ('COMPLETED', 'CANCELLED');
CREATE INDEX IF NOT EXISTS idx_tickets_room_id
ON tickets(room_id)
WHERE room_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket_type_time
ON ticket_events (ticket_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_services_id_department
ON services(id, department_id);
CREATE INDEX IF NOT EXISTS idx_sla_policies_department_active
ON sla_policies(department_id)
WHERE is_active = true;



GRANT SELECT ON v_ops_board_tickets TO authenticated;