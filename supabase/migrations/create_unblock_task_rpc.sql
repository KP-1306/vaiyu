-- ============================================================
-- RPC: unblock_task
-- Purpose:
--   Resume a BLOCKED task after resolving the blocking issue
--   SLA resume handled by trigger trg_resume_sla_on_unblock
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

  ----------------------------------------------------------------
  -- 3️⃣ Validate ticket state
  ----------------------------------------------------------------
  IF v_status <> 'BLOCKED' THEN
    RAISE EXCEPTION
      'Only BLOCKED tasks can be resumed (current status: %)',
      v_status;
  END IF;

  IF v_block_reason_code IS NULL THEN
    RAISE EXCEPTION
      'Cannot resume task without a recorded block reason';
  END IF;

  ----------------------------------------------------------------
  -- 4️⃣ Validate staff membership (must be assignee)
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
    RAISE EXCEPTION 'Only the assigned staff can resume this task';
  END IF;

  ----------------------------------------------------------------
  -- 5️⃣ Validate unblock reason exists & is active
  ----------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1
    FROM unblock_reasons
    WHERE code = p_unblock_reason_code
      AND is_active = true
  ) THEN
    RAISE EXCEPTION
      'Invalid unblock reason: %',
      p_unblock_reason_code;
  END IF;

  ----------------------------------------------------------------
  -- 6️⃣ Enforce block → unblock compatibility (CRITICAL)
  ----------------------------------------------------------------
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

  ----------------------------------------------------------------
  -- 7️⃣ Enforce comment if required
  ----------------------------------------------------------------
  IF EXISTS (
    SELECT 1
    FROM unblock_reasons
    WHERE code = p_unblock_reason_code
      AND requires_comment = true
  ) AND (p_comment IS NULL OR length(trim(p_comment)) = 0) THEN
    RAISE EXCEPTION
      'Comment is required for unblock reason %',
      p_unblock_reason_code;
  END IF;

  ----------------------------------------------------------------
  -- 8️⃣ Update ticket → IN_PROGRESS
  -- SLA resume handled by trigger trg_resume_sla_on_unblock
  ----------------------------------------------------------------
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

  ----------------------------------------------------------------
  -- 9️⃣ Insert immutable UNBLOCKED event
  ----------------------------------------------------------------
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

  ----------------------------------------------------------------
  -- 🔟 Return updated ticket
  ----------------------------------------------------------------
  SELECT to_jsonb(t.*)
  INTO v_ticket
  FROM tickets t
  WHERE id = p_ticket_id;

  RETURN v_ticket;
END;
$$;
