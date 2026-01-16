-- ============================================================
-- RPC: add_guest_comment
-- Purpose: Allow guests to add comments to their tickets
-- Security: Auth-bound to guest (auth.uid)
-- Impact: No status change, no SLA impact
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
  -- 1. Get ticket info (no lock - comments don't modify workflow)
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

  -- 3. Validation: only allow comments on active tickets
  IF v_ticket_status NOT IN ('NEW', 'IN_PROGRESS', 'BLOCKED') THEN
    RAISE EXCEPTION 
      'Cannot comment on ticket with status: % (only NEW, IN_PROGRESS, BLOCKED allowed)',
      v_ticket_status;
  END IF;

  -- 4. Validation: comment must not be empty
  IF p_comment IS NULL OR TRIM(p_comment) = '' THEN
    RAISE EXCEPTION 'Comment cannot be empty';
  END IF;

  -- 5. Validation: comment length limit (500 chars)
  IF LENGTH(TRIM(p_comment)) > 500 THEN
    RAISE EXCEPTION 'Comment too long (max 500 characters)';
  END IF;

  -- 6. Anti-spam: soft rate-limit (10 second cooldown)
  IF EXISTS (
    SELECT 1
    FROM ticket_events
    WHERE ticket_id = p_ticket_id
      AND actor_type = 'GUEST'
      AND event_type = 'GUEST_COMMENT'
      AND created_at > NOW() - INTERVAL '10 seconds'
  ) THEN
    RAISE EXCEPTION 'Please wait before sending another message';
  END IF;

  -- 7. Insert COMMENT_ADDED event
  -- This does NOT change ticket status or affect SLA
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

  -- 8. Update ticket updated_at (for tracking)
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
