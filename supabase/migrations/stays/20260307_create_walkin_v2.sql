-- ============================================================
-- CONSOLIDATED WALK-IN RPC (v2) & ROOM PROTECTION
-- ============================================================

-- ── 1. Global Guest Index (Performance) ──
-- Optimized for deterministic lookup by mobile + oldest record.
CREATE INDEX IF NOT EXISTS idx_guests_mobile_created ON guests(mobile, created_at);

-- ── 2. Room Overlap Protection (Database Level) ──
-- Enable btree_gist extension (required for exclusion constraints)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Optimized GiST Index for Stay Overlap Scans
-- Uses the same operator class as the exclusion constraint for maximum planner efficiency.
CREATE INDEX IF NOT EXISTS idx_stays_room_time_gist
ON stays 
USING gist (
  room_id,
  tstzrange(scheduled_checkin_at, scheduled_checkout_at, '[)')
);

-- Exclusion Constraint: No Room Overlap (STAYS)
ALTER TABLE stays DROP CONSTRAINT IF EXISTS no_room_overlap;
ALTER TABLE stays ADD CONSTRAINT no_room_overlap
EXCLUDE USING gist (
  room_id WITH =,
  tstzrange(scheduled_checkin_at, scheduled_checkout_at, '[)') WITH &&
)
WHERE (status IN ('arriving', 'inhouse'));

-- Unique Index: No Double Check-in (BOOKING_ROOMS)
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_room
ON booking_rooms(room_id)
WHERE (status = 'CHECKED_IN');

-- ── 3. Cleanup Old Variants ──
DROP FUNCTION IF EXISTS public.create_walkin(UUID, JSONB, UUID, INT, UUID);
DROP FUNCTION IF EXISTS public.create_walkin(UUID, JSONB, UUID, DATE, DATE, INT, INT, UUID);
DROP FUNCTION IF EXISTS public.create_walkin(uuid, uuid, uuid, date, date, jsonb, numeric, text);
DROP FUNCTION IF EXISTS public.create_walkin_v2(uuid, jsonb, jsonb, date, date, integer, integer, uuid);

-- ── 4. Create create_walkin_v2 ──
CREATE OR REPLACE FUNCTION public.create_walkin_v2(
  p_hotel_id uuid, 
  p_guest_details jsonb, 
  p_room_selections jsonb, 
  p_checkin_date date, 
  p_checkout_date date, 
  p_adults integer DEFAULT 1, 
  p_children integer DEFAULT 0, 
  p_actor_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_guest_id UUID;
  v_booking_id UUID;
  v_booking_room_id UUID;
  v_stay_id UUID;
  v_booking_code TEXT;
  v_checkin_ts TIMESTAMPTZ;
  v_checkout_ts TIMESTAMPTZ;
  v_room_id UUID;
  v_room_type_id UUID;
  v_stay_ids UUID[] := '{}';
  v_rooms_count INT;
  v_first_room_id UUID;
  v_first_room_type_id UUID;
BEGIN
  -- ── 1. Validate Input ──
  IF p_room_selections IS NULL OR jsonb_array_length(p_room_selections) = 0 THEN
    RAISE EXCEPTION 'At least one room selection is required';
  END IF;
  v_rooms_count := jsonb_array_length(p_room_selections);

  IF coalesce(trim(p_guest_details->>'full_name'),'') = '' THEN
    RAISE EXCEPTION 'Guest name required';
  END IF;

  -- ── 2. Compute & Validate Timestamps ──
  IF p_checkin_date = CURRENT_DATE THEN
    v_checkin_ts := now();
  ELSE
    v_checkin_ts := (p_checkin_date || ' 14:00:00')::timestamptz;
  END IF;

  v_checkout_ts := (p_checkout_date || ' 11:00:00')::timestamptz;

  IF v_checkout_ts <= v_checkin_ts THEN
    RAISE EXCEPTION 'Checkout must be after checkin';
  END IF;

  -- ── 3. Room Validation & Pre-loop Safety ──
  -- Validate no duplicate rooms in the input array
  IF (
    SELECT COUNT(DISTINCT room_id)
    FROM jsonb_to_recordset(p_room_selections) AS r(room_id UUID)
  ) != v_rooms_count THEN
    RAISE EXCEPTION 'Duplicate rooms selected';
  END IF;

  -- Extract first room for header-level compatibility
  SELECT room_id, room_type_id 
  INTO v_first_room_id, v_first_room_type_id
  FROM jsonb_to_recordset(p_room_selections) AS r(room_id UUID, room_type_id UUID)
  LIMIT 1;

  -- ── Validate Header Room Existence, Hotel Association & Resolve Type ──
  SELECT room_type_id
  INTO v_first_room_type_id
  FROM rooms
  WHERE id = v_first_room_id
  AND hotel_id = p_hotel_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid room % or does not belong to hotel', v_first_room_id;
  END IF;

  -- ── 4. Create/Upsert Guest (Modular) ──
  v_guest_id := public.upsert_guest_v2(p_guest_details);

  -- ── 5. Guest Idempotency Lock ──
  -- Prevents concurrent double walk-in bookings for the same guest
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_hotel_id::text || ':' || v_guest_id::text, 0)
  );

  -- ── 6. Create Booking ──
  v_booking_code := 'W-' || to_char(now(), 'YYMMDDHH24MISS') || '-' || substring(gen_random_uuid()::text, 1, 4);

  INSERT INTO bookings (
    hotel_id, guest_id, guest_name, phone, email,
    status, source, code,
    scheduled_checkin_at, scheduled_checkout_at,
    adults, children,
    adults_total, children_total,
    rooms_total,
    room_id, room_type_id
  ) VALUES (
    p_hotel_id, v_guest_id,
    p_guest_details->>'full_name', p_guest_details->>'mobile', p_guest_details->>'email',
    'CONFIRMED', 'walk_in', v_booking_code,
    v_checkin_ts, v_checkout_ts,
    p_adults, p_children,
    p_adults, p_children,
    v_rooms_count,
    v_first_room_id, v_first_room_type_id
  ) RETURNING id INTO v_booking_id;

  -- ── 7. Process Each Room (Loop) ──
  -- Optimized: Use jsonb_to_recordset to parse JSON once and loop over typed records
  FOR v_room_id IN 
    SELECT room_id 
    FROM jsonb_to_recordset(p_room_selections) AS r(room_id UUID)
  LOOP
    -- 7a. Room Advisory Lock (Concurrency Safety)
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_hotel_id::text || ':' || v_room_id::text, 0)
    );

    -- 7b. Validate room, lock it (row-level), and resolve room_type_id in one hit
    SELECT room_type_id
    INTO v_room_type_id
    FROM rooms
    WHERE id = v_room_id
    AND hotel_id = p_hotel_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Room % does not belong to hotel', v_room_id;
    END IF;

    -- 7d. Create booking_room
    INSERT INTO booking_rooms (
      booking_id, hotel_id, room_type_id, room_id, status
    ) VALUES (
      v_booking_id, p_hotel_id, v_room_type_id, v_room_id, 'CHECKED_IN'
    ) RETURNING id INTO v_booking_room_id;

    -- 7e. Create stay (linked to booking_room)
    INSERT INTO stays (
      hotel_id, guest_id, room_id, booking_id, booking_room_id,
      booking_code, status, source,
      scheduled_checkin_at, scheduled_checkout_at, actual_checkin_at
    ) VALUES (
      p_hotel_id, v_guest_id, v_room_id, v_booking_id, v_booking_room_id,
      v_booking_code, 'inhouse', 'walk_in',
      v_checkin_ts, v_checkout_ts, now()
    ) RETURNING id INTO v_stay_id;

    v_stay_ids := array_append(v_stay_ids, v_stay_id);

    -- 7f. Log event per room
    INSERT INTO checkin_events (stay_id, event_type, actor_id, meta)
    VALUES (
      v_stay_id, 'COMPLETED', p_actor_id,
      jsonb_build_object(
        'method', 'walk_in',
        'actor_id', p_actor_id,
        'device', 'kiosk',
        'hotel_id', p_hotel_id,
        'room_id', v_room_id,
        'booking_room_id', v_booking_room_id,
        'rooms_total', v_rooms_count
      )
    );
  END LOOP;

  -- ── 8. Transition Booking to CHECKED_IN ──
  -- This satisfies the trigger that requires a stay record before status update.
  UPDATE bookings
  SET
    status = 'CHECKED_IN',
    checked_in_at = now()
  WHERE id = v_booking_id;

  RETURN jsonb_build_object(
    'stay_ids', to_jsonb(v_stay_ids),
    'booking_id', v_booking_id,
    'booking_code', v_booking_code,
    'rooms_checked_in', v_rooms_count,
    'status', 'SUCCESS'
  );
EXCEPTION
  WHEN exclusion_violation THEN
    -- Covers both stays overlap and unique_active_room constraint
    RAISE EXCEPTION 'One or more selected rooms are currently busy or checked-in';
  WHEN OTHERS THEN
    RAISE;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_walkin_v2(uuid, jsonb, jsonb, date, date, integer, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_walkin_v2(uuid, jsonb, jsonb, date, date, integer, integer, uuid) TO service_role;
