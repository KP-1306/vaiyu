-- ============================================================
-- Ticket Lifecycle Logic (RPCs)
-- ============================================================

-- ============================================================
-- RPC: start_task
-- Bypass RLS to allow staff to pick up (start) a NEW task
-- ============================================================
CREATE OR REPLACE FUNCTION start_task(
  p_ticket_id UUID,
  p_comment TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_hotel_id UUID;
  v_member_id UUID;
  v_status TEXT;
  v_assigned_member_id UUID;
  v_updated_ticket JSONB;
BEGIN
  -- 1. Auth
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 2. Lock ticket row
  SELECT hotel_id, status, current_assignee_id
  INTO v_hotel_id, v_status, v_assigned_member_id
  FROM tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  -- 3. Validate status
  IF v_status != 'NEW' THEN
    RAISE EXCEPTION 'Task cannot be started (current status: %)', v_status;
  END IF;

  -- 4. Validate staff membership
  SELECT id
  INTO v_member_id
  FROM hotel_members
  WHERE user_id = v_user_id
    AND hotel_id = v_hotel_id
    AND is_active = true;

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not an active staff member';
  END IF;

  -- 5. Ownership guard
  IF v_assigned_member_id IS NOT NULL
     AND v_assigned_member_id != v_member_id THEN
    RAISE EXCEPTION 'Task already assigned to another staff member';
  END IF;

  -- 6. Update ticket
  UPDATE tickets
  SET 
    status = 'IN_PROGRESS',
    current_assignee_id = COALESCE(current_assignee_id, v_member_id),
    updated_at = now()
  WHERE id = p_ticket_id
    AND status = 'NEW';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task was updated by another process';
  END IF;

  -- 7. Log event
  INSERT INTO ticket_events (
    ticket_id,
    event_type,
    previous_status,
    new_status,
    actor_type,
    actor_id,
    comment
  ) VALUES (
    p_ticket_id,
    'STARTED',
    'NEW',
    'IN_PROGRESS',
    'STAFF',
    v_member_id,
    p_comment
  );

  -- 8. Return updated ticket
  SELECT to_jsonb(t.*)
  INTO v_updated_ticket
  FROM tickets t
  WHERE id = p_ticket_id;

  RETURN v_updated_ticket;
END;
$$;


-- ============================================================
-- RPC: complete_task
-- Staff completes an IN_PROGRESS task
-- ============================================================
CREATE OR REPLACE FUNCTION complete_task(
  p_ticket_id UUID,
  p_comment TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_member_id UUID;
  v_hotel_id UUID;
  v_status TEXT;
  v_current_assignee UUID;
  v_ticket JSONB;
BEGIN
  -- 1. Authentication
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 2. Lock ticket row
  SELECT
    hotel_id,
    status,
    current_assignee_id
  INTO
    v_hotel_id,
    v_status,
    v_current_assignee
  FROM tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  -- 3. Validate ticket state
  IF v_status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION
      'Only IN_PROGRESS tasks can be completed (current status: %)',
      v_status;
  END IF;

  -- 4. Validate staff (must be assignee)
  SELECT id
  INTO v_member_id
  FROM hotel_members
  WHERE user_id = v_user_id
    AND hotel_id = v_hotel_id
    AND is_active = true;

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not an active staff member';
  END IF;

  IF v_current_assignee IS DISTINCT FROM v_member_id THEN
    RAISE EXCEPTION 'Only the assigned staff can complete this task';
  END IF;

  -- 5. Update ticket → COMPLETED
  UPDATE tickets
  SET
    status = 'COMPLETED',
    completed_at = now(),
    updated_at = now()
  WHERE id = p_ticket_id
    AND status = 'IN_PROGRESS';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task was modified concurrently';
  END IF;

  -- 6. Insert immutable COMPLETED event
  INSERT INTO ticket_events (
    ticket_id,
    event_type,
    previous_status,
    new_status,
    comment,
    actor_type,
    actor_id
  )
  VALUES (
    p_ticket_id,
    'COMPLETED',
    'IN_PROGRESS',
    'COMPLETED',
    p_comment,
    'STAFF',
    v_member_id
  );

  -- 7. Return updated ticket
  SELECT to_jsonb(t.*)
  INTO v_ticket
  FROM tickets t
  WHERE id = p_ticket_id;

  RETURN v_ticket;
END;
$$;


-- ============================================================
-- RPC: block_task
-- Staff blocks an IN_PROGRESS task with a reason
-- ============================================================
CREATE OR REPLACE FUNCTION block_task(
  p_ticket_id UUID,
  p_reason_code TEXT,
  p_comment TEXT DEFAULT NULL,
  p_resume_after TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_member_id UUID;
  v_hotel_id UUID;
  v_status TEXT;
  v_current_assignee UUID;
  v_ticket JSONB;
BEGIN
  -- 1. Authentication
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 2. Lock ticket row
  SELECT
    hotel_id,
    status,
    current_assignee_id
  INTO
    v_hotel_id,
    v_status,
    v_current_assignee
  FROM tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  -- 3. Validate ticket state
  IF v_status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION
      'Only IN_PROGRESS tasks can be blocked (current status: %)',
      v_status;
  END IF;

  -- 4. Validate staff membership
  SELECT id
  INTO v_member_id
  FROM hotel_members
  WHERE user_id = v_user_id
    AND hotel_id = v_hotel_id
    AND is_active = true;

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not an active staff member';
  END IF;

  IF v_current_assignee IS DISTINCT FROM v_member_id THEN
    RAISE EXCEPTION 'Only the assigned staff can block this task';
  END IF;

  -- 5. Validate block reason
  IF NOT EXISTS (SELECT 1 FROM block_reasons WHERE code = p_reason_code) THEN
    RAISE EXCEPTION 'Invalid block reason: %', p_reason_code;
  END IF;

  -- 6. Update ticket → BLOCKED
  UPDATE tickets
  SET
    status = 'BLOCKED',
    reason_code = p_reason_code,
    updated_at = now()
  WHERE id = p_ticket_id
    AND status = 'IN_PROGRESS';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task was modified concurrently';
  END IF;

  -- 7. Insert immutable BLOCKED event
  INSERT INTO ticket_events (
    ticket_id,
    event_type,
    previous_status,
    new_status,
    reason_code,
    comment,
    resume_after,
    actor_type,
    actor_id
  )
  VALUES (
    p_ticket_id,
    'BLOCKED',
    'IN_PROGRESS',
    'BLOCKED',
    p_reason_code,
    p_comment,
    p_resume_after,
    'STAFF',
    v_member_id
  );

  -- 8. Return updated ticket
  SELECT to_jsonb(t.*)
  INTO v_ticket
  FROM tickets t
  WHERE id = p_ticket_id;

  RETURN v_ticket;
END;
$$;


-- ============================================================
-- RPC: update_block_task
-- Purpose: Update reason/comment for an already BLOCKED task
-- ============================================================
CREATE OR REPLACE FUNCTION update_block_task(
  p_ticket_id UUID,
  p_reason_code TEXT,
  p_comment TEXT DEFAULT NULL,
  p_resume_after TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_member_id UUID;
  v_hotel_id UUID;
  v_status TEXT;
  v_current_assignee UUID;
  v_ticket JSONB;
BEGIN
  -- 1. Authentication
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 2. Lock ticket row
  SELECT
    hotel_id,
    status,
    current_assignee_id
  INTO
    v_hotel_id,
    v_status,
    v_current_assignee
  FROM tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  -- 3. Validate ticket state
  IF v_status <> 'BLOCKED' THEN
    RAISE EXCEPTION
      'Only BLOCKED tasks can be updated (current status: %)',
      v_status;
  END IF;

  -- 4. Validate staff (must be assignee)
  SELECT id
  INTO v_member_id
  FROM hotel_members
  WHERE user_id = v_user_id
    AND hotel_id = v_hotel_id
    AND is_active = true;

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not an active staff member';
  END IF;

  IF v_current_assignee IS DISTINCT FROM v_member_id THEN
    RAISE EXCEPTION 'Only the assigned staff can update this block';
  END IF;

  -- 5. Validate block reason
  IF NOT EXISTS (
    SELECT 1
    FROM block_reasons
    WHERE code = p_reason_code
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Invalid block reason: %', p_reason_code;
  END IF;

  -- 6. Update ticket (still BLOCKED)
  UPDATE tickets
  SET
    reason_code = p_reason_code,
    updated_at = now()
  WHERE id = p_ticket_id
    AND status = 'BLOCKED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task was modified concurrently';
  END IF;

  -- 7. Insert immutable BLOCKED event (Logged as update)
  INSERT INTO ticket_events (
    ticket_id,
    event_type,
    previous_status,
    new_status,
    reason_code,
    comment,
    resume_after,
    actor_type,
    actor_id
  )
  VALUES (
    p_ticket_id,
    'BLOCKED',
    'BLOCKED',
    'BLOCKED',
    p_reason_code,
    p_comment,
    p_resume_after,
    'STAFF',
    v_member_id
  );

  -- 8. Return updated ticket
  SELECT to_jsonb(t.*)
  INTO v_ticket
  FROM tickets t
  WHERE id = p_ticket_id;

  RETURN v_ticket;
END;
$$;


-- ============================================================
-- RPC: unblock_task
-- Resume a BLOCKED task after resolving the blocking issue
-- ============================================================
CREATE OR REPLACE FUNCTION unblock_task(
  p_ticket_id UUID,
  p_unblock_reason_code TEXT,
  p_comment TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_member_id UUID;
  v_hotel_id UUID;
  v_status TEXT;
  v_current_assignee UUID;
  v_block_reason_code TEXT;
  v_ticket JSONB;
BEGIN
  -- 1. Authentication
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 2. Lock ticket row
  SELECT
    hotel_id,
    status,
    current_assignee_id,
    reason_code
  INTO
    v_hotel_id,
    v_status,
    v_current_assignee,
    v_block_reason_code
  FROM tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  -- 3. Validate ticket state
  IF v_status <> 'BLOCKED' THEN
    RAISE EXCEPTION
      'Only BLOCKED tasks can be resumed (current status: %)',
      v_status;
  END IF;

  IF v_block_reason_code IS NULL THEN
    RAISE EXCEPTION
      'Cannot resume task without a recorded block reason';
  END IF;

  -- 4. Validate staff membership
  SELECT id
  INTO v_member_id
  FROM hotel_members
  WHERE user_id = v_user_id
    AND hotel_id = v_hotel_id
    AND is_active = true;

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not an active staff member';
  END IF;

  IF v_current_assignee IS DISTINCT FROM v_member_id THEN
    RAISE EXCEPTION 'Only the assigned staff can resume this task';
  END IF;

  -- 5. Validate unblock reason
  IF NOT EXISTS (SELECT 1 FROM unblock_reasons WHERE code = p_unblock_reason_code AND is_active = true) THEN
    RAISE EXCEPTION 'Invalid unblock reason: %', p_unblock_reason_code;
  END IF;

  -- 6. Enforce block → unblock compatibility
  IF NOT EXISTS (
    SELECT 1
    FROM block_unblock_compatibility
    WHERE block_reason_code = v_block_reason_code
      AND unblock_reason_code = p_unblock_reason_code
  ) THEN
    RAISE EXCEPTION
      'Unblock reason % is not valid for block reason %',
      p_unblock_reason_code,
      v_block_reason_code;
  END IF;

  -- 7. Enforce comment if required
  IF EXISTS (
    SELECT 1 FROM unblock_reasons
    WHERE code = p_unblock_reason_code AND requires_comment = true
  ) AND (p_comment IS NULL OR length(trim(p_comment)) = 0) THEN
    RAISE EXCEPTION 'Comment is required for unblock reason %', p_unblock_reason_code;
  END IF;

  -- 8. Update ticket → IN_PROGRESS
  UPDATE tickets
  SET
    status = 'IN_PROGRESS',
    reason_code = NULL,
    updated_at = now()
  WHERE id = p_ticket_id
    AND status = 'BLOCKED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task was modified concurrently';
  END IF;

  -- 9. Insert immutable UNBLOCKED event
  INSERT INTO ticket_events (
    ticket_id,
    event_type,
    previous_status,
    new_status,
    reason_code,
    comment,
    actor_type,
    actor_id
  )
  VALUES (
    p_ticket_id,
    'UNBLOCKED',
    'BLOCKED',
    'IN_PROGRESS',
    p_unblock_reason_code,
    p_comment,
    'STAFF',
    v_member_id
  );

  -- 10. Return updated ticket
  SELECT to_jsonb(t.*)
  INTO v_ticket
  FROM tickets t
  WHERE id = p_ticket_id;

  RETURN v_ticket;
END;
$$;


-- ============================================================
-- RPC: reassign_task
-- Supervisor reassigns a blocked task to different staff
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

  -- 2. Lock ticket row
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
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found: %', p_ticket_id;
  END IF;

  -- 3. HARD FAIL if not BLOCKED
  IF v_status != 'BLOCKED' THEN
    RAISE EXCEPTION 'Cannot reassign: ticket is not blocked (status: %)', v_status;
  END IF;

  -- 4. HARD FAIL if not supervisor approval
  IF v_reason != 'supervisor_approval' AND v_reason != 'SUPERVISOR_APPROVAL' THEN
    RAISE EXCEPTION 'Cannot reassign: ticket not waiting for supervisor approval (reason: %)', v_reason;
  END IF;

  -- 5. Verify new assignee exists
  SELECT EXISTS(
    SELECT 1 FROM hotel_members
    WHERE id = p_new_assignee_id
      AND is_active = true
  ) INTO v_new_assignee_exists;

  IF NOT v_new_assignee_exists THEN
    RAISE EXCEPTION 'New assignee not found or inactive: %', p_new_assignee_id;
  END IF;

  -- 6. Prevent no-op reassignment
  IF p_new_assignee_id = v_old_assignee THEN
    RAISE EXCEPTION 'New assignee must be different from current assignee';
  END IF;

  -- 7. Update assignment and status
  UPDATE tickets
  SET current_assignee_id = p_new_assignee_id,
      status = 'IN_PROGRESS',
      reason_code = NULL
  WHERE id = p_ticket_id;

  -- 8. Event 1: REASSIGNED
  INSERT INTO ticket_events (
    ticket_id, event_type, previous_status, new_status, actor_type, actor_id, comment, created_at
  ) VALUES (
    p_ticket_id, 'REASSIGNED', 'BLOCKED', 'IN_PROGRESS', 'SUPERVISOR', p_supervisor_id,
    format('Reassigned from %s to %s. %s', COALESCE(v_old_assignee::TEXT, 'unassigned'), p_new_assignee_id::TEXT, COALESCE(p_comment, '')),
    NOW()
  );

  -- 8. Event 2: UNBLOCKED
  INSERT INTO ticket_events (
    ticket_id, event_type, reason_code, previous_status, new_status, actor_type, actor_id, created_at
  ) VALUES (
    p_ticket_id, 'UNBLOCKED', 'REASSIGNED_BY_SUPERVISOR', 'BLOCKED', 'IN_PROGRESS', 'SUPERVISOR', p_supervisor_id, NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', p_ticket_id,
    'new_assignee_id', p_new_assignee_id,
    'old_assignee_id', v_old_assignee,
    'status', 'IN_PROGRESS'
  );
END;
$$;
GRANT EXECUTE ON FUNCTION reassign_task TO authenticated;


-- ============================================================
-- RPC: reopen_ticket
-- Guest reopens a completed ticket
-- ============================================================
CREATE OR REPLACE FUNCTION reopen_ticket(
  p_ticket_id UUID,
  p_stay_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status TEXT;
  v_ticket_stay_id UUID;
  v_reopen_count INT;
  v_guest_id UUID;
BEGIN
  -- 1. Lock ticket row
  SELECT status, stay_id
  INTO v_status, v_ticket_stay_id
  FROM tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found: %', p_ticket_id;
  END IF;

  -- 2. Security: stay must belong to authenticated guest
  SELECT guest_id INTO v_guest_id
  FROM stays
  WHERE id = p_stay_id AND guest_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized reopen attempt';
  END IF;

  -- 3. Integrity: ticket must belong to this stay
  IF v_ticket_stay_id != p_stay_id THEN
    RAISE EXCEPTION 'Ticket does not belong to this stay';
  END IF;

  -- 4. Only COMPLETED tickets can be reopened
  IF v_status != 'COMPLETED' THEN
    RAISE EXCEPTION 'Can only reopen completed tickets (current status: %)', v_status;
  END IF;

  -- 5. Abuse protection
  SELECT COUNT(*) INTO v_reopen_count
  FROM ticket_events
  WHERE ticket_id = p_ticket_id AND event_type = 'REOPENED';

  IF v_reopen_count >= 2 THEN
    RAISE EXCEPTION 'Ticket has been reopened too many times (max allowed: 2)';
  END IF;

  -- 6. Reset ticket
  UPDATE tickets
  SET
    status = 'NEW',
    current_assignee_id = NULL,
    reason_code = NULL,
    completed_at = NULL,
    updated_at = now()
  WHERE id = p_ticket_id;

  -- 7. Emit REOPENED event
  INSERT INTO ticket_events (
    ticket_id, event_type, previous_status, new_status, actor_type, actor_id, comment, created_at
  ) VALUES (
    p_ticket_id, 'REOPENED', 'COMPLETED', 'NEW', 'GUEST', v_guest_id,
    COALESCE(p_reason, 'Guest reopened completed request'), now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', p_ticket_id,
    'status', 'NEW',
    'reopen_count', v_reopen_count + 1
  );
END;
$$;
GRANT EXECUTE ON FUNCTION reopen_ticket TO authenticated;


-- ============================================================
-- Cancellation RPCs (Guest, Staff, Supervisor)
-- ============================================================

-- PRIVATE HELPER
CREATE OR REPLACE FUNCTION _cancel_ticket_internal(
  p_ticket_id UUID,
  p_previous_status TEXT,
  p_reason_code TEXT,
  p_actor_type TEXT,
  p_actor_id UUID,
  p_comment TEXT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  -- Terminal update
  UPDATE tickets
  SET
    status = 'CANCELLED',
    updated_at = NOW(),
    completed_at = NOW()
  WHERE id = p_ticket_id;

  -- Immutable event
  INSERT INTO ticket_events (
    ticket_id, event_type, previous_status, new_status, reason_code, actor_type, actor_id, comment, created_at
  ) VALUES (
    p_ticket_id, 'CANCELLED', p_previous_status, 'CANCELLED', p_reason_code, p_actor_type, p_actor_id, TRIM(p_comment), NOW()
  );
END;
$$;


-- 1. cancel_ticket_by_guest
CREATE OR REPLACE FUNCTION cancel_ticket_by_guest(
  p_ticket_id UUID,
  p_reason_code TEXT,
  p_comment TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket RECORD;
  v_reason RECORD;
  v_prev_status TEXT;
BEGIN
  SELECT * INTO v_ticket FROM tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found'; END IF;

  IF v_ticket.created_by_type <> 'GUEST' OR v_ticket.created_by_id <> auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: not your ticket';
  END IF;

  IF v_ticket.status NOT IN ('NEW', 'IN_PROGRESS') THEN
    RAISE EXCEPTION 'Guest cannot cancel ticket in status %', v_ticket.status;
  END IF;

  v_prev_status := v_ticket.status;

  SELECT * INTO v_reason FROM cancel_reasons
  WHERE code = p_reason_code AND is_active = TRUE AND allowed_for_guest = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid cancel reason for guest'; END IF;

  IF v_ticket.status = 'IN_PROGRESS' AND v_reason.allow_when_in_progress IS NOT TRUE THEN
    RAISE EXCEPTION 'Cancel reason not allowed when IN_PROGRESS';
  END IF;

  IF v_reason.requires_comment AND (p_comment IS NULL OR TRIM(p_comment) = '') THEN
    RAISE EXCEPTION 'Comment required for this cancel reason';
  END IF;

  PERFORM _cancel_ticket_internal(p_ticket_id, v_prev_status, p_reason_code, 'GUEST', auth.uid(), p_comment);

  RETURN jsonb_build_object('success', TRUE, 'ticket_id', p_ticket_id, 'status', 'CANCELLED');
END;
$$;
GRANT EXECUTE ON FUNCTION cancel_ticket_by_guest TO authenticated;


-- 2. cancel_ticket_by_staff
CREATE OR REPLACE FUNCTION cancel_ticket_by_staff(
  p_ticket_id UUID,
  p_reason_code TEXT,
  p_comment TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket RECORD;
  v_staff_id UUID;
  v_reason RECORD;
  v_prev_status TEXT;
BEGIN
  SELECT * INTO v_ticket FROM tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found'; END IF;

  IF v_ticket.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Ticket already terminal';
  END IF;

  SELECT id INTO v_staff_id FROM hotel_members
  WHERE user_id = auth.uid() AND hotel_id = v_ticket.hotel_id AND is_active = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unauthorized staff'; END IF;

  IF v_ticket.status = 'BLOCKED' THEN
    RAISE EXCEPTION 'Staff cannot cancel BLOCKED tickets';
  END IF;

  v_prev_status := v_ticket.status;

  SELECT * INTO v_reason FROM cancel_reasons
  WHERE code = p_reason_code AND is_active = TRUE AND allowed_for_staff = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid cancel reason for staff'; END IF;

  IF v_ticket.status = 'IN_PROGRESS' AND v_reason.allow_when_in_progress IS NOT TRUE THEN
    RAISE EXCEPTION 'Cancel reason not allowed when IN_PROGRESS';
  END IF;

  IF v_reason.requires_comment AND (p_comment IS NULL OR TRIM(p_comment) = '') THEN
    RAISE EXCEPTION 'Comment required for this cancel reason';
  END IF;

  PERFORM _cancel_ticket_internal(p_ticket_id, v_prev_status, p_reason_code, 'STAFF', v_staff_id, p_comment);

  RETURN jsonb_build_object('success', TRUE, 'ticket_id', p_ticket_id, 'status', 'CANCELLED');
END;
$$;
GRANT EXECUTE ON FUNCTION cancel_ticket_by_staff TO authenticated;


-- 3. cancel_ticket_by_supervisor
CREATE OR REPLACE FUNCTION cancel_ticket_by_supervisor(
  p_ticket_id UUID,
  p_reason_code TEXT,
  p_comment TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket RECORD;
  v_supervisor_id UUID;
  v_reason RECORD;
  v_prev_status TEXT;
BEGIN
  SELECT * INTO v_ticket FROM tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found'; END IF;

  IF v_ticket.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Ticket already terminal';
  END IF;

  SELECT hm.id INTO v_supervisor_id
  FROM hotel_members hm
  INNER JOIN hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
  INNER JOIN hotel_roles hr ON hr.id = hmr.role_id
  WHERE hm.user_id = auth.uid() AND hm.hotel_id = v_ticket.hotel_id AND hm.is_active = TRUE AND hr.code = 'SUPERVISOR' AND hr.is_active = TRUE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Unauthorized supervisor'; END IF;

  v_prev_status := v_ticket.status;

  SELECT * INTO v_reason FROM cancel_reasons
  WHERE code = p_reason_code AND is_active = TRUE AND allowed_for_supervisor = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid cancel reason for supervisor'; END IF;

  IF v_reason.requires_comment AND (p_comment IS NULL OR TRIM(p_comment) = '') THEN
    RAISE EXCEPTION 'Comment required for this cancel reason';
  END IF;

  PERFORM _cancel_ticket_internal(p_ticket_id, v_prev_status, p_reason_code, 'SUPERVISOR', v_supervisor_id, p_comment);

  RETURN jsonb_build_object('success', TRUE, 'ticket_id', p_ticket_id, 'status', 'CANCELLED');
END;
$$;
GRANT EXECUTE ON FUNCTION cancel_ticket_by_supervisor TO authenticated;
