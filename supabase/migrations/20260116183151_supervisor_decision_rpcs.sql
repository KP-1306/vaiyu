-- ============================================================
-- RPC: reject_supervisor_request
-- Actor: Supervisor
-- Purpose: Reject a supervisor-requested decision
-- Impact:
--   - No ticket state change
--   - Emits SUPERVISOR_REJECTED event
-- ============================================================

CREATE OR REPLACE FUNCTION reject_supervisor_request(
  p_ticket_id UUID,
  p_comment TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket RECORD;
  v_supervisor_id UUID;
BEGIN
  -- Lock ticket
  SELECT *
  INTO v_ticket
  FROM tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  -- Reject terminal tickets
  IF v_ticket.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Cannot reject request on terminal ticket';
  END IF;

  -- Supervisor validation
  SELECT hm.id
  INTO v_supervisor_id
  FROM hotel_members hm
  JOIN hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
  JOIN hotel_roles hr ON hr.id = hmr.hotel_role_id
  WHERE hm.user_id = auth.uid()
    AND hm.hotel_id = v_ticket.hotel_id
    AND hm.is_active = TRUE
    AND hr.code = 'SUPERVISOR'
    AND hr.is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized supervisor';
  END IF;

  -- Comment is mandatory
  IF p_comment IS NULL OR TRIM(p_comment) = '' THEN
    RAISE EXCEPTION 'Rejection comment is required';
  END IF;

  -- Emit rejection event
  INSERT INTO ticket_events (
    ticket_id,
    event_type,
    actor_type,
    actor_id,
    comment,
    created_at
  ) VALUES (
    p_ticket_id,
    'SUPERVISOR_REJECTED',
    'SUPERVISOR',
    v_supervisor_id,
    TRIM(p_comment),
    NOW()
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'ticket_id', p_ticket_id,
    'decision', 'REJECTED'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION reject_supervisor_request TO authenticated;


-- ============================================================
-- RPC: grant_sla_exception
-- Actor: Supervisor
-- Purpose: Grant SLA exception to a ticket
-- Impact:
--   - SLA permanently exempted
--   - Emits SLA_EXCEPTION_GRANTED event
-- ============================================================

CREATE OR REPLACE FUNCTION grant_sla_exception(
  p_ticket_id UUID,
  p_comment TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket RECORD;
  v_supervisor_id UUID;
BEGIN
  -- Lock ticket
  SELECT *
  INTO v_ticket
  FROM tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  -- Reject terminal tickets
  IF v_ticket.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Cannot grant SLA exception on terminal ticket';
  END IF;

  -- Supervisor validation
  SELECT hm.id
  INTO v_supervisor_id
  FROM hotel_members hm
  JOIN hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
  JOIN hotel_roles hr ON hr.id = hmr.hotel_role_id
  WHERE hm.user_id = auth.uid()
    AND hm.hotel_id = v_ticket.hotel_id
    AND hm.is_active = TRUE
    AND hr.code = 'SUPERVISOR'
    AND hr.is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized supervisor';
  END IF;

  -- Comment is mandatory (audit requirement)
  IF p_comment IS NULL OR TRIM(p_comment) = '' THEN
    RAISE EXCEPTION 'Comment required for SLA exception';
  END IF;

  -- Emit SLA exception granted event
  INSERT INTO ticket_events (
    ticket_id,
    event_type,
    actor_type,
    actor_id,
    comment,
    created_at
  ) VALUES (
    p_ticket_id,
    'SLA_EXCEPTION_GRANTED',
    'SUPERVISOR',
    v_supervisor_id,
    TRIM(p_comment),
    NOW()
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'ticket_id', p_ticket_id,
    'sla_exception', 'GRANTED'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION grant_sla_exception TO authenticated;
