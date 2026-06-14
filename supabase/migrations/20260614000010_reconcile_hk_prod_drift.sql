-- Reconcile prod drift on housekeeping RPCs (auth sweep — 2026-06-14).
--
-- Prod verification during the authorization sweep found hk_bulk_assign and
-- hk_complete_cleaning UNGUARDED on prod (anon-callable, no auth check) while the
-- committed source (20260418000000_baseline.sql) and local both define the
-- GUARDED versions. i.e. PROD had drifted from source on two security-sensitive
-- functions: an anonymous caller could bulk-assign housekeeping tasks or mark any
-- room clean/inspected. A local-only check missed this — only the prod sweep
-- caught it.
--
-- Fix: re-apply the committed (guarded) definitions verbatim from the baseline so
-- prod matches source + local. The guards authorize against the room's hotel and
-- require supervisor/staff membership (RAISE 'Unauthorized…'), so anon is rejected
-- inside the body. Idempotent CREATE OR REPLACE; a no-op on local/fresh installs.

CREATE OR REPLACE FUNCTION "public"."hk_bulk_assign"("p_room_ids" "uuid"[], "p_staff_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_hotel_id UUID;
    v_distinct_rooms UUID[];
    v_updated_count INT := 0;
    v_dirty_count INT := 0;
    v_inspect_count INT := 0;
    v_backfill_count INT := 0;
BEGIN
    -- 1. Deduplication & Cleanup
    SELECT array_agg(DISTINCT id) INTO v_distinct_rooms FROM unnest(p_room_ids) id WHERE id IS NOT NULL;
    IF v_distinct_rooms IS NULL OR array_length(v_distinct_rooms, 1) = 0 THEN
        RETURN jsonb_build_object('success', true, 'rooms_affected', 0);
    END IF;

    -- 2. Existence & Single-Hotel Validation
    SELECT hotel_id INTO v_hotel_id FROM rooms WHERE id = ANY(v_distinct_rooms) LIMIT 1;
    IF EXISTS (SELECT 1 FROM rooms WHERE id = ANY(v_distinct_rooms) AND hotel_id <> v_hotel_id) THEN
        RAISE EXCEPTION 'Bulk operations must target rooms from the same hotel.';
    END IF;
    IF (SELECT count(*) FROM rooms WHERE id = ANY(v_distinct_rooms)) <> array_length(v_distinct_rooms, 1) THEN
        RAISE EXCEPTION 'One or more room IDs do not exist';
    END IF;

    -- 3. Authorization
    IF NOT public.has_hotel_role(
        auth.uid(), v_hotel_id, 
        ARRAY['OWNER', 'ADMIN', 'GENERAL_MANAGER', 'SUPERVISOR', 'HOUSEKEEPING_MANAGER', 'HOUSEKEEPING_SUPERVISOR']
    ) THEN
        RAISE EXCEPTION 'Unauthorized for bulk assignment';
    END IF;

    -- 4. Staff Validation
    IF NOT EXISTS (SELECT 1 FROM hotel_members WHERE id = p_staff_id AND hotel_id = v_hotel_id AND is_active = true) THEN
        RAISE EXCEPTION 'Staff does not belong to this hotel or is inactive';
    END IF;

    -- 5a. For dirty/in_progress rooms: cancel old tasks and create new pending tasks with assignment
    UPDATE housekeeping_tasks 
    SET status = 'cancelled', completed_at = now()
    WHERE room_id = ANY(v_distinct_rooms) 
      AND status IN ('pending', 'in_progress')
      AND hotel_id = v_hotel_id;

    INSERT INTO housekeeping_tasks (room_id, hotel_id, status, assigned_to, priority_score)
    SELECT id, v_hotel_id, 'pending', p_staff_id, 0
    FROM rooms 
    WHERE id = ANY(v_distinct_rooms)
    AND housekeeping_status IN ('dirty', 'in_progress');

    GET DIAGNOSTICS v_dirty_count = ROW_COUNT;

    -- 5b. For clean rooms (pending inspection): update the existing inspection_pending task's assignment
    UPDATE housekeeping_tasks
    SET assigned_to = p_staff_id
    WHERE room_id = ANY(v_distinct_rooms)
      AND status = 'inspection_pending'
      AND hotel_id = v_hotel_id;

    GET DIAGNOSTICS v_inspect_count = ROW_COUNT;

    -- 5c. If a clean room has no inspection_pending task (legacy data), create one
    INSERT INTO housekeeping_tasks (room_id, hotel_id, status, started_at, priority_score, assigned_to)
    SELECT r.id, v_hotel_id, 'inspection_pending', now(), 0, p_staff_id
    FROM rooms r
    WHERE r.id = ANY(v_distinct_rooms)
      AND r.housekeeping_status = 'clean'
      AND NOT EXISTS (
        SELECT 1 FROM housekeeping_tasks ht
        WHERE ht.room_id = r.id AND ht.status = 'inspection_pending' AND ht.hotel_id = v_hotel_id
      );

    GET DIAGNOSTICS v_backfill_count = ROW_COUNT;

    v_updated_count := v_dirty_count + v_inspect_count + v_backfill_count;

    -- 6. Audit Events
    INSERT INTO housekeeping_events (hotel_id, room_id, old_status, new_status, changed_by, event_type, details)
    SELECT v_hotel_id, id, housekeeping_status, housekeeping_status, auth.uid(), 'BULK_TASK_ASSIGNED',
           jsonb_build_object('staff_id', p_staff_id, 'bulk', true)
    FROM rooms WHERE id = ANY(v_distinct_rooms)
    AND housekeeping_status NOT IN ('out_of_order', 'inspected');

    RETURN jsonb_build_object('success', true, 'rooms_affected', v_updated_count);
END;
$$;

CREATE OR REPLACE FUNCTION "public"."hk_complete_cleaning"("p_room_id" "uuid", "p_final_status" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_task_id UUID;
    v_hotel_id UUID;
    v_old_status housekeeping_status_enum;
    v_new_status housekeeping_status_enum;
    v_cleaner_id UUID;
    v_inspection_task_id UUID;
BEGIN
    -- Validate final status
    IF p_final_status NOT IN ('clean', 'inspected') THEN
        RAISE EXCEPTION 'Invalid final status: %. Must be clean or inspected.', p_final_status;
    END IF;

    v_new_status := p_final_status::housekeeping_status_enum;

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

    -- Block if room is not currently being cleaned
    IF v_old_status <> 'in_progress'::housekeeping_status_enum THEN
        RAISE EXCEPTION 'Room not currently being cleaned.';
    END IF;

    -- Block if room is out of order
    IF v_old_status = 'out_of_order'::housekeeping_status_enum THEN
        RAISE EXCEPTION 'Cannot complete cleaning. Room is out of order.';
    END IF;

    -- Complete exactly ONE active task (latest, most recent) and capture the cleaner
    UPDATE housekeeping_tasks
    SET status = 'completed', completed_at = now()
    WHERE id = (
        SELECT id FROM housekeeping_tasks
        WHERE room_id = p_room_id
          AND status IN ('pending', 'in_progress')
          AND hotel_id = v_hotel_id
        ORDER BY created_at DESC
        LIMIT 1
    )
    RETURNING id, assigned_to INTO v_task_id, v_cleaner_id;

    IF v_task_id IS NULL THEN
        RAISE EXCEPTION 'No active cleaning task found for room %', p_room_id;
    END IF;

    -- If marking as 'clean' (pending inspection), create an inspection_pending task
    -- so the room stays visible in the operational board with assignment tracking
    IF p_final_status = 'clean' THEN
        INSERT INTO housekeeping_tasks (room_id, hotel_id, status, started_at, priority_score, assigned_to)
        VALUES (p_room_id, v_hotel_id, 'inspection_pending', now(), 0, NULL)
        RETURNING id INTO v_inspection_task_id;
    END IF;

    -- Update room status
    UPDATE rooms
    SET housekeeping_status = v_new_status,
        is_out_of_order = false,
        updated_at = now()
    WHERE id = p_room_id;

    -- Audit event
    INSERT INTO housekeeping_events (hotel_id, room_id, old_status, new_status, changed_by, event_type, details)
    VALUES (v_hotel_id, p_room_id, v_old_status, v_new_status, auth.uid(), 'CLEANING_COMPLETED',
            jsonb_build_object('task_id', v_task_id, 'final_status', p_final_status,
                               'cleaner_id', v_cleaner_id,
                               'inspection_task_id', v_inspection_task_id));

    RETURN jsonb_build_object('success', true, 'task_id', v_task_id, 'new_status', p_final_status);
END;
$$;
