-- ============================================================
-- Migration: Fix v_ops_board_tickets view
-- Purpose: Also detect BLOCKED + supervisor_approval as needing
--          supervisor action, and properly exclude when decision exists
-- ============================================================

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
  -- Supervisor decision context (UNIFIED DETECTION)
  -- Now detects BOTH:
  --   1. Event-based: SUPERVISOR_REQUESTED, SLA_EXCEPTION_REQUESTED
  --   2. Block-based: BLOCKED + reason_code = 'supervisor_approval'
  -- Both are excluded when a decision event exists after them.
  ---------------------------------------------------------------------------
  (
    (
      pending_event_action.event_type IS NOT NULL
      OR pending_block_action.event_type IS NOT NULL
    )
    AND t.status NOT IN ('COMPLETED', 'CANCELLED')
  )                            AS needs_supervisor_action,

  -- Prefer event-based request type, fallback to block-based
  COALESCE(
    pending_event_action.event_type,
    pending_block_action.event_type
  )                            AS supervisor_request_type,

  COALESCE(
    pending_event_action.reason_code,
    pending_block_action.reason_code
  )                            AS supervisor_reason_code,

  COALESCE(
    pending_event_action.created_at,
    pending_block_action.created_at
  )                            AS supervisor_requested_at,

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
-- Pending supervisor action via EXPLICIT REQUEST EVENTS
-- (SUPERVISOR_REQUESTED, SLA_EXCEPTION_REQUESTED)
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
) pending_event_action ON TRUE

-- ---------------------------------------------------------------------------
-- Pending supervisor action via BLOCKED + supervisor_approval
-- This is the key addition: detects tickets blocked FOR supervisor approval
-- and excludes them when a decision (APPROVED/REJECTED) exists afterward.
-- ---------------------------------------------------------------------------
LEFT JOIN LATERAL (
  SELECT
    te.event_type,
    te.reason_code,
    te.created_at
  FROM ticket_events te
  WHERE te.ticket_id = t.id
    AND te.event_type = 'BLOCKED'
    AND te.reason_code = 'supervisor_approval'
    AND NOT EXISTS (
      SELECT 1
      FROM ticket_events res
      WHERE res.ticket_id = t.id
        AND res.created_at > te.created_at
        AND (
          -- Explicit supervisor decisions
          res.event_type IN (
            'SUPERVISOR_APPROVED',
            'SUPERVISOR_REJECTED'
          )
          OR (
            -- Explicit cancellation ONLY (not any unblock)
            res.event_type = 'UNBLOCKED'
            AND res.reason_code = 'supervisor_request_cancelled'
          )
        )
    )
  ORDER BY te.created_at DESC
  LIMIT 1
) pending_block_action ON TRUE;

-- Permissions
GRANT SELECT ON v_ops_board_tickets TO authenticated;
