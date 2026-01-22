-- ============================================================
-- SLA ENGINE (Triggers, Jobs, RPCs)
-- ============================================================

-- 0. Dependencies
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ============================================================
-- 1. SLA Logic Functions (Start, Pause, Resume)
-- ============================================================

-- A. START SLA
CREATE OR REPLACE FUNCTION trg_start_sla_on_assign()
RETURNS trigger AS $$
DECLARE
  v_start_policy TEXT;
  v_target_minutes INT;
BEGIN
  IF NEW.status IN ('COMPLETED', 'CANCELLED') THEN
    RETURN NEW;
  END IF;

  SELECT sla_start_trigger, target_minutes
  INTO v_start_policy, v_target_minutes
  FROM sla_policies
  WHERE department_id = NEW.service_department_id
    AND is_active = true;

  IF v_start_policy = 'ON_ASSIGN'
     AND NEW.current_assignee_id IS NOT NULL
     AND OLD.current_assignee_id IS NULL THEN

    INSERT INTO ticket_sla_state (ticket_id)
    VALUES (NEW.id)
    ON CONFLICT (ticket_id) DO NOTHING;

    UPDATE ticket_sla_state
    SET
      sla_started_at = clock_timestamp(),
      sla_resumed_at = clock_timestamp(),
      current_remaining_seconds = (v_target_minutes * 60)
    WHERE ticket_id = NEW.id
      AND sla_started_at IS NULL; 
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- B. PAUSE SLA
CREATE OR REPLACE FUNCTION trg_pause_sla_on_block()
RETURNS trigger AS $$
DECLARE
  v_pauses BOOLEAN;
BEGIN
  SELECT pauses_sla INTO v_pauses
  FROM block_reasons WHERE code = NEW.reason_code;

  IF v_pauses = true AND NEW.status = 'BLOCKED' THEN
    UPDATE ticket_sla_state
    SET 
      sla_paused_at = clock_timestamp(),
      pause_count = COALESCE(pause_count, 0) + 1
    WHERE ticket_id = NEW.id
      AND sla_paused_at IS NULL
      AND sla_started_at IS NOT NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- C. RESUME SLA
CREATE OR REPLACE FUNCTION trg_resume_sla_on_unblock()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'BLOCKED' AND NEW.status = 'IN_PROGRESS' THEN
    UPDATE ticket_sla_state
    SET
      total_paused_seconds = 
        COALESCE(total_paused_seconds, 0) + 
        EXTRACT(EPOCH FROM (clock_timestamp() - COALESCE(sla_paused_at, clock_timestamp())))::INT,
      sla_paused_at = NULL,
      sla_resumed_at = clock_timestamp()
    WHERE ticket_id = NEW.id
      AND sla_paused_at IS NOT NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- D. ATTACH TRIGGERS
DROP TRIGGER IF EXISTS start_sla_on_assign ON tickets;
DROP TRIGGER IF EXISTS pause_sla_on_block ON tickets;
DROP TRIGGER IF EXISTS resume_sla_on_unblock ON tickets;

CREATE TRIGGER start_sla_on_assign
AFTER UPDATE OF current_assignee_id ON tickets
FOR EACH ROW
EXECUTE FUNCTION trg_start_sla_on_assign();

CREATE TRIGGER pause_sla_on_block
AFTER UPDATE OF status ON tickets
FOR EACH ROW
WHEN (NEW.status = 'BLOCKED' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION trg_pause_sla_on_block();

CREATE TRIGGER resume_sla_on_unblock
AFTER UPDATE OF status ON tickets
FOR EACH ROW
WHEN (OLD.status = 'BLOCKED' AND NEW.status = 'IN_PROGRESS')
EXECUTE FUNCTION trg_resume_sla_on_unblock();


-- ============================================================
-- 2. Auto-Assign Job
-- ============================================================

CREATE OR REPLACE FUNCTION auto_assign_next_ticket()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket RECORD;
  v_staff_id UUID;
  v_max_load INT := 20;
BEGIN
  FOR v_ticket IN
    SELECT
      t.id,
      t.hotel_id,
      t.service_department_id,
      t.zone_id,
      t.priority
    FROM tickets t
    LEFT JOIN ticket_sla_state ss
      ON ss.ticket_id = t.id
    WHERE
      t.status = 'NEW'
      AND t.current_assignee_id IS NULL
    ORDER BY
      CASE
        WHEN ss.current_remaining_seconds IS NOT NULL
             AND ss.current_remaining_seconds <= 300 THEN 0
        ELSE 1
      END,
      CASE t.priority
        WHEN 'URGENT' THEN 0
        WHEN 'HIGH' THEN 1
        WHEN 'NORMAL' THEN 2
        WHEN 'LOW' THEN 3
        ELSE 4
      END,
      t.created_at ASC
    LIMIT 20
    FOR UPDATE OF t SKIP LOCKED
  LOOP
    SELECT hm.id
    INTO v_staff_id
    FROM hotel_members hm
    JOIN hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
    JOIN hotel_roles hr ON hr.id = hmr.role_id AND hr.code = 'STAFF'
    JOIN staff_shifts ss
      ON ss.staff_id = hm.id
     AND ss.is_active = true
     AND now() BETWEEN ss.shift_start AND ss.shift_end
    JOIN staff_departments sd
      ON sd.staff_id = hm.id
     AND sd.department_id = v_ticket.service_department_id
    LEFT JOIN staff_zone_assignments sz
      ON sz.staff_id = hm.id
     AND sz.zone_id = v_ticket.zone_id
     AND sz.effective_to IS NULL
    LEFT JOIN tickets t_load
      ON t_load.current_assignee_id = hm.id
     AND t_load.status IN ('NEW','IN_PROGRESS','BLOCKED')
    WHERE
      hm.hotel_id = v_ticket.hotel_id
      AND hm.is_active = true
      AND hm.is_verified = true
    GROUP BY hm.id, sz.id
    HAVING COUNT(t_load.id) < v_max_load
    ORDER BY
      CASE 
        WHEN v_ticket.zone_id IS NOT NULL AND sz.id IS NULL THEN 1 
        ELSE 0 
      END ASC,
      COUNT(t_load.id) ASC,
      hm.last_assigned_at NULLS FIRST,
      hm.created_at ASC
    LIMIT 1;

    IF v_staff_id IS NOT NULL THEN
      UPDATE tickets
      SET
        current_assignee_id = v_staff_id,
        updated_at = clock_timestamp()
      WHERE id = v_ticket.id;

      INSERT INTO ticket_events (
        ticket_id, event_type, actor_type, actor_id, comment
      )
      VALUES (
        v_ticket.id, 'ASSIGNED', 'SYSTEM', v_staff_id, 'Auto-assigned by scheduler'
      );

      UPDATE hotel_members
      SET last_assigned_at = clock_timestamp()
      WHERE id = v_staff_id;
    END IF;
  END LOOP;
END;
$$;

SELECT cron.schedule('auto-assign-next-ticket', '* * * * *', 'SELECT public.auto_assign_next_ticket()');


-- ============================================================
-- 3. Breach Detection Job (Logic)
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_ticket_sla_statuses()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only update breaches for tickets without SLA exception that are NOT completed/cancelled
  UPDATE ticket_sla_state ss
  SET
    breached = true,
    breached_at = COALESCE(breached_at, clock_timestamp())
  FROM tickets t
  JOIN sla_policies sp
    ON sp.department_id = t.service_department_id
  WHERE ss.ticket_id = t.id
    AND t.status NOT IN ('COMPLETED', 'CANCELLED')
    AND ss.breached = false
    AND ss.sla_started_at IS NOT NULL
    AND ss.sla_paused_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM ticket_events te
      WHERE te.ticket_id = t.id
        AND te.event_type = 'SLA_EXCEPTION_GRANTED'
    )
    AND (
      (sp.target_minutes * 60)
      - (
          EXTRACT(EPOCH FROM (clock_timestamp() - ss.sla_started_at))::INT
          - COALESCE(ss.total_paused_seconds, 0)
      )
    ) <= 0;
END;
$$;


-- ============================================================
-- 3a. Finalize SLA Trigger
-- Use this to perform one final check when ticket is COMPLETED/CANCELLED
-- ============================================================

CREATE OR REPLACE FUNCTION trg_finalize_sla_on_completion()
RETURNS trigger AS $$
DECLARE
  v_started_at TIMESTAMPTZ;
  v_total_paused INT;
  v_is_breached BOOLEAN;
  v_target_minutes INT;
  v_elapsed INT;
BEGIN
  -- 1. Guard: Only run on transition to terminal status (Defensive)
  IF NOT (
    OLD.status IS DISTINCT FROM NEW.status
    AND NEW.status IN ('COMPLETED', 'CANCELLED')
  ) THEN
    RETURN NEW;
  END IF;

  -- 2. Policy: CANCELLED tickets do not count toward SLA
  IF NEW.status = 'CANCELLED' THEN
    RETURN NEW;
  END IF;

  -- 3. Get SLA state
  SELECT 
    ss.sla_started_at, 
    ss.total_paused_seconds, 
    ss.breached,
    sp.target_minutes
  INTO 
    v_started_at, 
    v_total_paused, 
    v_is_breached,
    v_target_minutes
  FROM ticket_sla_state ss
  JOIN tickets t ON t.id = ss.ticket_id
  JOIN sla_policies sp ON sp.department_id = t.service_department_id
  WHERE ss.ticket_id = NEW.id;

  -- 4. If SLA never started or already flagged, skip
  IF v_started_at IS NULL OR v_is_breached THEN
    RETURN NEW;
  END IF;

  -- 5. Check for exception granted
  IF EXISTS (SELECT 1 FROM ticket_events WHERE ticket_id = NEW.id AND event_type = 'SLA_EXCEPTION_GRANTED') THEN
    RETURN NEW;
  END IF;

  -- 6. Calculate final elapsed time at moment of closure
  v_elapsed := EXTRACT(EPOCH FROM (clock_timestamp() - v_started_at))::INT - COALESCE(v_total_paused, 0);

  -- 7. Mark breached if over limit
  IF v_elapsed > (v_target_minutes * 60) THEN
    UPDATE ticket_sla_state
    SET 
      breached = true,
      breached_at = clock_timestamp()
    WHERE ticket_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS finalize_sla_on_completion ON tickets;

CREATE TRIGGER finalize_sla_on_completion
AFTER UPDATE OF status ON tickets
FOR EACH ROW
WHEN (NEW.status IN ('COMPLETED', 'CANCELLED') AND OLD.status NOT IN ('COMPLETED', 'CANCELLED'))
EXECUTE FUNCTION trg_finalize_sla_on_completion();


-- ============================================================
-- 4. RPC: request_sla_exception
-- ============================================================

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
  SELECT * INTO v_ticket FROM tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found'; END IF;

  IF v_ticket.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Cannot request SLA exception on terminal ticket';
  END IF;

  IF v_ticket.status NOT IN ('IN_PROGRESS', 'BLOCKED') THEN
    RAISE EXCEPTION 'SLA exception can only be requested when ticket is IN_PROGRESS or BLOCKED';
  END IF;

  SELECT id INTO v_staff_id FROM hotel_members
  WHERE user_id = auth.uid() AND hotel_id = v_ticket.hotel_id AND is_active = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unauthorized staff'; END IF;

  IF NOT EXISTS (SELECT 1 FROM sla_exception_reasons WHERE code = p_reason_code AND is_active = TRUE AND allowed_for_staff = TRUE) THEN
    RAISE EXCEPTION 'Invalid SLA exception reason';
  END IF;

  IF EXISTS (
    SELECT 1 FROM ticket_events te
    WHERE te.ticket_id = p_ticket_id AND te.event_type = 'SLA_EXCEPTION_REQUESTED'
      AND NOT EXISTS (
        SELECT 1 FROM ticket_events te2
        WHERE te2.ticket_id = p_ticket_id AND te2.event_type IN ('SLA_EXCEPTION_GRANTED', 'SLA_EXCEPTION_REJECTED') AND te2.created_at > te.created_at
      )
  ) THEN
    RAISE EXCEPTION 'SLA exception already requested and pending';
  END IF;

  IF EXISTS (SELECT 1 FROM sla_exception_reasons WHERE code = p_reason_code AND requires_comment = TRUE) AND (p_comment IS NULL OR TRIM(p_comment) = '') THEN
    RAISE EXCEPTION 'Comment required for this SLA exception reason';
  END IF;

  INSERT INTO ticket_events (
    ticket_id, event_type, actor_type, actor_id, comment, reason_code, created_at
  ) VALUES (
    p_ticket_id, 'SLA_EXCEPTION_REQUESTED', 'STAFF', v_staff_id, TRIM(p_comment), p_reason_code, NOW()
  );

  RETURN jsonb_build_object('success', TRUE, 'ticket_id', p_ticket_id);
END;
$$;
GRANT EXECUTE ON FUNCTION request_sla_exception TO authenticated;
