-- ============================================================
-- RPC: block_task
-- Purpose:
--   Staff blocks an IN_PROGRESS task with a reason
--   SLA pause handled by trigger (policy-aware)
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
      'Only IN_PROGRESS tasks can be blocked (current status: %)',
      v_status;
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
    RAISE EXCEPTION 'Only the assigned staff can block this task';
  END IF;

  ----------------------------------------------------------------
  -- 5️⃣ Validate block reason
  ----------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1
    FROM block_reasons
    WHERE code = p_reason_code
  ) THEN
    RAISE EXCEPTION 'Invalid block reason: %', p_reason_code;
  END IF;

  ----------------------------------------------------------------
  -- 6️⃣ Update ticket → BLOCKED
  -- SLA pause handled by trigger trg_pause_sla_on_block
  ----------------------------------------------------------------
  UPDATE tickets
  SET
    status = 'BLOCKED',
    reason_code = p_reason_code, -- <== CRITICAL FIX: Trigger needs this!
    updated_at = now()
  WHERE id = p_ticket_id
    AND status = 'IN_PROGRESS';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task was modified concurrently';
  END IF;

  ----------------------------------------------------------------
  -- 7️⃣ Insert immutable BLOCKED event
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
    'IN_PROGRESS',
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
