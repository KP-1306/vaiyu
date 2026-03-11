-- ============================================================
-- MIGRATION: 20260228_housekeeping_board.sql
-- Enterprise Housekeeping Operational Board
-- ============================================================

BEGIN;

-- ============================================================
-- 1. HELPERS & INDEXING
-- ============================================================
DROP FUNCTION IF EXISTS public.has_hotel_role(UUID, UUID, TEXT[]);
CREATE OR REPLACE FUNCTION public.has_hotel_role(
    p_user_id UUID,
    p_hotel_id UUID,
    p_roles TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
SELECT EXISTS (
    SELECT 1
    FROM hotel_members hm
    JOIN hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
    JOIN hotel_roles hr ON hr.id = hmr.role_id
    WHERE hm.user_id = p_user_id
      AND hm.hotel_id = p_hotel_id
      AND hm.is_active = true
      AND hr.is_active = true
      AND hr.code = ANY(p_roles)
);
$$;

CREATE INDEX IF NOT EXISTS idx_hmr_member_role
ON hotel_member_roles (hotel_member_id, role_id);

-- Optimized index for Housekeeping Board sorting
CREATE INDEX IF NOT EXISTS idx_rooms_floor_number
ON rooms(hotel_id, floor, number);

-- ============================================================
-- 1. SCHEMA UPDATES
-- ============================================================

-- housekeeping_tasks: extend with operational columns
ALTER TABLE housekeeping_tasks ADD COLUMN IF NOT EXISTS hotel_id UUID REFERENCES hotels(id);
ALTER TABLE housekeeping_tasks ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE housekeeping_tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE housekeeping_tasks ADD COLUMN IF NOT EXISTS eta TIMESTAMPTZ;
ALTER TABLE housekeeping_tasks ADD COLUMN IF NOT EXISTS priority_score INTEGER DEFAULT 0;

-- Backfill hotel_id from rooms
UPDATE housekeeping_tasks ht
SET hotel_id = r.hotel_id
FROM rooms r
WHERE ht.room_id = r.id AND ht.hotel_id IS NULL;

-- Index for board view
CREATE INDEX IF NOT EXISTS idx_hk_tasks_room_status ON housekeeping_tasks(room_id, status);
CREATE INDEX IF NOT EXISTS idx_hk_tasks_hotel ON housekeeping_tasks(hotel_id);

-- Highly optimized partial index for active tasks (LATERAL jump speed)
CREATE INDEX IF NOT EXISTS idx_hk_tasks_active
ON housekeeping_tasks(room_id)
WHERE status IN ('pending', 'in_progress', 'inspection_pending');

-- housekeeping_events: extend with structured fields (NOT NULL + defaults)
ALTER TABLE housekeeping_events ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'STATUS_CHANGE';
ALTER TABLE housekeeping_events ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}'::jsonb;

-- Index for timeline
CREATE INDEX IF NOT EXISTS idx_hk_events_room ON housekeeping_events(room_id, changed_at DESC);


-- ============================================================
-- 2. VIEW: v_arrival_priority
-- Arrival urgency per room (minutes until check-in)
-- ============================================================

DROP VIEW IF EXISTS v_arrival_priority CASCADE;

CREATE OR REPLACE VIEW v_arrival_priority AS
SELECT
    br.room_id,
    b.id AS booking_id,
    b.code AS booking_code,
    b.guest_name,
    b.scheduled_checkin_at,
    GREATEST(EXTRACT(EPOCH FROM (b.scheduled_checkin_at - now()))::integer / 60, 0) AS arrival_needed_in_minutes,
    CASE
        WHEN EXTRACT(EPOCH FROM (b.scheduled_checkin_at - now())) / 60 <= 30 THEN 'CRITICAL'
        WHEN EXTRACT(EPOCH FROM (b.scheduled_checkin_at - now())) / 60 <= 120 THEN 'HIGH'
        WHEN EXTRACT(EPOCH FROM (b.scheduled_checkin_at - now())) / 60 <= 360 THEN 'MEDIUM'
        ELSE 'LOW'
    END AS arrival_urgency
FROM bookings b
JOIN booking_rooms br ON br.booking_id = b.id
WHERE b.status IN ('CONFIRMED', 'PRE_CHECKED_IN')
  AND b.scheduled_checkin_at > now();

GRANT SELECT ON v_arrival_priority TO authenticated;
GRANT SELECT ON v_arrival_priority TO service_role;


-- ============================================================
-- 3. VIEW: v_housekeeping_operational_board
-- Single unified view for the HK board UI
-- ============================================================

DROP VIEW IF EXISTS v_housekeeping_operational_board;

CREATE OR REPLACE VIEW v_housekeeping_operational_board AS
SELECT
    r.id AS room_id,
    r.hotel_id,
    r.number AS room_number,
    r.floor,
    r.housekeeping_status,
    r.is_out_of_order,

    -- Room type info
    rt.id AS room_type_id,
    rt.name AS room_type_name,

    -- Active HK task (latest non-completed)
    ht.id AS task_id,
    ht.status AS task_status,
    ht.assigned_to AS task_assigned_to,
    ht.started_at AS task_started_at,
    ht.eta AS task_eta,
    ht.priority_score AS task_priority_score,

    -- Assigned staff name
    COALESCE(p.full_name, 'Unassigned') AS assigned_staff_name,

    -- Arrival urgency (nearest arrival)
    ap.arrival_needed_in_minutes,
    ap.arrival_urgency,
    ap.booking_id AS arrival_booking_id,
    ap.booking_code AS arrival_booking_code,
    ap.guest_name AS arrival_guest_name,
    ap.scheduled_checkin_at AS arrival_checkin_at,

    -- Computed: arrival impact flag (blocked if room is not ready: clean/inspected)
    CASE
        WHEN ap.arrival_needed_in_minutes IS NOT NULL
             AND r.housekeeping_status NOT IN ('clean'::housekeeping_status_enum, 'inspected'::housekeeping_status_enum)
        THEN true
        ELSE false
    END AS arrival_blocked,

    r.updated_at AS room_updated_at,

    -- Latest completed task info (for Inspect modal context) - Added at the end for schema safety
    last_ht.completed_at AS last_task_completed_at,
    last_ht.started_at AS last_task_started_at,
    last_p.full_name AS last_cleaner_name

FROM rooms r
LEFT JOIN room_types rt ON rt.id = r.room_type_id
LEFT JOIN LATERAL (
    SELECT *
    FROM housekeeping_tasks ht2
    WHERE ht2.room_id = r.id
      AND ht2.status IN ('pending', 'in_progress', 'inspection_pending')
    ORDER BY ht2.created_at DESC
    LIMIT 1
) ht ON TRUE
LEFT JOIN hotel_members hm ON hm.id = ht.assigned_to
LEFT JOIN profiles p ON p.id = hm.user_id
-- Join the latest completed task separately
LEFT JOIN LATERAL (
    SELECT ht_comp.completed_at, ht_comp.started_at, ht_comp.assigned_to
    FROM housekeeping_tasks ht_comp
    WHERE ht_comp.room_id = r.id
      AND ht_comp.status = 'completed'
    ORDER BY ht_comp.completed_at DESC
    LIMIT 1
) last_ht ON TRUE
LEFT JOIN hotel_members last_hm ON last_hm.id = last_ht.assigned_to
LEFT JOIN profiles last_p ON last_p.id = last_hm.user_id
LEFT JOIN LATERAL (
    SELECT *
    FROM v_arrival_priority ap2
    WHERE ap2.room_id = r.id
    ORDER BY ap2.arrival_needed_in_minutes ASC
    LIMIT 1
) ap ON TRUE;

GRANT SELECT ON v_housekeeping_operational_board TO authenticated;
GRANT SELECT ON v_housekeeping_operational_board TO service_role;


-- ============================================================
-- 4. RPCs: Housekeeping Lifecycle
-- ============================================================

-- 4a. Start Cleaning
-- ============================================================
DROP FUNCTION IF EXISTS public.hk_start_cleaning(UUID);
CREATE OR REPLACE FUNCTION public.hk_start_cleaning(
    p_room_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_task_id UUID;
    v_hotel_id UUID;
    v_old_status housekeeping_status_enum;
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

    -- Close any existing active task
    UPDATE housekeeping_tasks
    SET status = 'cancelled', completed_at = now()
    WHERE room_id = p_room_id 
      AND status IN ('pending', 'in_progress')
      AND hotel_id = v_hotel_id;

    -- Create new task
    INSERT INTO housekeeping_tasks (room_id, hotel_id, status, started_at, priority_score)
    VALUES (p_room_id, v_hotel_id, 'in_progress', now(), 0)
    RETURNING id INTO v_task_id;

    -- Update room status → in_progress (not dirty; dirty = untouched, in_progress = actively cleaning)
    UPDATE rooms
    SET housekeeping_status = 'in_progress'::housekeeping_status_enum,
        updated_at = now()
    WHERE id = p_room_id;

    -- Audit event
    INSERT INTO housekeeping_events (hotel_id, room_id, old_status, new_status, changed_by, event_type, details)
    VALUES (v_hotel_id, p_room_id, v_old_status, 'in_progress', auth.uid(), 'CLEANING_STARTED',
            jsonb_build_object('task_id', v_task_id));

    RETURN jsonb_build_object('success', true, 'task_id', v_task_id, 'new_status', 'in_progress');
END;
$$;

GRANT EXECUTE ON FUNCTION public.hk_start_cleaning(UUID) TO authenticated;


-- 4b. Complete Cleaning
-- ============================================================
DROP FUNCTION IF EXISTS public.hk_complete_cleaning(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.hk_complete_cleaning(
    p_room_id UUID,
    p_final_status TEXT  -- 'clean' (vacant clean) or 'inspected' (occupied clean)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_task_id UUID;
    v_hotel_id UUID;
    v_old_status housekeeping_status_enum;
    v_new_status housekeeping_status_enum;
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

    -- Block if room is not currently being cleaned (optional strictness)
    IF v_old_status <> 'in_progress'::housekeeping_status_enum THEN
        RAISE EXCEPTION 'Room not currently being cleaned.';
    END IF;

    -- Block if room is out of order (protect against accidental override via wrong RPC)
    IF v_old_status = 'out_of_order'::housekeeping_status_enum THEN
        RAISE EXCEPTION 'Cannot complete cleaning. Room is out of order.';
    END IF;

    -- Complete exactly ONE active task (latest, most recent)
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
    RETURNING id INTO v_task_id;

    IF v_task_id IS NULL THEN
        RAISE EXCEPTION 'No active cleaning task found for room %', p_room_id;
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
            jsonb_build_object('task_id', v_task_id, 'final_status', p_final_status));

    RETURN jsonb_build_object('success', true, 'task_id', v_task_id, 'new_status', p_final_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.hk_complete_cleaning(UUID, TEXT) TO authenticated;


-- 4c. Pause Cleaning
-- ============================================================
DROP FUNCTION IF EXISTS public.hk_pause_cleaning(UUID);
CREATE OR REPLACE FUNCTION public.hk_pause_cleaning(
    p_room_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_task_id UUID;
    v_hotel_id UUID;
    v_old_status housekeeping_status_enum;
BEGIN
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

    -- Block if room not currently being cleaned
    IF v_old_status <> 'in_progress'::housekeeping_status_enum THEN
        RAISE EXCEPTION 'Room is not currently being cleaned.';
    END IF;

    -- Pause active task
    UPDATE housekeeping_tasks
    SET status = 'pending'
    WHERE room_id = p_room_id 
      AND status = 'in_progress'
      AND hotel_id = v_hotel_id
    RETURNING id INTO v_task_id;

    IF v_task_id IS NULL THEN
        RAISE EXCEPTION 'No active cleaning task found for room %', p_room_id;
    END IF;

    -- Update room status to pickup (paused state)
    UPDATE rooms
    SET housekeeping_status = 'pickup'::housekeeping_status_enum,
        updated_at = now()
    WHERE id = p_room_id;

    -- Audit event
    INSERT INTO housekeeping_events (hotel_id, room_id, old_status, new_status, changed_by, event_type)
    VALUES (v_hotel_id, p_room_id, v_old_status, 'pickup', auth.uid(), 'CLEANING_PAUSED');

    RETURN jsonb_build_object('success', true, 'task_id', v_task_id, 'new_status', 'pickup');
END;
$$;

GRANT EXECUTE ON FUNCTION public.hk_pause_cleaning(UUID) TO authenticated;


-- 4d. Mark Out of Order
-- ============================================================
DROP FUNCTION IF EXISTS public.hk_mark_out_of_order(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.hk_mark_out_of_order(
    p_room_id UUID,
    p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_hotel_id UUID;
    v_old_status housekeeping_status_enum;
BEGIN
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

    -- Cancel any active tasks
    UPDATE housekeeping_tasks
    SET status = 'cancelled', completed_at = now()
    WHERE room_id = p_room_id 
      AND status IN ('pending', 'in_progress')
      AND hotel_id = v_hotel_id;

    -- Update room
    UPDATE rooms
    SET housekeeping_status = 'out_of_order'::housekeeping_status_enum,
        is_out_of_order = true,
        updated_at = now()
    WHERE id = p_room_id;

    -- Audit event
    INSERT INTO housekeeping_events (hotel_id, room_id, old_status, new_status, changed_by, event_type, details)
    VALUES (v_hotel_id, p_room_id, v_old_status, 'out_of_order', auth.uid(), 'MARKED_OUT_OF_ORDER',
            jsonb_build_object('reason', COALESCE(p_reason, 'No reason provided')));

    RETURN jsonb_build_object('success', true, 'new_status', 'out_of_order');
END;
$$;

GRANT EXECUTE ON FUNCTION public.hk_mark_out_of_order(UUID, TEXT) TO authenticated;


-- 4e. Supervisor Override
-- ============================================================
DROP FUNCTION IF EXISTS public.hk_supervisor_override(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.hk_supervisor_override(
    p_room_id UUID,
    p_new_status TEXT,
    p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_hotel_id UUID;
    v_old_status housekeeping_status_enum;
    v_new_status housekeeping_status_enum;
BEGIN
    -- Safe enum validation
    IF NOT EXISTS (
      SELECT 1 FROM unnest(enum_range(NULL::housekeeping_status_enum)) s
      WHERE s::text = p_new_status
    ) THEN
        RAISE EXCEPTION 'Invalid housekeeping status: %', p_new_status;
    END IF;

    v_new_status := p_new_status::housekeeping_status_enum;

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

    -- Cancel any active tasks if overriding to clean/inspected
    IF p_new_status IN ('clean', 'inspected') THEN
        UPDATE housekeeping_tasks
        SET status = 'completed', completed_at = now()
        WHERE room_id = p_room_id 
          AND status IN ('pending', 'in_progress')
          AND hotel_id = v_hotel_id;
    END IF;

    -- Update room
    UPDATE rooms
    SET housekeeping_status = v_new_status,
        is_out_of_order = (p_new_status = 'out_of_order'),
        updated_at = now()
    WHERE id = p_room_id;

    -- Audit event
    INSERT INTO housekeeping_events (hotel_id, room_id, old_status, new_status, changed_by, event_type, details)
    VALUES (v_hotel_id, p_room_id, v_old_status, v_new_status, auth.uid(), 'SUPERVISOR_OVERRIDE',
            jsonb_build_object('reason', COALESCE(p_reason, 'Supervisor override'), 'override', true));

    RETURN jsonb_build_object('success', true, 'old_status', v_old_status::text, 'new_status', p_new_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.hk_supervisor_override(UUID, TEXT, TEXT) TO authenticated;


-- 4f. Assign Task (Staff Assignment)
-- ============================================================
DROP FUNCTION IF EXISTS public.hk_assign_task(UUID, UUID);
CREATE OR REPLACE FUNCTION public.hk_assign_task(
    p_room_id UUID,
    p_staff_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_task_id UUID;
    v_hotel_id UUID;
    v_old_assignee UUID;
    v_current_status housekeeping_status_enum;
BEGIN
    SELECT hotel_id, housekeeping_status INTO v_hotel_id, v_current_status
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

    -- Block assignment if room is out of order
    IF v_current_status = 'out_of_order'::housekeeping_status_enum THEN
        RAISE EXCEPTION 'Cannot assign task. Room is out of order.';
    END IF;

    -- Block assignment if room is already clean/ready
    IF v_current_status IN ('clean'::housekeeping_status_enum, 'inspected'::housekeeping_status_enum) THEN
        RAISE EXCEPTION 'Room is already ready.';
    END IF;

    -- Validate staff belongs to same hotel (multi-property safety)
    IF NOT EXISTS (
        SELECT 1
        FROM hotel_members
        WHERE id = p_staff_id
          AND hotel_id = v_hotel_id
    ) THEN
        RAISE EXCEPTION 'Staff does not belong to this hotel';
    END IF;

    -- Find the active task for this room
    SELECT id, assigned_to INTO v_task_id, v_old_assignee
    FROM housekeeping_tasks
    WHERE room_id = p_room_id
      AND status IN ('pending', 'in_progress')
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_task_id IS NULL THEN
        -- No active task — create one in pending state
        INSERT INTO housekeeping_tasks (room_id, hotel_id, status, assigned_to, priority_score)
        VALUES (p_room_id, v_hotel_id, 'pending', p_staff_id, 0)
        RETURNING id INTO v_task_id;
    ELSE
        -- Update existing task
        UPDATE housekeeping_tasks
        SET assigned_to = p_staff_id
        WHERE id = v_task_id;
    END IF;

    -- Audit event
    INSERT INTO housekeeping_events (hotel_id, room_id, old_status, new_status, changed_by, event_type, details)
    VALUES (v_hotel_id, p_room_id, v_current_status, v_current_status, auth.uid(), 'TASK_ASSIGNED',
            jsonb_build_object(
                'task_id', v_task_id,
                'staff_id', p_staff_id,
                'old_assignee', v_old_assignee
            ));

    RETURN jsonb_build_object('success', true, 'task_id', v_task_id, 'assigned_to', p_staff_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.hk_assign_task(UUID, UUID) TO authenticated;


-- ============================================================
-- 8. BULK RPCs (Supervisor workflows)
-- ============================================================

-- 8a. Bulk Assign
DROP FUNCTION IF EXISTS public.hk_bulk_assign(UUID[], UUID);
CREATE OR REPLACE FUNCTION public.hk_bulk_assign(
    p_room_ids UUID[],
    p_staff_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_hotel_id UUID;
    v_distinct_rooms UUID[];
    v_updated_count INT;
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

    -- 5. Set-Based Upsert (Cancel old tasks, insert/update new ones)
    -- This is complex for a single CTE because of the upsert logic per room.
    -- For bulk assign, we can just close all pending/in_progress tasks for these rooms and insert new ones.
    UPDATE housekeeping_tasks 
    SET status = 'cancelled', completed_at = now()
    WHERE room_id = ANY(v_distinct_rooms) 
      AND status IN ('pending', 'in_progress')
      AND hotel_id = v_hotel_id;

    INSERT INTO housekeeping_tasks (room_id, hotel_id, status, assigned_to, priority_score)
    SELECT id, v_hotel_id, 'pending', p_staff_id, 0
    FROM rooms 
    WHERE id = ANY(v_distinct_rooms)
    AND housekeeping_status NOT IN ('out_of_order', 'clean', 'inspected');

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    -- 6. Audit Events
    INSERT INTO housekeeping_events (hotel_id, room_id, old_status, new_status, changed_by, event_type, details)
    SELECT v_hotel_id, id, housekeeping_status, housekeeping_status, auth.uid(), 'BULK_TASK_ASSIGNED',
           jsonb_build_object('staff_id', p_staff_id, 'bulk', true)
    FROM rooms WHERE id = ANY(v_distinct_rooms)
    AND housekeeping_status NOT IN ('out_of_order', 'clean', 'inspected');

    RETURN jsonb_build_object('success', true, 'rooms_affected', v_updated_count);
END;
$$;
GRANT EXECUTE ON FUNCTION public.hk_bulk_assign(UUID[], UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.hk_bulk_start_cleaning(UUID[]);
CREATE OR REPLACE FUNCTION public.hk_bulk_start_cleaning(p_room_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_hotel_id UUID;
    v_distinct_rooms UUID[];
    v_updated_count INT;
BEGIN
    SELECT array_agg(DISTINCT id) INTO v_distinct_rooms FROM unnest(p_room_ids) id WHERE id IS NOT NULL;
    IF v_distinct_rooms IS NULL OR array_length(v_distinct_rooms, 1) = 0 THEN
        RETURN jsonb_build_object('success', true, 'rooms_affected', 0);
    END IF;

    SELECT hotel_id INTO v_hotel_id FROM rooms WHERE id = ANY(v_distinct_rooms) LIMIT 1;
    IF EXISTS (SELECT 1 FROM rooms WHERE id = ANY(v_distinct_rooms) AND hotel_id <> v_hotel_id) THEN
        RAISE EXCEPTION 'Bulk operations must target rooms from the same hotel.';
    END IF;

    IF NOT public.has_hotel_role(
        auth.uid(), v_hotel_id, 
        ARRAY['OWNER', 'ADMIN', 'GENERAL_MANAGER', 'SUPERVISOR', 'HOUSEKEEPING_MANAGER', 'HOUSEKEEPING_SUPERVISOR']
    ) THEN
        RAISE EXCEPTION 'Unauthorized for bulk start';
    END IF;

    -- Cancel existing tasks
    UPDATE housekeeping_tasks 
    SET status = 'cancelled', completed_at = now()
    WHERE room_id = ANY(v_distinct_rooms) 
      AND status IN ('pending', 'in_progress')
      AND hotel_id = v_hotel_id;

    -- Set room status and start tasks
    WITH update_result AS (
        UPDATE rooms
        SET housekeeping_status = 'in_progress', updated_at = now()
        WHERE id = ANY(v_distinct_rooms)
        AND housekeeping_status NOT IN ('clean', 'inspected', 'out_of_order')
        AND hotel_id = v_hotel_id
        RETURNING id, housekeeping_status AS old_status
    ),
    inserted_tasks AS (
        INSERT INTO housekeeping_tasks (room_id, hotel_id, status, started_at, priority_score)
        SELECT id, v_hotel_id, 'in_progress', now(), 0 FROM update_result
        RETURNING id AS task_id, room_id
    ),
    log_events AS (
        INSERT INTO housekeeping_events (hotel_id, room_id, old_status, new_status, changed_by, event_type, details)
        SELECT v_hotel_id, ur.id, ur.old_status, 'in_progress', auth.uid(), 'BULK_CLEANING_STARTED',
               jsonb_build_object('task_id', it.task_id, 'bulk', true)
        FROM update_result ur
        JOIN inserted_tasks it ON it.room_id = ur.id
        RETURNING 1
    )
    SELECT count(*) INTO v_updated_count FROM update_result;

    RETURN jsonb_build_object('success', true, 'rooms_affected', v_updated_count);
END;
$$;
GRANT EXECUTE ON FUNCTION public.hk_bulk_start_cleaning(UUID[]) TO authenticated;

DROP FUNCTION IF EXISTS public.hk_bulk_complete_cleaning(UUID[], TEXT);
CREATE OR REPLACE FUNCTION public.hk_bulk_complete_cleaning(p_room_ids UUID[], p_final_status TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_hotel_id UUID;
    v_distinct_rooms UUID[];
    v_updated_count INT;
    v_final_status_enum housekeeping_status_enum;
BEGIN
    IF p_final_status NOT IN ('clean', 'inspected') THEN
        RAISE EXCEPTION 'Invalid final status';
    END IF;
    v_final_status_enum := p_final_status::housekeeping_status_enum;

    SELECT array_agg(DISTINCT id) INTO v_distinct_rooms FROM unnest(p_room_ids) id WHERE id IS NOT NULL;
    IF v_distinct_rooms IS NULL OR array_length(v_distinct_rooms, 1) = 0 THEN
        RETURN jsonb_build_object('success', true, 'rooms_affected', 0);
    END IF;

    SELECT hotel_id INTO v_hotel_id FROM rooms WHERE id = ANY(v_distinct_rooms) LIMIT 1;
    IF EXISTS (SELECT 1 FROM rooms WHERE id = ANY(v_distinct_rooms) AND hotel_id <> v_hotel_id) THEN
        RAISE EXCEPTION 'Bulk operations must target rooms from the same hotel.';
    END IF;

    IF NOT public.has_hotel_role(
        auth.uid(), v_hotel_id, 
        ARRAY['OWNER', 'ADMIN', 'GENERAL_MANAGER', 'SUPERVISOR', 'HOUSEKEEPING_MANAGER', 'HOUSEKEEPING_SUPERVISOR']
    ) THEN
        RAISE EXCEPTION 'Unauthorized for bulk completion';
    END IF;

    -- Complete active tasks and update rooms
    WITH update_result AS (
        UPDATE rooms
        SET housekeeping_status = v_final_status_enum, 
            is_out_of_order = false, 
            updated_at = now()
        WHERE id = ANY(v_distinct_rooms)
        AND housekeeping_status = 'in_progress'
        AND hotel_id = v_hotel_id
        RETURNING id, housekeeping_status AS old_status
    ),
    completed_tasks AS (
        UPDATE housekeeping_tasks
        SET status = 'completed', completed_at = now()
        WHERE id IN (
            SELECT DISTINCT ON (room_id) id 
            FROM housekeeping_tasks 
            WHERE room_id = ANY(v_distinct_rooms) 
            AND status IN ('pending', 'in_progress')
            ORDER BY room_id, created_at DESC
        )
        RETURNING id AS task_id, room_id
    ),
    log_events AS (
        INSERT INTO housekeeping_events (hotel_id, room_id, old_status, new_status, changed_by, event_type, details)
        SELECT v_hotel_id, ur.id, ur.old_status, v_final_status_enum, auth.uid(), 'BULK_CLEANING_COMPLETED',
               jsonb_build_object('task_id', ct.task_id, 'bulk', true)
        FROM update_result ur
        LEFT JOIN completed_tasks ct ON ct.room_id = ur.id
        RETURNING 1
    )
    SELECT count(*) INTO v_updated_count FROM update_result;

    RETURN jsonb_build_object('success', true, 'rooms_affected', v_updated_count);
END;
$$;
GRANT EXECUTE ON FUNCTION public.hk_bulk_complete_cleaning(UUID[], TEXT) TO authenticated;

DROP FUNCTION IF EXISTS public.hk_bulk_mark_out_of_order(UUID[], TEXT);
CREATE OR REPLACE FUNCTION public.hk_bulk_mark_out_of_order(p_room_ids UUID[], p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_hotel_id UUID;
    v_distinct_rooms UUID[];
    v_updated_count INT;
BEGIN
    SELECT array_agg(DISTINCT id) INTO v_distinct_rooms FROM unnest(p_room_ids) id WHERE id IS NOT NULL;
    IF v_distinct_rooms IS NULL OR array_length(v_distinct_rooms, 1) = 0 THEN
        RETURN jsonb_build_object('success', true, 'rooms_affected', 0);
    END IF;

    SELECT hotel_id INTO v_hotel_id FROM rooms WHERE id = ANY(v_distinct_rooms) LIMIT 1;
    IF EXISTS (SELECT 1 FROM rooms WHERE id = ANY(v_distinct_rooms) AND hotel_id <> v_hotel_id) THEN
        RAISE EXCEPTION 'Bulk operations must target rooms from the same hotel.';
    END IF;

    IF NOT public.has_hotel_role(
        auth.uid(), v_hotel_id, 
        ARRAY['OWNER', 'ADMIN', 'GENERAL_MANAGER', 'SUPERVISOR', 'HOUSEKEEPING_MANAGER', 'HOUSEKEEPING_SUPERVISOR']
    ) THEN
        RAISE EXCEPTION 'Unauthorized for bulk OOO';
    END IF;

    -- Cancel existing tasks
    UPDATE housekeeping_tasks 
    SET status = 'cancelled', completed_at = now()
    WHERE room_id = ANY(v_distinct_rooms) 
      AND status IN ('pending', 'in_progress')
      AND hotel_id = v_hotel_id;

    -- Update rooms and log events
    WITH update_result AS (
        UPDATE rooms
        SET housekeeping_status = 'out_of_order', is_out_of_order = true, updated_at = now()
        WHERE id = ANY(v_distinct_rooms)
        AND hotel_id = v_hotel_id
        AND housekeeping_status <> 'out_of_order'
        RETURNING id, housekeeping_status AS old_status
    ),
    log_events AS (
        INSERT INTO housekeeping_events (hotel_id, room_id, old_status, new_status, changed_by, event_type, details)
        SELECT v_hotel_id, id, old_status, 'out_of_order', auth.uid(), 'BULK_MARKED_OUT_OF_ORDER',
               jsonb_build_object('reason', p_reason, 'bulk', true)
        FROM update_result
        RETURNING 1
    )
    SELECT count(*) INTO v_updated_count FROM update_result;

    RETURN jsonb_build_object('success', true, 'rooms_affected', v_updated_count);
END;
$$;
GRANT EXECUTE ON FUNCTION public.hk_bulk_mark_out_of_order(UUID[], TEXT) TO authenticated;


DROP FUNCTION IF EXISTS public.hk_bulk_supervisor_override(UUID[], TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.hk_bulk_supervisor_override(
    p_room_ids UUID[],
    p_new_status TEXT,
    p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_hotel_id UUID;
    v_new_status_enum housekeeping_status_enum;
    v_distinct_rooms UUID[];
    v_updated_count INT;
BEGIN
    -- 1. Safe enum validation
    IF NOT EXISTS (
      SELECT 1 FROM unnest(enum_range(NULL::housekeeping_status_enum)) s
      WHERE s::text = p_new_status
    ) THEN
        RAISE EXCEPTION 'Invalid housekeeping status: %', p_new_status;
    END IF;

    v_new_status_enum := p_new_status::housekeeping_status_enum;

    -- 2. Validate room list payload
    IF p_room_ids IS NULL OR array_length(p_room_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'No rooms provided';
    END IF;

    -- Deduplicate room IDs to prevent wasted CPU & filter NULLs
    SELECT array_agg(DISTINCT id) 
    INTO v_distinct_rooms 
    FROM unnest(p_room_ids) AS id 
    WHERE id IS NOT NULL;

    -- Capture hotel_id from rooms and validate all rooms exist and belong to the same property
    SELECT hotel_id INTO v_hotel_id FROM rooms WHERE id = ANY(v_distinct_rooms) LIMIT 1;
    
    IF v_hotel_id IS NULL THEN
        RAISE EXCEPTION 'One or more room IDs do not exist in the database';
    END IF;

    IF EXISTS (
        SELECT 1 FROM rooms WHERE id = ANY(v_distinct_rooms) AND hotel_id <> v_hotel_id
    ) THEN
        RAISE EXCEPTION 'Bulk operations must target rooms from the same hotel.';
    END IF;

    IF (SELECT count(*) FROM rooms WHERE id = ANY(v_distinct_rooms)) != array_length(v_distinct_rooms, 1) THEN
        RAISE EXCEPTION 'One or more room IDs do not exist in the database';
    END IF;

    -- 3. Authorization Guard (Reusing standardized helper)
    IF NOT public.has_hotel_role(
        auth.uid(),
        v_hotel_id,
        ARRAY['OWNER', 'ADMIN', 'GENERAL_MANAGER', 'SUPERVISOR', 'HOUSEKEEPING_MANAGER', 'HOUSEKEEPING_SUPERVISOR']
    ) THEN
        RAISE EXCEPTION 'Unauthorized: you do not have supervisor-level permission to override housekeeping status.';
    END IF;

    -- 4. Set-Based Update: Cancel Active Tasks
    IF p_new_status IN ('clean', 'inspected') THEN
        UPDATE housekeeping_tasks
        SET status = 'cancelled_by_supervisor',
            completed_at = now()
        WHERE room_id = ANY(v_distinct_rooms)
        AND status IN ('pending', 'in_progress')
        AND hotel_id = v_hotel_id;
    END IF;

    -- 5 & 6. Set-Based Update & Audit Logging (Combined in one atomic CTE query)
    -- Securely capture the old status BEFORE the update happens and prevent no-op updates
    WITH target_rooms AS (
        SELECT id, hotel_id, housekeeping_status AS old_status
        FROM rooms
        WHERE id = ANY(v_distinct_rooms)
        AND housekeeping_status IS DISTINCT FROM v_new_status_enum
    ),
    updated_rooms AS (
        UPDATE rooms r
        SET housekeeping_status = v_new_status_enum,
            is_out_of_order = (p_new_status = 'out_of_order'),
            updated_at = now()
        FROM target_rooms t
        WHERE r.id = t.id
        RETURNING r.id, t.hotel_id, t.old_status
    ),
    log_events AS (
        INSERT INTO housekeeping_events (hotel_id, room_id, old_status, new_status, changed_by, event_type, details)
        SELECT
            hotel_id,
            id,
            old_status,
            v_new_status_enum,
            auth.uid(),
            'BULK_SUPERVISOR_OVERRIDE',
            jsonb_build_object(
                'reason', COALESCE(p_reason, 'Bulk supervisor override'),
                'override', true,
                'bulk', true
            )
        FROM updated_rooms
        RETURNING 1
    )
    SELECT count(*) INTO v_updated_count FROM updated_rooms;

    RETURN jsonb_build_object('success', true, 'rooms_affected', v_updated_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.hk_bulk_supervisor_override(UUID[], TEXT, TEXT) TO authenticated;

COMMIT;
