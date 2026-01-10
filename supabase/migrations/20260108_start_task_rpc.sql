-- ============================================================
-- RPC: start_task
-- Bypass RLS to allow staff to pick up (start) a NEW task
-- Robust version:
-- 1. Prevents ticket hijacking (if already assigned to someone else)
-- 2. Preserves supervisor assignment (if assigned to self)
-- 3. Atomic state transition with ownership guard
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
