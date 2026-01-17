-- ============================================================
-- Fix: Cleanup create_service_request RPC
-- Purpose: Remove legacy auto-assignment logic.
--          Ticket assignment is now handled EXCLUSIVELY
--          by the 'auto_assign_next_ticket' cron job.
-- ============================================================

CREATE OR REPLACE FUNCTION create_service_request(
  p_hotel_id UUID,
  p_room_id UUID,
  p_zone_id UUID,
  p_service_id UUID,
  p_description TEXT,
  p_created_by_type TEXT,
  p_created_by_id UUID,  -- hotel_members.id for STAFF / FRONT_DESK, NULL for GUEST / SYSTEM
  p_stay_id UUID DEFAULT NULL -- [NEW] Optional stay_id
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket_id UUID;
  v_service_title TEXT;
  v_department_id UUID;
BEGIN
  ----------------------------------------------------------------
  -- 0️⃣ Input validation & Service Lookup
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

  -- Lookup Service & Department
  SELECT label, department_id
  INTO v_service_title, v_department_id
  FROM services
  WHERE id = p_service_id
    AND hotel_id = p_hotel_id;  -- Ensure service belongs to this hotel

  IF v_service_title IS NULL THEN
     RAISE EXCEPTION 'Service not found or invalid for this hotel (ID: %)', p_service_id;
  END IF;

  -- Ensure active SLA policy exists (for this department)
  IF NOT EXISTS (
    SELECT 1
    FROM sla_policies
    WHERE department_id = v_department_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION
      'No active SLA policy found for department %', v_department_id;
  END IF;

  ----------------------------------------------------------------
  -- 1️⃣ Create ticket (Always Unassigned initially)
  ----------------------------------------------------------------

  INSERT INTO tickets (
    hotel_id,
    service_department_id,
    service_id,             -- [NEW] Link to Services table
    stay_id,                -- [NEW] Link to Stay
    room_id,
    zone_id,
    title,                  -- [SNAPSHOT] Copied from service label
    description,
    status,
    current_assignee_id,
    created_by_type,
    created_by_id
  )
  VALUES (
    p_hotel_id,
    v_department_id,
    p_service_id,
    p_stay_id,              -- [NEW] Insert stay_id
    p_room_id,
    p_zone_id,
    v_service_title,
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
    'Service request created: ' || v_service_title
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
  WHERE sp.department_id = v_department_id
    AND sp.is_active = true
  LIMIT 1;

  ----------------------------------------------------------------
  -- 4️⃣ Done
  ----------------------------------------------------------------

  RETURN v_ticket_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_service_request(UUID, UUID, UUID, UUID, TEXT, TEXT, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION create_service_request(UUID, UUID, UUID, UUID, TEXT, TEXT, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION create_service_request(UUID, UUID, UUID, UUID, TEXT, TEXT, UUID, UUID) TO anon;
