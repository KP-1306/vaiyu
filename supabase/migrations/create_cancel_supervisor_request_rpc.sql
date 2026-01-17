-- RPC: cancel_supervisor_request
-- Purpose: Allows a staff member to explicitly cancel their own supervisor request.
-- Emits: SUPERVISOR_REQUEST_CANCELLED

CREATE OR REPLACE FUNCTION cancel_supervisor_request(
  p_ticket_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_staff_id UUID;
  v_current_status TEXT;
  v_latest_supervisor_event RECORD;
BEGIN
  -- 1. Identity Check
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 2. Resolve Staff ID
  SELECT id INTO v_staff_id
  FROM hotel_members
  WHERE user_id = v_user_id
  AND is_active = true
  LIMIT 1;

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Active staff profile required';
  END IF;

  -- 3. Verify Ticket & Current Status
  SELECT status INTO v_current_status
  FROM tickets
  WHERE id = p_ticket_id;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  IF v_current_status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Cannot modify completed or cancelled tickets';
  END IF;

  -- 4. Verify there is actually a pending request to cancel
  -- We check for the latest 'SUPERVISOR_REQUESTED' event and ensure it hasn't been resolved yet.
  -- This mirrors the logic in v_ops_board_tickets effectively.
  SELECT * INTO v_latest_supervisor_event
  FROM ticket_events
  WHERE ticket_id = p_ticket_id
    AND event_type IN ('SUPERVISOR_REQUESTED', 'SLA_EXCEPTION_REQUESTED')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_latest_supervisor_event IS NULL THEN
    RAISE EXCEPTION 'No supervisor request found to cancel';
  END IF;

  -- Check if it's already resolved
  PERFORM 1
  FROM ticket_events
  WHERE ticket_id = p_ticket_id
    AND created_at > v_latest_supervisor_event.created_at
    AND event_type IN (
      'SUPERVISOR_APPROVED',
      'SUPERVISOR_REJECTED',
      'SUPERVISOR_REQUEST_CANCELLED',
      'SLA_EXCEPTION_GRANTED',
      'SLA_EXCEPTION_REJECTED'
    );
  
  IF FOUND THEN
    RAISE EXCEPTION 'Supervisor request is already resolved';
  END IF;

  -- 5. Emit Cancellation Event
  INSERT INTO ticket_events (
    ticket_id,
    event_type,
    actor_type,
    actor_id,
    comment,
    reason_code,
    previous_status,
    new_status
  ) VALUES (
    p_ticket_id,
    'SUPERVISOR_REQUEST_CANCELLED',
    'STAFF',
    v_staff_id,
    COALESCE(p_reason, 'Request cancelled by staff'),
    NULL,
    v_current_status, -- Status doesn't change
    v_current_status
  );

END;
$$;

GRANT EXECUTE ON FUNCTION cancel_supervisor_request TO authenticated;
