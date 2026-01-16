-- ============================================================
-- Cancellation RPCs: Role-separated, policy-driven
-- Purpose: Terminal ticket cancellation with proper authority boundaries
-- Design: 3 public RPCs + 1 private helper
-- ============================================================

-- ============================================================
-- 0️⃣ PRIVATE HELPER: _cancel_ticket_internal
-- Purpose: Shared terminal mutation + event emission
-- Assumes: All validations already done by caller
-- ============================================================

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
    ticket_id,
    event_type,
    previous_status,
    new_status,
    reason_code,
    actor_type,
    actor_id,
    comment,
    created_at
  ) VALUES (
    p_ticket_id,
    'CANCELLED',
    p_previous_status,
    'CANCELLED',
    p_reason_code,
    p_actor_type,
    p_actor_id,
    TRIM(p_comment),
    NOW()
  );
END;
$$;

-- No permissions granted - internal use only

-- ============================================================
-- 1️⃣ cancel_ticket_by_guest
-- Actor: Guest
-- Scope: Own tickets only
-- Rules:
--   - Status ∈ {NEW, IN_PROGRESS}
--   - Reason must be allowed_for_guest
--   - SLA stops immediately
-- ============================================================

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
  -- Lock ticket
  SELECT *
  INTO v_ticket
  FROM tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  -- Ownership check
  -- Direct check against auth.uid() since there is no 'guests' table
  IF v_ticket.created_by_type <> 'GUEST' OR v_ticket.created_by_id <> auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: not your ticket';
  END IF;

  -- State rules
  IF v_ticket.status NOT IN ('NEW', 'IN_PROGRESS') THEN
    RAISE EXCEPTION 'Guest cannot cancel ticket in status %', v_ticket.status;
  END IF;

  v_prev_status := v_ticket.status;

  -- Cancel reason validation
  SELECT *
  INTO v_reason
  FROM cancel_reasons
  WHERE code = p_reason_code
    AND is_active = TRUE
    AND allowed_for_guest = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid cancel reason for guest';
  END IF;

  -- Workflow rule
  IF v_ticket.status = 'IN_PROGRESS'
     AND v_reason.allow_when_in_progress IS NOT TRUE THEN
    RAISE EXCEPTION 'Cancel reason not allowed when IN_PROGRESS';
  END IF;

  -- Comment enforcement
  IF v_reason.requires_comment
     AND (p_comment IS NULL OR TRIM(p_comment) = '') THEN
    RAISE EXCEPTION 'Comment required for this cancel reason';
  END IF;

  -- Execute cancellation
  PERFORM _cancel_ticket_internal(
    p_ticket_id,
    v_prev_status,
    p_reason_code,
    'GUEST',
    auth.uid(),
    p_comment
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'ticket_id', p_ticket_id,
    'status', 'CANCELLED'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_ticket_by_guest TO authenticated;

-- ============================================================
-- 2️⃣ cancel_ticket_by_staff
-- Actor: Staff
-- Scope: Hotel-scoped tickets
-- Rules:
--   - Status ∈ {NEW, IN_PROGRESS}
--   - NOT allowed on BLOCKED
--   - Reason must be allowed_for_staff
-- ============================================================

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
  -- Lock ticket
  SELECT *
  INTO v_ticket
  FROM tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  -- Reject terminal
  IF v_ticket.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Ticket already terminal';
  END IF;

  -- Staff membership validation
  SELECT id
  INTO v_staff_id
  FROM hotel_members
  WHERE user_id = auth.uid()
    AND hotel_id = v_ticket.hotel_id
    AND is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized staff';
  END IF;

  -- State rules: staff cannot cancel BLOCKED tickets
  IF v_ticket.status = 'BLOCKED' THEN
    RAISE EXCEPTION 'Staff cannot cancel BLOCKED tickets';
  END IF;

  v_prev_status := v_ticket.status;

  -- Cancel reason validation
  SELECT *
  INTO v_reason
  FROM cancel_reasons
  WHERE code = p_reason_code
    AND is_active = TRUE
    AND allowed_for_staff = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid cancel reason for staff';
  END IF;

  -- Workflow enforcement
  IF v_ticket.status = 'IN_PROGRESS'
     AND v_reason.allow_when_in_progress IS NOT TRUE THEN
    RAISE EXCEPTION 'Cancel reason not allowed when IN_PROGRESS';
  END IF;

  -- Comment enforcement
  IF v_reason.requires_comment
     AND (p_comment IS NULL OR TRIM(p_comment) = '') THEN
    RAISE EXCEPTION 'Comment required for this cancel reason';
  END IF;

  -- Execute cancellation
  PERFORM _cancel_ticket_internal(
    p_ticket_id,
    v_prev_status,
    p_reason_code,
    'STAFF',
    v_staff_id,
    p_comment
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'ticket_id', p_ticket_id,
    'status', 'CANCELLED'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_ticket_by_staff TO authenticated;

-- ============================================================
-- 3️⃣ cancel_ticket_by_supervisor
-- Actor: Supervisor
-- Scope: Full authority (any non-terminal state)
-- Rules:
--   - Can cancel any non-terminal state (including BLOCKED)
--   - Reason must be allowed_for_supervisor
--   - Supervisor role verified
-- ============================================================

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
  -- Lock ticket
  SELECT *
  INTO v_ticket
  FROM tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  -- Reject terminal
  IF v_ticket.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Ticket already terminal';
  END IF;

  -- Supervisor membership validation
  SELECT hm.id
  INTO v_supervisor_id
  FROM hotel_members hm
  INNER JOIN hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
  INNER JOIN hotel_roles hr ON hr.id = hmr.hotel_role_id
  WHERE hm.user_id = auth.uid()
    AND hm.hotel_id = v_ticket.hotel_id
    AND hm.is_active = TRUE
    AND hr.code = 'SUPERVISOR'
    AND hr.is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized supervisor';
  END IF;

  v_prev_status := v_ticket.status;

  -- Cancel reason validation
  SELECT *
  INTO v_reason
  FROM cancel_reasons
  WHERE code = p_reason_code
    AND is_active = TRUE
    AND allowed_for_supervisor = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid cancel reason for supervisor';
  END IF;

  -- Comment enforcement
  IF v_reason.requires_comment
     AND (p_comment IS NULL OR TRIM(p_comment) = '') THEN
    RAISE EXCEPTION 'Comment required for this cancel reason';
  END IF;

  -- Execute cancellation
  PERFORM _cancel_ticket_internal(
    p_ticket_id,
    v_prev_status,
    p_reason_code,
    'SUPERVISOR',
    v_supervisor_id,
    p_comment
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'ticket_id', p_ticket_id,
    'status', 'CANCELLED'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_ticket_by_supervisor TO authenticated;
