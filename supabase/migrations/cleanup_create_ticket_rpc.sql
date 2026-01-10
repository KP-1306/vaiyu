-- ============================================================
-- Fix: Cleanup create_service_request RPC
-- Purpose: Remove legacy auto-assignment logic.
--          Ticket assignment is now handled EXCLUSIVELY
--          by the 'auto_assign_next_ticket' cron job.
-- ============================================================

CREATE OR REPLACE FUNCTION create_service_request(
  p_hotel_id UUID,
  p_department_id UUID,
  p_room_id UUID,
  p_zone_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_created_by_type TEXT,
  p_created_by_id UUID  -- hotel_members.id for STAFF / FRONT_DESK, NULL for GUEST / SYSTEM
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket_id UUID;
BEGIN
  ----------------------------------------------------------------
  -- 0️⃣ Input validation
  ----------------------------------------------------------------

  -- Enforce location XOR rule
  IF (p_room_id IS NULL AND p_zone_id IS NULL)
     OR (p_room_id IS NOT NULL AND p_zone_id IS NOT NULL) THEN
    RAISE EXCEPTION
      'Exactly one of room_id or zone_id must be provided';
  END IF;

  -- Validate creator type
  IF p_created_by_type NOT IN ('GUEST','STAFF','FRONT_DESK','SYSTEM') THEN
    RAISE EXCEPTION
      'Invalid created_by_type: %', p_created_by_type;
  END IF;

  -- Ensure active SLA policy exists
  IF NOT EXISTS (
    SELECT 1
    FROM sla_policies
    WHERE department_id = p_department_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION
      'No active SLA policy found for department %', p_department_id;
  END IF;

  ----------------------------------------------------------------
  -- 1️⃣ Create ticket (Always Unassigned initially)
  ----------------------------------------------------------------

  INSERT INTO tickets (
    hotel_id,
    service_department_id,
    room_id,
    zone_id,
    title,
    description,
    status,
    current_assignee_id,
    created_by_type,
    created_by_id
  )
  VALUES (
    p_hotel_id,
    p_department_id,
    p_room_id,
    p_zone_id,
    p_title,
    p_description,
    'NEW',
    NULL, -- Always NULL (Job will handle assignment)
    p_created_by_type,
    p_created_by_id
  )
  RETURNING id INTO v_ticket_id;

  ----------------------------------------------------------------
  -- 2️⃣ Audit: CREATED event (mandatory)
  ----------------------------------------------------------------

  INSERT INTO ticket_events (
    ticket_id,
    event_type,
    new_status,
    actor_type,
    actor_id,
    comment
  )
  VALUES (
    v_ticket_id,
    'CREATED',
    'NEW',
    p_created_by_type,
    CASE
      WHEN p_created_by_type IN ('STAFF','FRONT_DESK')
        THEN p_created_by_id
      ELSE NULL
    END,
    'Service request created'
  );

  ----------------------------------------------------------------
  -- 3️⃣ Initialize SLA runtime state
  ----------------------------------------------------------------

  INSERT INTO ticket_sla_state (
    ticket_id,
    sla_policy_id
  )
  SELECT
    v_ticket_id,
    sp.id
  FROM sla_policies sp
  WHERE sp.department_id = p_department_id
    AND sp.is_active = true
  LIMIT 1;

  ----------------------------------------------------------------
  -- 4️⃣ Done
  ----------------------------------------------------------------

  RETURN v_ticket_id;
END;
$$;
