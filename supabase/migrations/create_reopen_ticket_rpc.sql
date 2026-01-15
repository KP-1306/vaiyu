-- ============================================================
-- RPC: reopen_ticket
-- Purpose: Guest reopens a completed ticket (new lifecycle)
-- Security: Auth-bound to guest (auth.uid)
-- SLA: Restarts via normal assignment triggers
-- ============================================================

CREATE OR REPLACE FUNCTION reopen_ticket(
  p_ticket_id UUID,
  p_stay_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status TEXT;
  v_ticket_stay_id UUID;
  v_reopen_count INT;
BEGIN
  -- 1. Lock ticket row (concurrency-safe)
  SELECT
    status,
    stay_id
  INTO
    v_status,
    v_ticket_stay_id
  FROM tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found: %', p_ticket_id;
  END IF;

  -- 2. Security: stay must belong to authenticated guest
  IF NOT EXISTS (
    SELECT 1
    FROM stays
    WHERE id = p_stay_id
      AND guest_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized reopen attempt';
  END IF;

  -- 3. Integrity: ticket must belong to this stay
  IF v_ticket_stay_id != p_stay_id THEN
    RAISE EXCEPTION 'Ticket does not belong to this stay';
  END IF;

  -- 4. Only COMPLETED tickets can be reopened
  IF v_status != 'COMPLETED' THEN
    RAISE EXCEPTION
      'Can only reopen completed tickets (current status: %)',
      v_status;
  END IF;

  -- 5. Abuse protection
  SELECT COUNT(*)
  INTO v_reopen_count
  FROM ticket_events
  WHERE ticket_id = p_ticket_id
    AND event_type = 'REOPENED';

  IF v_reopen_count >= 2 THEN
    RAISE EXCEPTION
      'Ticket has been reopened too many times (max allowed: 2)';
  END IF;

  -- 6. Reset ticket for new execution lifecycle
  UPDATE tickets
  SET
    status = 'NEW',
    current_assignee_id = NULL,
    reason_code = NULL,
    completed_at = NULL,
    updated_at = now()
  WHERE id = p_ticket_id;

  -- 7. Emit REOPENED event (audit-safe)
  INSERT INTO ticket_events (
    ticket_id,
    event_type,
    previous_status,
    new_status,
    actor_type,
    actor_id,
    comment,
    created_at
  ) VALUES (
    p_ticket_id,
    'REOPENED',
    'COMPLETED',
    'NEW',
    'GUEST',
    auth.uid(),
    COALESCE(p_reason, 'Guest reopened completed request'),
    now()
  );

  -- NOTE:
  -- • Auto-assign job will reassign
  -- • SLA will start via ON_ASSIGN trigger
  -- • No SLA fields are manually touched

  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', p_ticket_id,
    'status', 'NEW',
    'reopen_count', v_reopen_count + 1
  );
END;
$$;

GRANT EXECUTE ON FUNCTION reopen_ticket TO authenticated;
