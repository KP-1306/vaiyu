-- ============================================================
-- SUPERVISOR LOGIC (RPCs, Notifications)
-- ============================================================

-- ============================================================
-- 1. Notifications Infrastructure
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  
  metadata JSONB DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT false,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notifications_updated ON notifications;
CREATE TRIGGER trg_notifications_updated
BEFORE UPDATE ON notifications
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
ON notifications (user_id)
WHERE is_read = false;

-- Trigger: Notify Supervisors on Request
CREATE OR REPLACE FUNCTION trg_notify_supervisors_on_request()
RETURNS trigger AS $$
DECLARE
  v_hotel_id UUID;
  v_dept_id UUID;
  v_ticket_title TEXT;
BEGIN
  -- Listen for explicit supervisor requests
  IF NEW.event_type NOT IN ('SUPERVISOR_REQUESTED', 'SLA_EXCEPTION_REQUESTED') THEN
    RETURN NEW;
  END IF;

  -- Resolve context
  SELECT hotel_id, service_department_id, title
  INTO v_hotel_id, v_dept_id, v_ticket_title
  FROM tickets
  WHERE id = NEW.ticket_id;

  -- Notify all SUPERVISORS/MANAGERS/OWNERS
  INSERT INTO notifications (user_id, type, title, message, metadata)
  SELECT 
    hm.user_id,
    'TICKET_ALERT',
    CASE 
      WHEN NEW.event_type = 'SLA_EXCEPTION_REQUESTED' THEN 'SLA Exception Requested'
      ELSE 'Supervisor Assistance Requested'
    END,
    CONCAT('Staff requested assistance: ', v_ticket_title),
    jsonb_build_object(
      'ticket_id', NEW.ticket_id,
      'event_id', NEW.id,
      'comment', NEW.comment
    )
  FROM hotel_members hm
  JOIN hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
  JOIN hotel_roles hr ON hr.id = hmr.role_id
  WHERE hm.hotel_id = v_hotel_id
    AND hr.code IN ('SUPERVISOR', 'MANAGER', 'OWNER')
    AND hm.is_active = true;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notify_supervisors_on_request ON ticket_events;
CREATE TRIGGER notify_supervisors_on_request
AFTER INSERT ON ticket_events
FOR EACH ROW
EXECUTE FUNCTION trg_notify_supervisors_on_request();


-- ============================================================
-- 2. RPC: request_supervisor
-- Staff requests supervisor attention
-- ============================================================
CREATE OR REPLACE FUNCTION request_supervisor(
  p_ticket_id UUID,
  p_reason TEXT,
  p_comment TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket RECORD;
  v_staff_id UUID;
BEGIN
  SELECT * INTO v_ticket FROM tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found'; END IF;

  IF v_ticket.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Cannot request supervisor for terminal ticket';
  END IF;

  SELECT id INTO v_staff_id FROM hotel_members
  WHERE user_id = auth.uid() AND hotel_id = v_ticket.hotel_id AND is_active = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unauthorized staff'; END IF;

  -- Check for existing pending request
  IF EXISTS (
    SELECT 1 FROM ticket_events te
    WHERE te.ticket_id = p_ticket_id AND te.event_type = 'SUPERVISOR_REQUESTED'
      AND NOT EXISTS (
        SELECT 1 FROM ticket_events res
        WHERE res.ticket_id = p_ticket_id AND res.created_at > te.created_at
          AND res.event_type IN ('SUPERVISOR_APPROVED', 'SUPERVISOR_REJECTED', 'SUPERVISOR_REQUEST_CANCELLED')
      )
  ) THEN
    RAISE EXCEPTION 'Supervisor request already pending';
  END IF;

  INSERT INTO ticket_events (
    ticket_id, event_type, actor_type, actor_id, comment, reason_code, created_at
  ) VALUES (
    p_ticket_id, 'SUPERVISOR_REQUESTED', 'STAFF', v_staff_id, TRIM(p_comment), p_reason, NOW()
  );

  RETURN jsonb_build_object('success', TRUE, 'ticket_id', p_ticket_id);
END;
$$;
GRANT EXECUTE ON FUNCTION request_supervisor TO authenticated;


-- ============================================================
-- 3. RPC: cancel_supervisor_request
-- Staff cancels their own request
-- ============================================================
CREATE OR REPLACE FUNCTION cancel_supervisor_request(
  p_ticket_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_staff_id UUID;
  v_current_status TEXT;
  v_latest_supervisor_event RECORD;
BEGIN
  SELECT id INTO v_staff_id FROM hotel_members WHERE user_id = auth.uid() AND is_active = true LIMIT 1;
  IF v_staff_id IS NULL THEN RAISE EXCEPTION 'Active staff profile required'; END IF;

  SELECT status INTO v_current_status FROM tickets WHERE id = p_ticket_id;
  IF v_current_status IN ('COMPLETED', 'CANCELLED') THEN RAISE EXCEPTION 'Ticket is terminal'; END IF;

  SELECT * INTO v_latest_supervisor_event
  FROM ticket_events
  WHERE ticket_id = p_ticket_id
    AND event_type IN ('SUPERVISOR_REQUESTED', 'SLA_EXCEPTION_REQUESTED')
  ORDER BY created_at DESC LIMIT 1;

  IF v_latest_supervisor_event IS NULL THEN RAISE EXCEPTION 'No request to cancel'; END IF;

  PERFORM 1 FROM ticket_events
  WHERE ticket_id = p_ticket_id AND created_at > v_latest_supervisor_event.created_at
    AND event_type IN ('SUPERVISOR_APPROVED', 'SUPERVISOR_REJECTED', 'SUPERVISOR_REQUEST_CANCELLED', 'SLA_EXCEPTION_GRANTED', 'SLA_EXCEPTION_REJECTED');
  IF FOUND THEN RAISE EXCEPTION 'Request already resolved'; END IF;

  INSERT INTO ticket_events (
    ticket_id, event_type, actor_type, actor_id, comment, previous_status, new_status
  ) VALUES (
    p_ticket_id, 'SUPERVISOR_REQUEST_CANCELLED', 'STAFF', v_staff_id, COALESCE(p_reason, 'Cancelled by staff'), v_current_status, v_current_status
  );
END;
$$;
GRANT EXECUTE ON FUNCTION cancel_supervisor_request TO authenticated;


-- ============================================================
-- 4. RPC: reject_supervisor_approval (for BLOCKED tickets)
-- ============================================================
CREATE OR REPLACE FUNCTION reject_supervisor_approval(
  p_ticket_id UUID,
  p_comment TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket_status TEXT;
  v_supervisor_id UUID;
  v_hotel_id UUID;
  v_latest_block RECORD;
BEGIN
  SELECT status, hotel_id INTO v_ticket_status, v_hotel_id FROM tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found'; END IF;

  IF v_ticket_status <> 'BLOCKED' THEN RAISE EXCEPTION 'Ticket not BLOCKED'; END IF;

  SELECT hm.id INTO v_supervisor_id
  FROM hotel_members hm
  JOIN hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
  JOIN hotel_roles hr ON hr.id = hmr.role_id
  WHERE hm.user_id = auth.uid() AND hm.hotel_id = v_hotel_id AND hm.is_active = TRUE AND hr.code = 'SUPERVISOR' AND hr.is_active = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unauthorized supervisor'; END IF;

  SELECT created_at, reason_code INTO v_latest_block FROM ticket_events
  WHERE ticket_id = p_ticket_id AND event_type = 'BLOCKED' ORDER BY created_at DESC LIMIT 1;

  IF v_latest_block.reason_code IS DISTINCT FROM 'supervisor_approval' THEN
    RAISE EXCEPTION 'Latest block reason is not supervisor_approval';
  END IF;

  IF EXISTS (
    SELECT 1 FROM ticket_events
    WHERE ticket_id = p_ticket_id AND event_type IN ('SUPERVISOR_APPROVED', 'SUPERVISOR_REJECTED')
      AND created_at > v_latest_block.created_at
  ) THEN
    RETURN jsonb_build_object('success', TRUE, 'decision', 'REJECTED', 'idempotent', TRUE);
  END IF;

  INSERT INTO ticket_events (
    ticket_id, event_type, reason_code, comment, actor_type, actor_id, created_at
  ) VALUES (
    p_ticket_id, 'SUPERVISOR_REJECTED', 'supervisor_approval', COALESCE(p_comment, 'Rejected'), 'STAFF', v_supervisor_id, NOW()
  );

  RETURN jsonb_build_object('success', TRUE, 'decision', 'REJECTED', 'idempotent', FALSE);
END;
$$;
GRANT EXECUTE ON FUNCTION reject_supervisor_approval TO authenticated;


-- ============================================================
-- 5. RPC: grant_sla_exception
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
  v_req_time TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_ticket FROM tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found'; END IF;
  IF v_ticket.status IN ('COMPLETED', 'CANCELLED') THEN RAISE EXCEPTION 'Ticket terminal'; END IF;

  SELECT hm.id INTO v_supervisor_id
  FROM hotel_members hm
  JOIN hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
  JOIN hotel_roles hr ON hr.id = hmr.role_id
  WHERE hm.user_id = auth.uid() AND hm.hotel_id = v_ticket.hotel_id AND hm.is_active = TRUE AND hr.code = 'SUPERVISOR' AND hr.is_active = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unauthorized supervisor'; END IF;

  SELECT created_at INTO v_req_time FROM ticket_events WHERE ticket_id = p_ticket_id AND event_type = 'SLA_EXCEPTION_REQUESTED'
  AND NOT EXISTS (SELECT 1 FROM ticket_events r WHERE r.ticket_id = p_ticket_id AND r.created_at > ticket_events.created_at AND r.event_type IN ('SLA_EXCEPTION_GRANTED', 'SLA_EXCEPTION_REJECTED'))
  ORDER BY created_at DESC LIMIT 1;
  IF v_req_time IS NULL THEN RAISE EXCEPTION 'No pending request'; END IF;

  IF EXISTS (SELECT 1 FROM ticket_events WHERE ticket_id = p_ticket_id AND event_type IN ('SLA_EXCEPTION_GRANTED', 'SLA_EXCEPTION_REJECTED') AND created_at > v_req_time) THEN
    RETURN jsonb_build_object('success', TRUE, 'sla_exception', 'GRANTED', 'idempotent', TRUE);
  END IF;

  IF p_comment IS NULL OR TRIM(p_comment) = '' THEN RAISE EXCEPTION 'Comment required'; END IF;

  INSERT INTO ticket_events (
    ticket_id, event_type, reason_code, actor_type, actor_id, comment, created_at
  ) VALUES (
    p_ticket_id, 'SLA_EXCEPTION_GRANTED', 'sla_exception', 'STAFF', v_supervisor_id, TRIM(p_comment), NOW()
  );

  RETURN jsonb_build_object('success', TRUE, 'sla_exception', 'GRANTED', 'idempotent', FALSE);
END;
$$;
GRANT EXECUTE ON FUNCTION grant_sla_exception TO authenticated;


-- ============================================================
-- 6. RPC: reject_sla_exception
-- ============================================================
CREATE OR REPLACE FUNCTION reject_sla_exception(
  p_ticket_id UUID,
  p_comment TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket RECORD;
  v_supervisor_id UUID;
  v_req_time TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_ticket FROM tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found'; END IF;
  IF v_ticket.status IN ('COMPLETED', 'CANCELLED') THEN RAISE EXCEPTION 'Ticket terminal'; END IF;

  SELECT hm.id INTO v_supervisor_id
  FROM hotel_members hm
  JOIN hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
  JOIN hotel_roles hr ON hr.id = hmr.role_id
  WHERE hm.user_id = auth.uid() AND hm.hotel_id = v_ticket.hotel_id AND hm.is_active = TRUE AND hr.code = 'SUPERVISOR' AND hr.is_active = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unauthorized supervisor'; END IF;

  SELECT created_at INTO v_req_time FROM ticket_events WHERE ticket_id = p_ticket_id AND event_type = 'SLA_EXCEPTION_REQUESTED'
  AND NOT EXISTS (SELECT 1 FROM ticket_events r WHERE r.ticket_id = p_ticket_id AND r.created_at > ticket_events.created_at AND r.event_type IN ('SLA_EXCEPTION_GRANTED', 'SLA_EXCEPTION_REJECTED'))
  ORDER BY created_at DESC LIMIT 1;
  IF v_req_time IS NULL THEN RAISE EXCEPTION 'No pending request'; END IF;

  IF EXISTS (SELECT 1 FROM ticket_events WHERE ticket_id = p_ticket_id AND event_type IN ('SLA_EXCEPTION_GRANTED', 'SLA_EXCEPTION_REJECTED') AND created_at > v_req_time) THEN
    RETURN jsonb_build_object('success', TRUE, 'sla_exception', 'REJECTED', 'idempotent', TRUE);
  END IF;

  IF p_comment IS NULL OR TRIM(p_comment) = '' THEN RAISE EXCEPTION 'Comment required'; END IF;

  INSERT INTO ticket_events (
    ticket_id, event_type, reason_code, actor_type, actor_id, comment, created_at
  ) VALUES (
    p_ticket_id, 'SLA_EXCEPTION_REJECTED', 'sla_exception', 'STAFF', v_supervisor_id, TRIM(p_comment), NOW()
  );

  RETURN jsonb_build_object('success', TRUE, 'sla_exception', 'REJECTED', 'idempotent', FALSE);
END;
$$;
GRANT EXECUTE ON FUNCTION reject_sla_exception TO authenticated;
