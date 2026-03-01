-- ============================================================
-- MIGRATION: 20260228_housekeeping_board.sql
-- Enterprise Housekeeping Operational Board
-- ============================================================

BEGIN;

-- ============================================================
-- 1. SCHEMA UPDATES
-- ============================================================

-- Extend housekeeping_status_enum with 'in_progress' (idempotent)
DO $$ BEGIN
    ALTER TYPE housekeeping_status_enum ADD VALUE IF NOT EXISTS 'in_progress';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- rooms: add out-of-order flag (if not exists)
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS is_out_of_order BOOLEAN DEFAULT false;

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

-- Performance: composite index for board view (hotel + status filter)
CREATE INDEX IF NOT EXISTS idx_rooms_hotel_status ON rooms(hotel_id, housekeeping_status);


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
    WHERE room_id = p_room_id AND status IN ('pending', 'in_progress');

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

    -- Block if room not currently being cleaned
    IF v_old_status <> 'in_progress'::housekeeping_status_enum THEN
        RAISE EXCEPTION 'Room is not currently being cleaned.';
    END IF;

    -- Pause active task
    UPDATE housekeeping_tasks
    SET status = 'pending'
    WHERE room_id = p_room_id AND status = 'in_progress'
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

    -- Cancel any active tasks
    UPDATE housekeeping_tasks
    SET status = 'cancelled', completed_at = now()
    WHERE room_id = p_room_id AND status IN ('pending', 'in_progress');

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

    -- Cancel any active tasks if overriding to clean/inspected
    IF p_new_status IN ('clean', 'inspected') THEN
        UPDATE housekeeping_tasks
        SET status = 'completed', completed_at = now()
        WHERE room_id = p_room_id AND status IN ('pending', 'in_progress');
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
CREATE OR REPLACE FUNCTION public.hk_bulk_assign(
    p_room_ids UUID[],
    p_staff_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_room RECORD;
    v_task_id UUID;
    v_old_assignee UUID;
BEGIN
    IF array_length(p_room_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'No rooms provided';
    END IF;

    FOR v_room IN
        SELECT id, hotel_id, housekeeping_status
        FROM rooms WHERE id = ANY(p_room_ids) FOR UPDATE
    LOOP
        IF v_room.housekeeping_status IN ('out_of_order', 'clean', 'inspected') THEN
            CONTINUE;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM hotel_members
            WHERE id = p_staff_id AND hotel_id = v_room.hotel_id
        ) THEN
            RAISE EXCEPTION 'Staff does not belong to hotel %', v_room.hotel_id;
        END IF;

        SELECT id, assigned_to INTO v_task_id, v_old_assignee
        FROM housekeeping_tasks
        WHERE room_id = v_room.id AND status IN ('pending','in_progress')
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

        IF v_task_id IS NULL THEN
            INSERT INTO housekeeping_tasks (room_id, hotel_id, status, assigned_to, priority_score)
            VALUES (v_room.id, v_room.hotel_id, 'pending', p_staff_id, 0)
            RETURNING id INTO v_task_id;
        ELSE
            UPDATE housekeeping_tasks SET assigned_to = p_staff_id WHERE id = v_task_id;
        END IF;

        INSERT INTO housekeeping_events (hotel_id, room_id, old_status, new_status, changed_by, event_type, details)
        VALUES (v_room.hotel_id, v_room.id, v_room.housekeeping_status, v_room.housekeeping_status, auth.uid(),
                'BULK_TASK_ASSIGNED', jsonb_build_object('task_id', v_task_id, 'staff_id', p_staff_id, 'old_assignee', v_old_assignee, 'bulk', true));
    END LOOP;

    RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.hk_bulk_assign(UUID[], UUID) TO authenticated;

-- 8b. Bulk Start Cleaning
CREATE OR REPLACE FUNCTION public.hk_bulk_start_cleaning(p_room_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_room RECORD;
    v_task_id UUID;
BEGIN
    IF array_length(p_room_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'No rooms provided';
    END IF;

    FOR v_room IN
        SELECT id, hotel_id, housekeeping_status
        FROM rooms WHERE id = ANY(p_room_ids) FOR UPDATE
    LOOP
        IF v_room.housekeeping_status IN ('clean','inspected','out_of_order') THEN
            CONTINUE;
        END IF;

        UPDATE housekeeping_tasks SET status = 'cancelled', completed_at = now()
        WHERE room_id = v_room.id AND status IN ('pending','in_progress');

        INSERT INTO housekeeping_tasks (room_id, hotel_id, status, started_at, priority_score)
        VALUES (v_room.id, v_room.hotel_id, 'in_progress', now(), 0)
        RETURNING id INTO v_task_id;

        UPDATE rooms SET housekeeping_status = 'in_progress', updated_at = now() WHERE id = v_room.id;

        INSERT INTO housekeeping_events (hotel_id, room_id, old_status, new_status, changed_by, event_type, details)
        VALUES (v_room.hotel_id, v_room.id, v_room.housekeeping_status, 'in_progress', auth.uid(),
                'BULK_CLEANING_STARTED', jsonb_build_object('task_id', v_task_id, 'bulk', true));
    END LOOP;

    RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.hk_bulk_start_cleaning(UUID[]) TO authenticated;

-- 8c. Bulk Complete Cleaning
CREATE OR REPLACE FUNCTION public.hk_bulk_complete_cleaning(p_room_ids UUID[], p_final_status TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_room RECORD;
    v_task_id UUID;
BEGIN
    IF p_final_status NOT IN ('clean','inspected') THEN
        RAISE EXCEPTION 'Invalid final status';
    END IF;

    FOR v_room IN
        SELECT id, hotel_id, housekeeping_status
        FROM rooms WHERE id = ANY(p_room_ids) FOR UPDATE
    LOOP
        IF v_room.housekeeping_status <> 'in_progress' THEN CONTINUE; END IF;

        UPDATE housekeeping_tasks SET status = 'completed', completed_at = now()
        WHERE id = (SELECT id FROM housekeeping_tasks WHERE room_id = v_room.id AND status IN ('pending','in_progress') ORDER BY created_at DESC LIMIT 1)
        RETURNING id INTO v_task_id;

        UPDATE rooms SET housekeeping_status = p_final_status::housekeeping_status_enum, is_out_of_order = false, updated_at = now() WHERE id = v_room.id;

        INSERT INTO housekeeping_events (hotel_id, room_id, old_status, new_status, changed_by, event_type, details)
        VALUES (v_room.hotel_id, v_room.id, v_room.housekeeping_status, p_final_status::housekeeping_status_enum, auth.uid(),
                'BULK_CLEANING_COMPLETED', jsonb_build_object('task_id', v_task_id, 'bulk', true));
    END LOOP;

    RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.hk_bulk_complete_cleaning(UUID[], TEXT) TO authenticated;

-- 8d. Bulk Mark Out of Order
CREATE OR REPLACE FUNCTION public.hk_bulk_mark_out_of_order(p_room_ids UUID[], p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_room RECORD;
BEGIN
    FOR v_room IN
        SELECT id, hotel_id, housekeeping_status
        FROM rooms WHERE id = ANY(p_room_ids) FOR UPDATE
    LOOP
        UPDATE housekeeping_tasks SET status = 'cancelled', completed_at = now()
        WHERE room_id = v_room.id AND status IN ('pending','in_progress');

        UPDATE rooms SET housekeeping_status = 'out_of_order', is_out_of_order = true, updated_at = now() WHERE id = v_room.id;

        INSERT INTO housekeeping_events (hotel_id, room_id, old_status, new_status, changed_by, event_type, details)
        VALUES (v_room.hotel_id, v_room.id, v_room.housekeeping_status, 'out_of_order', auth.uid(),
                'BULK_MARKED_OUT_OF_ORDER', jsonb_build_object('reason', p_reason, 'bulk', true));
    END LOOP;

    RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.hk_bulk_mark_out_of_order(UUID[], TEXT) TO authenticated;


COMMIT;
