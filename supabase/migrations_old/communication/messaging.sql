-- ============================================================
-- COMMUNICATION (Messaging)
-- ============================================================

-- ============================================================
-- 1. Schema Fixes (Event Types, Constraints)
-- ============================================================

-- Allow Unblock Reasons (Polymorphic reason_code)
ALTER TABLE ticket_events
DROP CONSTRAINT IF EXISTS ticket_events_reason_code_fkey;

-- Normalize Comment Events (Data Migration)
UPDATE ticket_events
SET event_type = 'COMMENT_ADDED'
WHERE event_type IN ('GUEST_COMMENT', 'STAFF_COMMENT');


-- ============================================================
-- 2. RPC: add_staff_comment
-- Purpose: Allow staff to add comments to tickets
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
  -- 1. Get ticket info
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

  IF v_ticket_status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Cannot comment on cancelled tickets';
  END IF;

  -- 4. Insert COMMENT_ADDED event
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

  -- 5. Touch ticket timestamp
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


-- ============================================================
-- 3. RPC: add_guest_comment
-- Purpose: Allow guests to add comments to their tickets
-- ============================================================
CREATE OR REPLACE FUNCTION add_guest_comment(
  p_ticket_id UUID,
  p_comment TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket_stay_id UUID;
  v_ticket_status TEXT;
BEGIN
  -- 1. Get ticket info
  SELECT
    stay_id,
    status
  INTO
    v_ticket_stay_id,
    v_ticket_status
  FROM tickets
  WHERE id = p_ticket_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found: %', p_ticket_id;
  END IF;

  -- 2. Security: ticket must belong to authenticated guest
  IF NOT EXISTS (
    SELECT 1
    FROM stays
    WHERE id = v_ticket_stay_id
      AND guest_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: ticket does not belong to this guest';
  END IF;

  -- 3. Validation
  IF v_ticket_status NOT IN ('NEW', 'IN_PROGRESS', 'BLOCKED') THEN
    RAISE EXCEPTION 
      'Cannot comment on ticket with status: % (only NEW, IN_PROGRESS, BLOCKED allowed)',
      v_ticket_status;
  END IF;

  IF p_comment IS NULL OR TRIM(p_comment) = '' THEN
    RAISE EXCEPTION 'Comment cannot be empty';
  END IF;

  IF LENGTH(TRIM(p_comment)) > 500 THEN
    RAISE EXCEPTION 'Comment too long (max 500 characters)';
  END IF;

  -- 4. Anti-spam
  IF EXISTS (
    SELECT 1
    FROM ticket_events
    WHERE ticket_id = p_ticket_id
      AND actor_type = 'GUEST'
      AND event_type = 'COMMENT_ADDED'
      AND created_at > NOW() - INTERVAL '10 seconds'
  ) THEN
    RAISE EXCEPTION 'Please wait before sending another message';
  END IF;

  -- 5. Insert COMMENT_ADDED event
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
    'GUEST',
    auth.uid(),
    TRIM(p_comment),
    NOW()
  );

  -- 6. Update ticket updated_at
  UPDATE tickets
  SET updated_at = NOW()
  WHERE id = p_ticket_id;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', p_ticket_id,
    'comment_added', true
  );
END;
$$;
GRANT EXECUTE ON FUNCTION add_guest_comment TO authenticated;
