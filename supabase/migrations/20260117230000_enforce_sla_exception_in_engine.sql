-- ============================================================
-- Migration: Enforce SLA Exception in Engine
-- Purpose: Make SLA_EXCEPTION_GRANTED operationally effective
--          by excluding exempted tickets from breach tracking
--
-- Pattern: Event-derived (Google style)
--   - SLA exemption is derived from events, not stored
--   - If SLA_EXCEPTION_GRANTED exists after SLA start → SLA ignored forever
--   - ticket_sla_state remains unchanged
--   - Breach cron excludes exempted tickets
--   - Views show 'EXEMPTED' state
--
-- Rule locked forever:
--   Granting an SLA exception makes the SLA engine ignore the ticket forever
-- ============================================================


-- ============================================================
-- 1. UPDATE BREACH CRON FUNCTION
--    Exclude tickets with SLA_EXCEPTION_GRANTED event
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_ticket_sla_statuses()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only update breaches for tickets without SLA exception
  UPDATE ticket_sla_state ss
  SET
    breached = true,
    breached_at = COALESCE(breached_at, clock_timestamp())
  FROM tickets t
  JOIN sla_policies sp
    ON sp.department_id = t.service_department_id
  WHERE ss.ticket_id = t.id
    AND ss.breached = false
    AND ss.sla_started_at IS NOT NULL
    AND ss.sla_paused_at IS NULL
    -- =========================================================
    -- NEW: Exclude tickets with SLA_EXCEPTION_GRANTED
    -- This enforces the promise: "SLA permanently exempted"
    -- =========================================================
    AND NOT EXISTS (
      SELECT 1
      FROM ticket_events te
      WHERE te.ticket_id = t.id
        AND te.event_type = 'SLA_EXCEPTION_GRANTED'
    )
    AND (
      (sp.target_minutes * 60)
      - (
          EXTRACT(EPOCH FROM (clock_timestamp() - ss.sla_started_at))::INT
          - COALESCE(ss.total_paused_seconds, 0)
      )
    ) <= 0;
END;
$$;

COMMENT ON FUNCTION public.update_ticket_sla_statuses IS 
'SLA breach cron function that marks tickets as breached.
EXCLUDES tickets with SLA_EXCEPTION_GRANTED event (event-derived exemption).
Run every minute via pg_cron.';


-- ============================================================
-- 2. UPDATE v_staff_runner_tickets VIEW
--    Add sla_exception_granted flag and EXEMPTED state
-- ============================================================

DROP VIEW IF EXISTS v_staff_runner_tickets;

CREATE OR REPLACE VIEW v_staff_runner_tickets AS
SELECT
    t.id                                  AS ticket_id,
    COALESCE(CONCAT('Room ', r.number), z.name) AS location_label,
    r.number                              AS room_number,
    r.floor                               AS room_floor,
    z.id                                 AS zone_id,
    z.name                               AS zone_name,
    t.hotel_id                           AS hotel_id,
    t.title                              AS title,
    t.description                        AS description,
    t.status                             AS status,
    t.reason_code                        AS reason_code,
    d.name                               AS department_name,
    t.created_at                         AS created_at,
    t.current_assignee_id                AS assigned_staff_id,
    hm.user_id                           AS assigned_user_id,
    COALESCE(p.full_name, 'Auto-queue')  AS assigned_to_name,
    sp.target_minutes                    AS sla_target_minutes,
    ss.sla_started_at                    AS sla_started_at,
    ss.breached                          AS sla_breached,
    
    -- SLA remaining seconds (returns NULL if exempted)
    CASE
        WHEN sla_exempted.is_exempted THEN NULL
        WHEN ss.sla_started_at IS NULL THEN NULL
        ELSE
          GREATEST(
            (sp.target_minutes * 60)
            - (
                EXTRACT(EPOCH FROM (clock_timestamp() - ss.sla_started_at))::INT
                - COALESCE(ss.total_paused_seconds, 0)
                - CASE
                    WHEN ss.sla_paused_at IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (clock_timestamp() - ss.sla_paused_at))::INT
                    ELSE 0
                  END
            ),
            0
          )
    END AS sla_remaining_seconds,
    
    -- SLA state (now includes EXEMPTED)
    CASE
        WHEN sla_exempted.is_exempted THEN 'EXEMPTED'
        WHEN ss.sla_started_at IS NULL THEN 'NOT_STARTED'
        WHEN ss.breached = true THEN 'BREACHED'
        WHEN ss.sla_paused_at IS NOT NULL THEN 'PAUSED'
        ELSE 'RUNNING'
    END AS sla_state,
    
    -- SLA label (human readable)
    CASE
        WHEN sla_exempted.is_exempted THEN 'SLA exempted'
        WHEN ss.sla_started_at IS NULL THEN 'Not started'
        WHEN ss.breached = true THEN 'SLA breached'
        WHEN ss.sla_paused_at IS NOT NULL THEN 'SLA paused'
        ELSE CONCAT(CEIL(
            GREATEST(
                (sp.target_minutes * 60)
                - (
                    EXTRACT(EPOCH FROM (clock_timestamp() - ss.sla_started_at))::INT
                    - COALESCE(ss.total_paused_seconds, 0)
                    - CASE
                        WHEN ss.sla_paused_at IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (clock_timestamp() - ss.sla_paused_at))::INT
                        ELSE 0
                      END
                ),
                0
            ) / 60.0
        ), ' min remaining')
    END AS sla_label,
    
    -- Active work seconds
    CASE
        WHEN t.status = 'IN_PROGRESS'
            AND ss.sla_paused_at IS NULL
            AND ss.sla_started_at IS NOT NULL
            THEN
              EXTRACT(EPOCH FROM (clock_timestamp() - ss.sla_started_at))::INT
              - COALESCE(ss.total_paused_seconds, 0)
        ELSE NULL
    END AS active_work_seconds,
    
    -- Blocked seconds
    CASE
        WHEN ss.sla_paused_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (clock_timestamp() - ss.sla_paused_at))::INT
        ELSE NULL
    END AS blocked_seconds,
    
    t.created_by_type                    AS requested_by,
    
    -- Allowed actions
    CASE
        WHEN t.status = 'NEW' THEN 'START'
        WHEN t.status = 'IN_PROGRESS' THEN 'COMPLETE_OR_BLOCK'
        WHEN t.status = 'BLOCKED' THEN 'UNBLOCK'
        ELSE 'NONE'
    END AS allowed_actions,

    -- Supervisor decision status (for BLOCKED + supervisor_approval)
    CASE
        WHEN t.status = 'BLOCKED' AND t.reason_code = 'supervisor_approval' THEN
            COALESCE(
                (
                    SELECT 
                        CASE 
                            WHEN res.event_type = 'SUPERVISOR_APPROVED' THEN 'APPROVED'
                            WHEN res.event_type = 'SUPERVISOR_REJECTED' THEN 'REJECTED'
                        END
                    FROM ticket_events res
                    WHERE res.ticket_id = t.id
                      AND res.event_type IN ('SUPERVISOR_APPROVED', 'SUPERVISOR_REJECTED')
                      AND res.created_at > (
                          SELECT te_block.created_at
                          FROM ticket_events te_block
                          WHERE te_block.ticket_id = t.id
                            AND te_block.event_type = 'BLOCKED'
                          ORDER BY te_block.created_at DESC
                          LIMIT 1
                      )
                    ORDER BY res.created_at DESC
                    LIMIT 1
                ),
                'PENDING'
            )
        ELSE NULL
    END AS supervisor_decision_status,
    
    -- NEW: SLA exception request status (event-derived)
    -- 'PENDING' = request sent, awaiting decision
    -- 'GRANTED' = exception granted
    -- 'REJECTED' = exception denied
    -- NULL = no request exists
    CASE
        WHEN pending_sla_exception.has_pending THEN 'PENDING'
        WHEN sla_exempted.is_exempted THEN 'GRANTED'
        WHEN pending_sla_exception.was_rejected THEN 'REJECTED'
        ELSE NULL
    END AS sla_exception_request_status,
    
    -- NEW: SLA exception granted flag (event-derived)
    sla_exempted.is_exempted AS sla_exception_granted

FROM tickets t

LEFT JOIN departments d ON d.id = t.service_department_id
LEFT JOIN rooms r ON r.id = t.room_id
LEFT JOIN hotel_zones z ON z.id = t.zone_id
LEFT JOIN hotel_members hm ON hm.id = t.current_assignee_id
LEFT JOIN profiles p ON p.id = hm.user_id
LEFT JOIN ticket_sla_state ss ON ss.ticket_id = t.id
LEFT JOIN sla_policies sp
  ON sp.department_id = t.service_department_id
 AND sp.is_active = true

-- =========================================================
-- NEW: Lateral join to detect SLA exemption (event-derived)
-- =========================================================
LEFT JOIN LATERAL (
  SELECT EXISTS (
    SELECT 1
    FROM ticket_events te
    WHERE te.ticket_id = t.id
      AND te.event_type = 'SLA_EXCEPTION_GRANTED'
  ) AS is_exempted
) sla_exempted ON TRUE

-- =========================================================
-- NEW: Lateral join to detect pending SLA exception request
-- =========================================================
LEFT JOIN LATERAL (
  SELECT
    EXISTS (
      SELECT 1
      FROM ticket_events te
      WHERE te.ticket_id = t.id
        AND te.event_type = 'SLA_EXCEPTION_REQUESTED'
        AND NOT EXISTS (
          SELECT 1
          FROM ticket_events res
          WHERE res.ticket_id = t.id
            AND res.created_at > te.created_at
            AND res.event_type IN (
              'SLA_EXCEPTION_GRANTED',
              'SLA_EXCEPTION_REJECTED'
            )
        )
    ) AS has_pending,
    EXISTS (
      SELECT 1
      FROM ticket_events te
      WHERE te.ticket_id = t.id
        AND te.event_type = 'SLA_EXCEPTION_REJECTED'
    ) AS was_rejected
) pending_sla_exception ON TRUE

WHERE t.status IN ('NEW','IN_PROGRESS','BLOCKED');

-- Grant permissions
GRANT SELECT ON v_staff_runner_tickets TO authenticated;


-- ============================================================
-- 3. UPDATE v_ops_board_tickets VIEW
--    Add sla_exception_granted and EXEMPTED state
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
  t.title                      AS legacy_title,

  ---------------------------------------------------------------------------
  -- Ticket lifecycle
  ---------------------------------------------------------------------------
  t.description,
  t.status,
  CAST(NULL AS text)           AS priority,
  t.current_assignee_id        AS assignee_id,
  t.created_by_type,
  t.created_by_id,
  t.created_at,
  t.updated_at,
  t.completed_at,

  ---------------------------------------------------------------------------
  -- SLA (fully derived, now with exemption support)
  ---------------------------------------------------------------------------
  sp.target_minutes            AS sla_minutes,

  -- SLA deadline (NULL if exempted)
  CASE
    WHEN sla_exempted.is_exempted THEN NULL
    ELSE (ss.sla_started_at + (sp.target_minutes || ' minutes')::interval)
  END                          AS sla_deadline,

  -- Minutes remaining (dynamically calculated, NULL if exempted)
  CASE
    WHEN sla_exempted.is_exempted THEN NULL
    WHEN ss.sla_started_at IS NULL THEN NULL
    WHEN ss.breached = true THEN 0  -- Already breached, show 0
    ELSE GREATEST(
      (sp.target_minutes * 60)
      - (
          EXTRACT(EPOCH FROM (clock_timestamp() - ss.sla_started_at))::INT
          - COALESCE(ss.total_paused_seconds, 0)
          - CASE
              WHEN ss.sla_paused_at IS NOT NULL
              THEN EXTRACT(EPOCH FROM (clock_timestamp() - ss.sla_paused_at))::INT
              ELSE 0
            END
      ),
      0
    ) / 60
  END                          AS mins_remaining,
  
  -- NEW: SLA exception granted flag (event-derived)
  sla_exempted.is_exempted     AS sla_exception_granted,
  
  -- NEW: SLA state with EXEMPTED support
  CASE
    WHEN sla_exempted.is_exempted THEN 'EXEMPTED'
    WHEN ss.sla_started_at IS NULL THEN 'NOT_STARTED'
    WHEN ss.breached = true THEN 'BREACHED'
    WHEN ss.sla_paused_at IS NOT NULL THEN 'PAUSED'
    ELSE 'RUNNING'
  END                          AS sla_state,

  ---------------------------------------------------------------------------
  -- Supervisor decision context (UNIFIED DETECTION)
  ---------------------------------------------------------------------------
  (
    (
      pending_event_action.event_type IS NOT NULL
      OR pending_block_action.event_type IS NOT NULL
    )
    AND t.status NOT IN ('COMPLETED', 'CANCELLED')
  )                            AS needs_supervisor_action,

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
  -- Current operational reason
  ---------------------------------------------------------------------------
  t.reason_code                AS primary_reason_code,

  ---------------------------------------------------------------------------
  -- UI convenience joins
  ---------------------------------------------------------------------------
  r.number                     AS room_number,
  d.name                       AS department_name,
  pr.full_name                 AS assignee_name

FROM tickets t

LEFT JOIN services s
  ON s.id = t.service_id

LEFT JOIN rooms r
  ON r.id = t.room_id

LEFT JOIN departments d
  ON d.id = s.department_id

LEFT JOIN sla_policies sp
  ON sp.department_id = s.department_id
 AND sp.is_active = true

LEFT JOIN ticket_sla_state ss
  ON ss.ticket_id = t.id

LEFT JOIN hotel_members hm
  ON hm.id = t.current_assignee_id

LEFT JOIN profiles pr
  ON pr.id = hm.user_id

-- Pending supervisor action via EXPLICIT REQUEST EVENTS
-- FIX: Use type-specific cancellation logic
--   - SLA_EXCEPTION_REQUESTED → only canceled by SLA_EXCEPTION_GRANTED/REJECTED
--   - SUPERVISOR_REQUESTED → only canceled by SUPERVISOR_APPROVED/REJECTED
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
          AND (
            -- Type-specific cancellation: match request type to response type
            (te.event_type = 'SLA_EXCEPTION_REQUESTED' AND res.event_type IN ('SLA_EXCEPTION_GRANTED', 'SLA_EXCEPTION_REJECTED'))
            OR
            (te.event_type = 'SUPERVISOR_REQUESTED' AND res.event_type IN ('SUPERVISOR_APPROVED', 'SUPERVISOR_REJECTED', 'SUPERVISOR_REQUEST_CANCELLED'))
          )
      )
    ORDER BY te.created_at DESC
    LIMIT 1
) pending_event_action ON TRUE

-- Pending supervisor action via BLOCKED + supervisor_approval
-- FIX: Detect ANY unblock event, not just specific reason codes
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
          -- Direct supervisor decision events
          res.event_type IN ('SUPERVISOR_APPROVED', 'SUPERVISOR_REJECTED')
          -- OR any UNBLOCKED event after the BLOCKED (means ticket was unblocked)
          OR res.event_type = 'UNBLOCKED'
        )
    )
  ORDER BY te.created_at DESC
  LIMIT 1
) pending_block_action ON TRUE

-- SLA exemption detection (event-derived)
LEFT JOIN LATERAL (
  SELECT EXISTS (
    SELECT 1
    FROM ticket_events te
    WHERE te.ticket_id = t.id
      AND te.event_type = 'SLA_EXCEPTION_GRANTED'
  ) AS is_exempted
) sla_exempted ON TRUE;

-- Permissions
GRANT SELECT ON v_ops_board_tickets TO authenticated;
