
CREATE OR REPLACE FUNCTION "public"."hk_start_cleaning"("p_room_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_task_id UUID;
    v_hotel_id UUID;
    v_old_status housekeeping_status_enum;
    v_member_id UUID;
    v_existing_assignee UUID;
BEGIN
    -- Get current room state
    SELECT hotel_id, housekeeping_status INTO v_hotel_id, v_old_status
    FROM rooms WHERE id = p_room_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Room not found: %', p_room_id;
    END IF;

    IF NOT public.has_hotel_role(
        auth.uid(),
        v_hotel_id,
        ARRAY['OWNER', 'ADMIN', 'GENERAL_MANAGER', 'SUPERVISOR', 'HOUSEKEEPING_MANAGER', 'HOUSEKEEPING_SUPERVISOR']
    ) THEN
        RAISE EXCEPTION 'Unauthorized: you do not have supervisor-level permission to modify room % in hotel %', p_room_id, v_hotel_id;
    END IF;

    -- Block if room is out of order
    IF v_old_status = 'out_of_order'::housekeeping_status_enum THEN
        RAISE EXCEPTION 'Cannot start cleaning. Room is out of order.';
    END IF;

    -- Block if room is already clean (prevent accidental restarts)
    IF v_old_status IN ('clean'::housekeeping_status_enum, 'inspected'::housekeeping_status_enum) THEN
        RAISE EXCEPTION 'Room is already clean.';
    END IF;

    -- Resolve the calling user's hotel_member ID for this hotel
    SELECT id INTO v_member_id
    FROM hotel_members
    WHERE user_id = auth.uid()
      AND hotel_id = v_hotel_id
      AND is_active = true
    LIMIT 1;

    IF v_member_id IS NULL THEN
        RAISE EXCEPTION 'You are not an active member of this hotel.';
    END IF;

    -- Check if there's an existing pending task with a pre-assigned staff member (from bulk assign)
    SELECT assigned_to INTO v_existing_assignee
    FROM housekeeping_tasks
    WHERE room_id = p_room_id
      AND status IN ('pending', 'in_progress')
      AND hotel_id = v_hotel_id
    ORDER BY created_at DESC
    LIMIT 1;

    -- Close any existing active task
    UPDATE housekeeping_tasks
    SET status = 'cancelled', completed_at = now()
    WHERE room_id = p_room_id 
      AND status IN ('pending', 'in_progress')
      AND hotel_id = v_hotel_id;

    -- Create new task with assignment:
    -- If room was pre-assigned (bulk assign), keep that staff member.
    -- Otherwise, auto-assign to the calling user.
    INSERT INTO housekeeping_tasks (room_id, hotel_id, status, started_at, priority_score, assigned_to)
    VALUES (p_room_id, v_hotel_id, 'in_progress', now(), 0, COALESCE(v_existing_assignee, v_member_id))
    RETURNING id INTO v_task_id;

    -- Update room status → in_progress
    UPDATE rooms
    SET housekeeping_status = 'in_progress'::housekeeping_status_enum,
        updated_at = now()
    WHERE id = p_room_id;

    -- Audit event
    INSERT INTO housekeeping_events (hotel_id, room_id, old_status, new_status, changed_by, event_type, details)
    VALUES (v_hotel_id, p_room_id, v_old_status, 'in_progress', auth.uid(), 'CLEANING_STARTED',
            jsonb_build_object('task_id', v_task_id, 'assigned_to', COALESCE(v_existing_assignee, v_member_id)));

    RETURN jsonb_build_object('success', true, 'task_id', v_task_id, 'new_status', 'in_progress',
                              'assigned_to', COALESCE(v_existing_assignee, v_member_id));
END;
$$;
