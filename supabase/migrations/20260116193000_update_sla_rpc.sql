-- Drop the old signature to avoid ambiguity
DROP FUNCTION IF EXISTS request_sla_exception(UUID, TEXT);

-- Create new signature with reason code
CREATE OR REPLACE FUNCTION request_sla_exception(
  p_ticket_id UUID,
  p_reason_code TEXT,
  p_comment TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket RECORD;
  v_staff_id UUID;
BEGIN
  -- Lock ticket to avoid duplicate requests
  SELECT *
  INTO v_ticket
  FROM tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  -- 1. Validate Ticket State
  -- Reject terminal tickets
  IF v_ticket.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Cannot request SLA exception on terminal ticket';
  END IF;

  -- Only allowed when work is active
  IF v_ticket.status NOT IN ('IN_PROGRESS', 'BLOCKED') THEN
    RAISE EXCEPTION
      'SLA exception can only be requested when ticket is IN_PROGRESS or BLOCKED';
  END IF;

  -- 2. Validate Staff
  SELECT id
  INTO v_staff_id
  FROM hotel_members
  WHERE user_id = auth.uid()
    AND hotel_id = v_ticket.hotel_id
    AND is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized staff';
  END IF;

  -- 3. Validate Reason Code
  IF NOT EXISTS (
    SELECT 1
    FROM sla_exception_reasons
    WHERE code = p_reason_code
      AND is_active = TRUE
      AND allowed_for_staff = TRUE
  ) THEN
    RAISE EXCEPTION 'Invalid SLA exception reason';
  END IF;

  -- 4. Prevent Duplicate Requests
  IF EXISTS (
    SELECT 1
    FROM ticket_events te
    WHERE te.ticket_id = p_ticket_id
      AND te.event_type = 'SLA_EXCEPTION_REQUESTED'
      AND NOT EXISTS (
        SELECT 1
        FROM ticket_events te2
        WHERE te2.ticket_id = p_ticket_id
          AND te2.event_type IN (
            'SLA_EXCEPTION_GRANTED',
            'SLA_EXCEPTION_REJECTED'
          )
          AND te2.created_at > te.created_at
      )
  ) THEN
    RAISE EXCEPTION 'SLA exception already requested and pending';
  END IF;

  -- 5. Validate Comment (Dynamic based on reason)
  IF EXISTS (
    SELECT 1
    FROM sla_exception_reasons
    WHERE code = p_reason_code
      AND requires_comment = TRUE
  )
  AND (p_comment IS NULL OR TRIM(p_comment) = '') THEN
    RAISE EXCEPTION 'Comment required for this SLA exception reason';
  END IF;

  -- 6. Insert Event
  INSERT INTO ticket_events (
    ticket_id,
    event_type,
    actor_type,
    actor_id,
    comment,
    reason_code,
    created_at
  ) VALUES (
    p_ticket_id,
    'SLA_EXCEPTION_REQUESTED',
    'STAFF',
    v_staff_id,
    TRIM(p_comment),
    p_reason_code,
    NOW()
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'ticket_id', p_ticket_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION request_sla_exception TO authenticated;

-- Index for duplicate-check performance
CREATE INDEX IF NOT EXISTS idx_ticket_events_sla_exception_requests
ON ticket_events (ticket_id, event_type, created_at)
WHERE event_type = 'SLA_EXCEPTION_REQUESTED';
