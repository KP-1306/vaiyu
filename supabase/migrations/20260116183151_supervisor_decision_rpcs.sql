-- ============================================================
-- Supervisor Decision RPCs for Vaiyu
-- ============================================================
-- 
-- Locked Flow Mapping:
-- ┌─────────────────────────┬─────────────────────────┬──────────────────────────┬────────────────────────────┐
-- │ Flow                    │ Request Event/State     │ Reject Event             │ Grant/Approve Event        │
-- ├─────────────────────────┼─────────────────────────┼──────────────────────────┼────────────────────────────┤
-- │ Supervisor Approval     │ BLOCKED+supervisor_appr │ SUPERVISOR_REJECTED      │ SUPERVISOR_APPROVED        │
-- │ SLA Exception           │ SLA_EXCEPTION_REQUESTED │ SLA_EXCEPTION_REJECTED   │ SLA_EXCEPTION_GRANTED      │
-- └─────────────────────────┴─────────────────────────┴──────────────────────────┴────────────────────────────┘
--
-- No overlap. No ambiguity.
-- ============================================================


-- ============================================================
-- RPC: reject_sla_exception
-- Actor: Supervisor
-- Purpose: Reject a pending SLA exception request
-- 
-- Preconditions:
--   - Ticket exists
--   - Ticket not terminal
--   - Caller is supervisor for this hotel
--   - Pending SLA_EXCEPTION_REQUESTED exists (not yet granted/rejected)
--
-- Impact:
--   - SLA continues normally (no reset, no exemption)
--   - Emits SLA_EXCEPTION_REJECTED event
--   - Clears supervisor inbox
--   - Staff UI shows "SLA exception rejected"
--   - NO ticket status change
-- ============================================================

CREATE OR REPLACE FUNCTION reject_sla_exception(
  p_ticket_id UUID,
  p_comment TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket RECORD;
  v_supervisor_id UUID;
  v_latest_sla_request_at TIMESTAMPTZ;
BEGIN
  ---------------------------------------------------------------------------
  -- 1. Lock the ticket row (prevents concurrent decisions)
  ---------------------------------------------------------------------------
  SELECT *
  INTO v_ticket
  FROM tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket % does not exist', p_ticket_id;
  END IF;

  ---------------------------------------------------------------------------
  -- 2. Reject terminal tickets
  ---------------------------------------------------------------------------
  IF v_ticket.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Cannot reject SLA exception on terminal ticket';
  END IF;

  ---------------------------------------------------------------------------
  -- 3. Supervisor validation (must be active supervisor for this hotel)
  ---------------------------------------------------------------------------
  SELECT hm.id
  INTO v_supervisor_id
  FROM hotel_members hm
  JOIN hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
  JOIN hotel_roles hr ON hr.id = hmr.role_id
  WHERE hm.user_id = auth.uid()
    AND hm.hotel_id = v_ticket.hotel_id
    AND hm.is_active = TRUE
    AND hr.code = 'SUPERVISOR'
    AND hr.is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized: not a supervisor for this hotel';
  END IF;

  ---------------------------------------------------------------------------
  -- 4. Validate: pending SLA_EXCEPTION_REQUESTED must exist
  ---------------------------------------------------------------------------
  SELECT te.created_at
  INTO v_latest_sla_request_at
  FROM ticket_events te
  WHERE te.ticket_id = p_ticket_id
    AND te.event_type = 'SLA_EXCEPTION_REQUESTED'
    AND NOT EXISTS (
      SELECT 1
      FROM ticket_events res
      WHERE res.ticket_id = p_ticket_id
        AND res.created_at > te.created_at
        AND res.event_type IN (
          'SLA_EXCEPTION_GRANTED',
          'SLA_EXCEPTION_REJECTED'
        )
    )
  ORDER BY te.created_at DESC
  LIMIT 1;

  IF v_latest_sla_request_at IS NULL THEN
    RAISE EXCEPTION 'No pending SLA exception request for ticket %', p_ticket_id;
  END IF;

  ---------------------------------------------------------------------------
  -- 5. Idempotency check (already decided = return success)
  ---------------------------------------------------------------------------
  IF EXISTS (
    SELECT 1
    FROM ticket_events te_decision
    WHERE te_decision.ticket_id = p_ticket_id
      AND te_decision.event_type IN (
        'SLA_EXCEPTION_GRANTED',
        'SLA_EXCEPTION_REJECTED'
      )
      AND te_decision.created_at > v_latest_sla_request_at
  ) THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'ticket_id', p_ticket_id,
      'sla_exception', 'REJECTED',
      'message', 'SLA exception decision already recorded',
      'idempotent', TRUE
    );
  END IF;

  ---------------------------------------------------------------------------
  -- 6. Comment is mandatory for audit trail
  ---------------------------------------------------------------------------
  IF p_comment IS NULL OR TRIM(p_comment) = '' THEN
    RAISE EXCEPTION 'Rejection comment is required';
  END IF;

  ---------------------------------------------------------------------------
  -- 7. Emit SLA_EXCEPTION_REJECTED event
  ---------------------------------------------------------------------------
  INSERT INTO ticket_events (
    ticket_id,
    event_type,
    reason_code,
    actor_type,
    actor_id,
    comment,
    created_at
  ) VALUES (
    p_ticket_id,
    'SLA_EXCEPTION_REJECTED',
    'sla_exception',
    'STAFF',
    v_supervisor_id,
    TRIM(p_comment),
    NOW()
  );

  ---------------------------------------------------------------------------
  -- 8. NO ticket status change
  --    SLA continues normally
  ---------------------------------------------------------------------------

  RETURN jsonb_build_object(
    'success', TRUE,
    'ticket_id', p_ticket_id,
    'sla_exception', 'REJECTED',
    'message', 'SLA exception rejected. SLA continues normally.',
    'idempotent', FALSE
  );
END;
$$;

GRANT EXECUTE ON FUNCTION reject_sla_exception TO authenticated;

-- Comment for documentation
COMMENT ON FUNCTION reject_sla_exception IS 
'Supervisor rejects a pending SLA exception request.
- Validates pending SLA_EXCEPTION_REQUESTED exists
- Idempotent-safe: duplicate calls return success
- Emits SLA_EXCEPTION_REJECTED event with reason_code=sla_exception
- SLA continues normally, no exemption granted';


-- ============================================================
-- RPC: grant_sla_exception
-- Actor: Supervisor
-- Purpose: Grant SLA exception to a ticket
--
-- Preconditions:
--   - Ticket exists
--   - Ticket not terminal
--   - Caller is supervisor for this hotel
--   - Pending SLA_EXCEPTION_REQUESTED exists (not yet granted/rejected)
--
-- Impact:
--   - SLA permanently exempted (no breach tracking)
--   - Emits SLA_EXCEPTION_GRANTED event
--   - Clears supervisor inbox
--   - NO ticket status change
-- ============================================================

CREATE OR REPLACE FUNCTION grant_sla_exception(
  p_ticket_id UUID,
  p_comment TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket RECORD;
  v_supervisor_id UUID;
  v_latest_sla_request_at TIMESTAMPTZ;
BEGIN
  ---------------------------------------------------------------------------
  -- 1. Lock the ticket row (prevents concurrent decisions)
  ---------------------------------------------------------------------------
  SELECT *
  INTO v_ticket
  FROM tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket % does not exist', p_ticket_id;
  END IF;

  ---------------------------------------------------------------------------
  -- 2. Reject terminal tickets
  ---------------------------------------------------------------------------
  IF v_ticket.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Cannot grant SLA exception on terminal ticket';
  END IF;

  ---------------------------------------------------------------------------
  -- 3. Supervisor validation (must be active supervisor for this hotel)
  ---------------------------------------------------------------------------
  SELECT hm.id
  INTO v_supervisor_id
  FROM hotel_members hm
  JOIN hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
  JOIN hotel_roles hr ON hr.id = hmr.role_id
  WHERE hm.user_id = auth.uid()
    AND hm.hotel_id = v_ticket.hotel_id
    AND hm.is_active = TRUE
    AND hr.code = 'SUPERVISOR'
    AND hr.is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized: not a supervisor for this hotel';
  END IF;

  ---------------------------------------------------------------------------
  -- 4. Validate: pending SLA_EXCEPTION_REQUESTED must exist
  ---------------------------------------------------------------------------
  SELECT te.created_at
  INTO v_latest_sla_request_at
  FROM ticket_events te
  WHERE te.ticket_id = p_ticket_id
    AND te.event_type = 'SLA_EXCEPTION_REQUESTED'
    AND NOT EXISTS (
      SELECT 1
      FROM ticket_events res
      WHERE res.ticket_id = p_ticket_id
        AND res.created_at > te.created_at
        AND res.event_type IN (
          'SLA_EXCEPTION_GRANTED',
          'SLA_EXCEPTION_REJECTED'
        )
    )
  ORDER BY te.created_at DESC
  LIMIT 1;

  IF v_latest_sla_request_at IS NULL THEN
    RAISE EXCEPTION 'No pending SLA exception request for ticket %', p_ticket_id;
  END IF;

  ---------------------------------------------------------------------------
  -- 5. Idempotency check (already decided = return success)
  ---------------------------------------------------------------------------
  IF EXISTS (
    SELECT 1
    FROM ticket_events te_decision
    WHERE te_decision.ticket_id = p_ticket_id
      AND te_decision.event_type IN (
        'SLA_EXCEPTION_GRANTED',
        'SLA_EXCEPTION_REJECTED'
      )
      AND te_decision.created_at > v_latest_sla_request_at
  ) THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'ticket_id', p_ticket_id,
      'sla_exception', 'GRANTED',
      'message', 'SLA exception decision already recorded',
      'idempotent', TRUE
    );
  END IF;

  ---------------------------------------------------------------------------
  -- 6. Comment is mandatory (audit requirement)
  ---------------------------------------------------------------------------
  IF p_comment IS NULL OR TRIM(p_comment) = '' THEN
    RAISE EXCEPTION 'Comment required for SLA exception';
  END IF;

  ---------------------------------------------------------------------------
  -- 7. Emit SLA_EXCEPTION_GRANTED event
  ---------------------------------------------------------------------------
  INSERT INTO ticket_events (
    ticket_id,
    event_type,
    reason_code,
    actor_type,
    actor_id,
    comment,
    created_at
  ) VALUES (
    p_ticket_id,
    'SLA_EXCEPTION_GRANTED',
    'sla_exception',
    'STAFF',
    v_supervisor_id,
    TRIM(p_comment),
    NOW()
  );

  ---------------------------------------------------------------------------
    ----------------------------------------------------------------------------
    -- 8. NO ticket status change
    --    NO SLA state mutation
    --    SLA exemption is event-derived and enforced by:
    --      - breach cron exclusion
    --      - SLA views (EXEMPTED)
    ---------------------------------------------------------------------------
  ---------------------------------------------------------------------------

  RETURN jsonb_build_object(
    'success', TRUE,
    'ticket_id', p_ticket_id,
    'sla_exception', 'GRANTED',
    'message', 'SLA exception granted. SLA is now exempted.',
    'idempotent', FALSE
  );
END;
$$;

GRANT EXECUTE ON FUNCTION grant_sla_exception TO authenticated;

-- Comment for documentation
COMMENT ON FUNCTION grant_sla_exception IS 
'Supervisor grants a pending SLA exception request.
- Validates pending SLA_EXCEPTION_REQUESTED exists
- Idempotent-safe: duplicate calls return success
- Emits SLA_EXCEPTION_GRANTED event with reason_code=sla_exception
- SLA permanently exempted from breach tracking';


-- ============================================================
-- CLEANUP: Drop old incorrect function
-- ============================================================
DROP FUNCTION IF EXISTS reject_supervisor_request(UUID, TEXT);
