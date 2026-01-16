-- ============================================================
-- RPC: add_staff_comment
-- Purpose: Allow staff to add comments to tickets
-- Security: Auth-bound to staff (auth.uid), hotel-scoped
-- Impact: No status change, no SLA impact
-- ============================================================

CREATE OR REPLACE FUNCTION add_staff_comment(
  p_ticket_id UUID,
  p_comment TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_staff_member_id UUID;
  v_ticket_hotel_id UUID;
  v_ticket_status TEXT;
  v_comment_id UUID;
BEGIN
  -- 1. Get ticket info (no lock - comments don't modify workflow)
  SELECT hotel_id, status
  INTO v_ticket_hotel_id, v_ticket_status
  FROM tickets
  WHERE id = p_ticket_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  -- 2. Verify staff belongs to this hotel
  SELECT id
  INTO v_staff_member_id
  FROM hotel_members
  WHERE user_id = auth.uid()
    AND hotel_id = v_ticket_hotel_id
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized: staff not in this hotel';
  END IF;

  -- 3. Validate comment
  IF TRIM(p_comment) = '' THEN
    RAISE EXCEPTION 'Comment cannot be empty';
  END IF;

  IF LENGTH(TRIM(p_comment)) > 1000 THEN
    RAISE EXCEPTION 'Comment too long (max 1000 chars)';
  END IF;

  -- 4. Validate ticket status
  -- Allow comments on all tickets except CANCELLED
  -- (comments are passive and do not affect SLA or workflow)
  IF v_ticket_status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Cannot comment on cancelled tickets';
  END IF;

  -- 5. Insert COMMENT_ADDED event
  -- actor_id = hotel_members.id (domain actor, not auth.uid)
  INSERT INTO ticket_events (
    ticket_id,
    event_type,
    actor_type,
    actor_id,
    comment,
    created_at
  ) VALUES (
    p_ticket_id,
    'COMMENT_ADDED',
    'STAFF',
    v_staff_member_id,
    TRIM(p_comment),
    NOW()
  )
  RETURNING id INTO v_comment_id;

  -- 6. Touch ticket timestamp
  UPDATE tickets
  SET updated_at = NOW()
  WHERE id = p_ticket_id;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', p_ticket_id,
    'comment_id', v_comment_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION add_staff_comment TO authenticated;
