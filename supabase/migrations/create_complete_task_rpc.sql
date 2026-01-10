-- ============================================================
-- RPC: complete_task
-- Purpose:
--   Staff completes an IN_PROGRESS task
--   SLA ends permanently
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
  ----------------------------------------------------------------
  -- 1️⃣ Authentication
  ----------------------------------------------------------------
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  ----------------------------------------------------------------
  -- 2️⃣ Lock ticket row (race-safe)
  ----------------------------------------------------------------
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

  ----------------------------------------------------------------
  -- 3️⃣ Validate ticket state
  ----------------------------------------------------------------
  IF v_status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION
      'Only IN_PROGRESS tasks can be completed (current status: %)',
      v_status;
  END IF;

  ----------------------------------------------------------------
  -- 4️⃣ Validate staff (must be assignee)
  ----------------------------------------------------------------
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

  ----------------------------------------------------------------
  -- 5️⃣ Update ticket → COMPLETED
  ----------------------------------------------------------------
  UPDATE tickets
  SET
    status = 'COMPLETED',
    completed_at = now(), -- Fix: matches schema
    updated_at = now()
  WHERE id = p_ticket_id
    AND status = 'IN_PROGRESS';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task was modified concurrently';
  END IF;

  ----------------------------------------------------------------
  -- 6️⃣ Insert immutable COMPLETED event
  ----------------------------------------------------------------
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

  ----------------------------------------------------------------
  -- 7️⃣ Return updated ticket
  ----------------------------------------------------------------
  SELECT to_jsonb(t.*)
  INTO v_ticket
  FROM tickets t
  WHERE id = p_ticket_id;

  RETURN v_ticket;
END;
$$;
