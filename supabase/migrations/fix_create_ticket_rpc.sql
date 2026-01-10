-- ============================================================
-- Fix: create_service_request RPC
-- Issue: hotel_members.department_id column was renamed/removed
-- Solution: Use staff_departments table for assignment checks
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
  v_staff_id  UUID;
BEGIN
  ----------------------------------------------------------------
  -- 0️⃣ Input validation (fail fast, clear errors)
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

  -- Ensure active SLA policy exists (intentional design)
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
  -- 1️⃣ Resolve eligible staff (shift + workload aware)
  ----------------------------------------------------------------
  -- FIX: check staff_departments instead of hotel_members.department_id
  
  SELECT hm.id
  INTO v_staff_id
  FROM hotel_members hm
  JOIN staff_shifts ss
    ON ss.staff_id = hm.id
  LEFT JOIN tickets t
    ON t.current_assignee_id = hm.id
   AND t.status IN ('NEW','IN_PROGRESS','BLOCKED')
  WHERE
    hm.hotel_id = p_hotel_id
    AND hm.role = 'STAFF'
    AND hm.is_active = true
    AND hm.is_verified = true
    AND ss.is_active = true
    AND now() BETWEEN ss.shift_start AND ss.shift_end
    -- New Department Check:
    AND EXISTS (
      SELECT 1 
      FROM staff_departments sd 
      WHERE sd.staff_id = hm.id 
      AND sd.department_id = p_department_id
    )
  GROUP BY hm.id
  ORDER BY COUNT(t.id) ASC, hm.created_at ASC
  LIMIT 1;

  ----------------------------------------------------------------
  -- 2️⃣ Create ticket (root record)
  -- current_assignee_id MUST start NULL to create clean ON_ASSIGN transition
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
    NULL,
    p_created_by_type,
    p_created_by_id
  )
  RETURNING id INTO v_ticket_id;

  ----------------------------------------------------------------
  -- 3️⃣ Audit: CREATED event (mandatory)
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
  -- 4️⃣ Initialize SLA runtime state (clock NOT started yet)
  -- SLA start is controlled ONLY by triggers + policy
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
  -- 5️⃣ Auto-assign staff (if available)
  -- This UPDATE fires trg_start_sla_on_assign if policy = ON_ASSIGN
  ----------------------------------------------------------------

  IF v_staff_id IS NOT NULL THEN
    UPDATE tickets
    SET current_assignee_id = v_staff_id
    WHERE id = v_ticket_id;

    -- Audit: ASSIGNED event
    INSERT INTO ticket_events (
      ticket_id,
      event_type,
      actor_type,
      actor_id,
      comment
    )
    VALUES (
      v_ticket_id,
      'ASSIGNED',
      'SYSTEM',
      NULL,
      'Auto-assigned based on shift and workload'
    );
  END IF;

  ----------------------------------------------------------------
  -- 6️⃣ Done
  ----------------------------------------------------------------

  RETURN v_ticket_id;
END;
$$;
