-- ============================================================
-- RPC: update_block_task
-- Purpose:
--   Update reason/comment for an already BLOCKED task
--   Status remains BLOCKED
--   SLA remains paused
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
  ----------------------------------------------------------------
  -- 1️⃣ Authentication
  ----------------------------------------------------------------
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  ----------------------------------------------------------------
  -- 2️⃣ Lock ticket row
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
  IF v_status <> 'BLOCKED' THEN
    RAISE EXCEPTION
      'Only BLOCKED tasks can be updated (current status: %)',
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
    RAISE EXCEPTION 'Only the assigned staff can update this block';
  END IF;

  ----------------------------------------------------------------
  -- 5️⃣ Validate block reason
  ----------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1
    FROM block_reasons
    WHERE code = p_reason_code
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Invalid block reason: %', p_reason_code;
  END IF;

  ----------------------------------------------------------------
  -- 6️⃣ Update ticket (still BLOCKED)
  ----------------------------------------------------------------
  UPDATE tickets
  SET
    reason_code = p_reason_code,
    updated_at = now()
  WHERE id = p_ticket_id
    AND status = 'BLOCKED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task was modified concurrently';
  END IF;

  ----------------------------------------------------------------
  -- 7️⃣ Insert immutable BLOCK_UPDATED event
  ----------------------------------------------------------------
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

  ----------------------------------------------------------------
  -- 8️⃣ Return updated ticket
  ----------------------------------------------------------------
  SELECT to_jsonb(t.*)
  INTO v_ticket
  FROM tickets t
  WHERE id = p_ticket_id;

  RETURN v_ticket;
END;
$$;
