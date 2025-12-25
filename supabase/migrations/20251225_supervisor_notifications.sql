-- ============================================================
-- Supervisor Notification System
-- ============================================================

-- 1. Create Notifications Table
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

CREATE TRIGGER trg_notifications_updated
BEFORE UPDATE ON notifications
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_notifications_user_unread
ON notifications (user_id)
WHERE is_read = false;

-- 2. Trigger Function: Notify Supervisors on Ping
CREATE OR REPLACE FUNCTION trg_notify_supervisors_on_ping()
RETURNS trigger AS $$
DECLARE
  v_hotel_id UUID;
  v_dept_id UUID;
  v_ticket_title TEXT;
BEGIN
  -- Only act on PING_SUPERVISOR events
  IF NEW.event_type <> 'PING_SUPERVISOR' THEN
    RETURN NEW;
  END IF;

  -- Resolve context
  SELECT hotel_id, service_department_id, title
  INTO v_hotel_id, v_dept_id, v_ticket_title
  FROM tickets
  WHERE id = NEW.ticket_id;

  -- Notify all MANAGERS/OWNERS in that department
  INSERT INTO notifications (user_id, type, title, message, metadata)
  SELECT 
    hm.user_id,
    'TICKET_ALERT',
    'Supervisor Ping',
    CONCAT('Staff member requested assistance for ticket: ', v_ticket_title),
    jsonb_build_object(
      'ticket_id', NEW.ticket_id,
      'event_id', NEW.id,
      'comment', NEW.comment
    )
  FROM hotel_members hm
  WHERE hm.hotel_id = v_hotel_id
    AND hm.department_id = v_dept_id
    AND hm.role IN ('MANAGER', 'OWNER')
    AND hm.is_active = true;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Attach Trigger to ticket_events
DROP TRIGGER IF EXISTS notify_supervisors_on_ping ON ticket_events;
CREATE TRIGGER notify_supervisors_on_ping
AFTER INSERT ON ticket_events
FOR EACH ROW
EXECUTE FUNCTION trg_notify_supervisors_on_ping();
