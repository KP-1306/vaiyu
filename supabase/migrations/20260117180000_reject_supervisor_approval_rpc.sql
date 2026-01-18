-- ============================================================
-- RPC: reject_supervisor_approval
-- Actor: Supervisor
-- Purpose: Reject a BLOCKED + supervisor_approval request
-- 
-- This RPC handles tickets that are:
--   - status = BLOCKED
--   - Latest BLOCKED event has reason_code = 'supervisor_approval'
--
-- Impact:
--   - No ticket state change (BLOCKED stays BLOCKED)
--   - Emits SUPERVISOR_REJECTED event
--   - Ticket disappears from Supervisor Inbox
--   - Staff must decide next steps
--
-- Design principles:
--   - Events are source of truth (not snapshot columns)
--   - Idempotent-safe for network retries
--   - Race-condition protected via row locking
-- ============================================================

CREATE OR REPLACE FUNCTION reject_supervisor_approval(
  p_ticket_id UUID,
  p_comment TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket_status TEXT;
  v_ticket_hotel_id UUID;
  v_supervisor_id UUID;
  v_latest_block_created_at TIMESTAMPTZ;
  v_latest_block_reason_code TEXT;
BEGIN
  ---------------------------------------------------------------------------
  -- 1. Lock the ticket row (prevents concurrent decisions)
  ---------------------------------------------------------------------------
  SELECT status, hotel_id
  INTO v_ticket_status, v_ticket_hotel_id
  FROM tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket % does not exist', p_ticket_id;
  END IF;

  ---------------------------------------------------------------------------
  -- 2. Ticket must be BLOCKED
  ---------------------------------------------------------------------------
  IF v_ticket_status <> 'BLOCKED' THEN
    RAISE EXCEPTION
      'Cannot reject supervisor approval: ticket % is not BLOCKED (status=%)',
      p_ticket_id, v_ticket_status;
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
    AND hm.hotel_id = v_ticket_hotel_id
    AND hm.is_active = TRUE
    AND hr.code = 'SUPERVISOR'
    AND hr.is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized: not a supervisor for this hotel';
  END IF;

  ---------------------------------------------------------------------------
  -- 4. Get the latest BLOCKED event (source of truth - NOT snapshot column)
  --    Events never lie, snapshots may drift.
  ---------------------------------------------------------------------------
  SELECT te.created_at, te.reason_code
  INTO v_latest_block_created_at, v_latest_block_reason_code
  FROM ticket_events te
  WHERE te.ticket_id = p_ticket_id
    AND te.event_type = 'BLOCKED'
  ORDER BY te.created_at DESC
  LIMIT 1;

  ---------------------------------------------------------------------------
  -- 5. Validate: latest BLOCKED event must have reason_code = 'supervisor_approval'
  --    This is the authoritative check - derived from events, not snapshots.
  ---------------------------------------------------------------------------
  IF v_latest_block_reason_code IS DISTINCT FROM 'supervisor_approval' THEN
    RAISE EXCEPTION
      'Cannot reject supervisor approval: latest BLOCKED event has reason_code=%, not supervisor_approval',
      v_latest_block_reason_code;
  END IF;

  ---------------------------------------------------------------------------
  -- 6. Idempotent-safe: If decision already exists, return success (no duplicate insert)
  --    This makes UI retries safe, network retries harmless, logs cleaner.
  ---------------------------------------------------------------------------
  IF EXISTS (
    SELECT 1
    FROM ticket_events te_decision
    WHERE te_decision.ticket_id = p_ticket_id
      AND te_decision.event_type IN (
        'SUPERVISOR_APPROVED',
        'SUPERVISOR_REJECTED'
      )
      AND te_decision.created_at > COALESCE(v_latest_block_created_at, '1970-01-01'::timestamptz)
  ) THEN
    -- Already decided - return success for idempotency
    RETURN jsonb_build_object(
      'success', TRUE,
      'ticket_id', p_ticket_id,
      'decision', 'REJECTED',
      'message', 'Supervisor decision already recorded',
      'idempotent', TRUE
    );
  END IF;

  ---------------------------------------------------------------------------
  -- 7. Emit SUPERVISOR_REJECTED event (decision-only, immutable)
  ---------------------------------------------------------------------------
  INSERT INTO ticket_events (
    ticket_id,
    event_type,
    reason_code,
    comment,
    actor_type,
    actor_id,
    created_at
  ) VALUES (
    p_ticket_id,
    'SUPERVISOR_REJECTED',
    'supervisor_approval',
    COALESCE(NULLIF(TRIM(p_comment), ''), 'Supervisor rejected approval'),
    'STAFF',  -- Supervisors are staff members; actor_type constraint only allows STAFF/SYSTEM/GUEST/FRONT_DESK
    v_supervisor_id,
    NOW()
  );

  ---------------------------------------------------------------------------
  -- 8. NO ticket status change
  --    NO SLA math
  --    NO block reason mutation
  --    Ticket stays BLOCKED - staff must decide next steps
  ---------------------------------------------------------------------------

  RETURN jsonb_build_object(
    'success', TRUE,
    'ticket_id', p_ticket_id,
    'decision', 'REJECTED',
    'message', 'Supervisor approval rejected. Ticket remains blocked. Staff must take next action.',
    'idempotent', FALSE
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION reject_supervisor_approval TO authenticated;

-- ============================================================
-- Add comment for documentation
-- ============================================================
COMMENT ON FUNCTION reject_supervisor_approval IS 
'Supervisor rejects a BLOCKED + supervisor_approval request.
- Validates using EVENTS (source of truth), not snapshot columns
- Idempotent-safe: duplicate calls return success without re-inserting
- Does NOT unblock the ticket. Staff must decide next steps.
- Emits SUPERVISOR_REJECTED event for audit trail.';
