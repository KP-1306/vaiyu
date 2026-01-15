-- ============================================================
-- RPC: reassign_task
-- Purpose: Supervisor reassigns a blocked task to different staff
-- ============================================================

CREATE OR REPLACE FUNCTION reassign_task(
  p_ticket_id UUID,
  p_new_assignee_id UUID,
  p_supervisor_id UUID,
  p_comment TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status TEXT;
  v_reason TEXT;
  v_old_assignee UUID;
  v_new_assignee_exists BOOLEAN;
  v_is_supervisor BOOLEAN;
BEGIN
  -- 1. Verify supervisor role
  SELECT EXISTS(
    SELECT 1
    FROM hotel_member_roles hmr
    JOIN hotel_roles hr ON hr.id = hmr.role_id
    WHERE hmr.hotel_member_id = p_supervisor_id
      AND hr.code IN ('SUPERVISOR', 'MANAGER')
  ) INTO v_is_supervisor;

  IF NOT v_is_supervisor THEN
    RAISE EXCEPTION 'Only supervisors can reassign tasks';
  END IF;

  -- 2. Lock ticket row and get current state (concurrency protection)
  SELECT 
    status, 
    reason_code, 
    current_assignee_id
  INTO 
    v_status, 
    v_reason, 
    v_old_assignee
  FROM tickets
  WHERE id = p_ticket_id
  FOR UPDATE;  -- Lock row to prevent race conditions

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found: %', p_ticket_id;
  END IF;

  -- 3. HARD FAIL if not BLOCKED
  IF v_status != 'BLOCKED' THEN
    RAISE EXCEPTION 'Cannot reassign: ticket is not blocked (status: %)', v_status;
  END IF;

  -- 4. HARD FAIL if not supervisor approval (UPPERCASE)
  IF v_reason != 'SUPERVISOR_APPROVAL' THEN
    RAISE EXCEPTION 'Cannot reassign: ticket not waiting for supervisor approval (reason: %)', v_reason;
  END IF;

  -- 5. Verify new assignee exists and is active
  SELECT EXISTS(
    SELECT 1 FROM hotel_members
    WHERE id = p_new_assignee_id
      AND is_active = true
  ) INTO v_new_assignee_exists;

  IF NOT v_new_assignee_exists THEN
    RAISE EXCEPTION 'New assignee not found or inactive: %', p_new_assignee_id;
  END IF;

  -- 6. Prevent no-op reassignment (same assignee)
  IF p_new_assignee_id = v_old_assignee THEN
    RAISE EXCEPTION 'New assignee must be different from current assignee';
  END IF;

  -- 7. Update assignment and status (triggers will handle SLA)
  UPDATE tickets
  SET current_assignee_id = p_new_assignee_id,
      status = 'IN_PROGRESS',
      reason_code = NULL
  WHERE id = p_ticket_id;

  -- 8. Event 1: REASSIGNED (ownership change) with full context
  INSERT INTO ticket_events (
    ticket_id,
    event_type,
    previous_status,
    new_status,
    actor_type,
    actor_id,
    comment,
    created_at
  ) VALUES (
    p_ticket_id,
    'REASSIGNED',
    'BLOCKED',
    'IN_PROGRESS',
    'SUPERVISOR',
    p_supervisor_id,
    format('Reassigned from %s to %s. %s', 
      COALESCE(v_old_assignee::TEXT, 'unassigned'), 
      p_new_assignee_id::TEXT, 
      COALESCE(p_comment, '')),
    NOW()
  );

  -- 8. Event 2: UNBLOCKED (work resumed) with full context
  INSERT INTO ticket_events (
    ticket_id,
    event_type,
    reason_code,
    previous_status,
    new_status,
    actor_type,
    actor_id,
    created_at
  ) VALUES (
    p_ticket_id,
    'UNBLOCKED',
    'REASSIGNED_BY_SUPERVISOR',
    'BLOCKED',
    'IN_PROGRESS',
    'SUPERVISOR',
    p_supervisor_id,
    NOW()
  );

  -- NOTE: SLA resume happens automatically via trigger on status change
  -- We do NOT manually update ticket_sla_state

  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', p_ticket_id,
    'new_assignee_id', p_new_assignee_id,
    'old_assignee_id', v_old_assignee,
    'status', 'IN_PROGRESS'
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION reassign_task TO authenticated;

