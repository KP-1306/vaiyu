-- Authorization guard on the check-in RPCs (auth sweep, batch 1 — 2026-06-14).
--
-- Found in the post-checkout authorization sweep: process_checkin and
-- process_checkin_v2 are SECURITY DEFINER, granted to PUBLIC (anon), with NO
-- authorization guard and a trusted p_actor_id (used only for logging). Same
-- class as the checkout self-checkout hole: an anonymous caller (public anon
-- key) or any authenticated non-member could check in ANY booking to ANY room
-- given its UUIDs. Correctness (double-checkin idempotency, overlap guards,
-- folio handling — OTA bookings are prepaid, ₹0 by design) is sound; only the
-- authorization was missing.
--
-- Fix: guard against the booking's real hotel (member / platform admin / trusted
-- backend) and revoke EXECUTE from PUBLIC + anon. Both functions reproduced from
-- their audited live definitions with only the guard inserted.

CREATE OR REPLACE FUNCTION public.process_checkin(p_booking_id uuid, p_guest_details jsonb, p_room_id uuid DEFAULT NULL::uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_guest_id UUID;
  v_stay_id UUID;
  v_booking bookings%ROWTYPE;
BEGIN
  -- 1. Validate Booking (Concurrency Lock)
  -- Global Advisory Lock (Cluster Safety - Stable 64-bit hash)
  PERFORM pg_advisory_xact_lock(hashtextextended(p_booking_id::text, 0));

  SELECT * INTO v_booking
  FROM bookings
  WHERE id = p_booking_id
  FOR UPDATE;
  
  IF v_booking.id IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF v_booking.hotel_id IS NULL THEN
     RAISE EXCEPTION 'Booking missing hotel association';
  END IF;

  -- Authorization (added 2026-06-14): check-in is a staff / back-office action.
  -- Authorize against the booking's REAL hotel. auth.uid() IS NULL = trusted
  -- backend context (pg_cron / service_role have no JWT 'sub'); anon is revoked
  -- at the GRANT layer below, so a null uid here is never an anonymous caller.
  -- This blocks an anonymous or non-member caller from checking in any booking.
  IF auth.uid() IS NOT NULL
     AND NOT (public.vaiyu_is_hotel_member(v_booking.hotel_id) OR public.is_platform_admin())
  THEN
    RAISE EXCEPTION 'Not authorized to check in for this hotel'
        USING ERRCODE = 'insufficient_privilege';
  END IF;

  
  -- Idempotency: Check if stay already exists (Double-click protection)
  -- Cluster-safe check
  PERFORM 1
  FROM stays
  WHERE booking_id = p_booking_id
  AND status IN ('arriving', 'inhouse')
  FOR UPDATE;

  IF FOUND THEN
      -- Fetch ID safely
      SELECT id INTO v_stay_id FROM stays WHERE booking_id = p_booking_id AND status IN ('arriving', 'inhouse') LIMIT 1;
      RETURN jsonb_build_object('stay_id', v_stay_id, 'status', 'ALREADY_CHECKED_IN');
  END IF;
  
  IF v_booking.status NOT IN ('CREATED', 'CONFIRMED') THEN
    RAISE EXCEPTION 'Booking status % is not eligible for check-in', v_booking.status;
  END IF;

  IF v_booking.scheduled_checkout_at <= v_booking.scheduled_checkin_at THEN
     RAISE EXCEPTION 'Invalid booking time window';
  END IF;

  -- Room Validation & Lock (Critical)
  IF p_room_id IS NULL THEN
    RAISE EXCEPTION 'Room must be assigned before check-in';
  END IF;

  PERFORM 1 
  FROM rooms 
  WHERE id = p_room_id 
  AND hotel_id = v_booking.hotel_id 
  FOR UPDATE;
  
  IF NOT FOUND THEN
     RAISE EXCEPTION 'Room does not belong to the booking hotel';
  END IF;

  -- Overlap Guard (Defensive)
  PERFORM 1
  FROM stays
  WHERE room_id = p_room_id
  AND status IN ('arriving', 'inhouse')
  AND tstzrange(scheduled_checkin_at, scheduled_checkout_at, '[)')
      && tstzrange(v_booking.scheduled_checkin_at, v_booking.scheduled_checkout_at, '[)')
  FOR UPDATE;

  IF FOUND THEN
     RAISE EXCEPTION 'Room already occupied for the selected period';
  END IF;

  -- 2. Handle Guest (Smart Upsert)
  IF coalesce(trim(p_guest_details->>'full_name'),'') = '' THEN
     RAISE EXCEPTION 'Guest name required';
  END IF;

  -- Deduplicate by Mobile + Hotel if not provided
  IF v_booking.guest_id IS NOT NULL THEN
    v_guest_id := v_booking.guest_id;
  ELSE
    -- Try to find existing guest
    -- Normalize phone before lookup
    DECLARE
       v_input_phone TEXT := p_guest_details->>'mobile';
    BEGIN
       v_input_phone := regexp_replace(v_input_phone, '[^0-9]', '', 'g');
       
       SELECT id INTO v_guest_id
       FROM guests
       WHERE hotel_id = v_booking.hotel_id
       AND mobile = COALESCE(v_input_phone, v_booking.phone)
       LIMIT 1;
    
       IF v_guest_id IS NULL THEN
           INSERT INTO guests (hotel_id, full_name, mobile, email)
           VALUES (
               v_booking.hotel_id, 
               COALESCE(p_guest_details->>'full_name', v_booking.guest_name),
               COALESCE(v_input_phone, v_booking.phone),
               p_guest_details->>'email'
           )
           RETURNING id INTO v_guest_id;
       END IF;
    END;
    
    -- Link to booking
    UPDATE bookings SET guest_id = v_guest_id WHERE id = p_booking_id;
  END IF;

  -- 2b. Insert Guest Documents (Anti-spam)
  IF p_guest_details->>'front_image_path' IS NOT NULL THEN
    INSERT INTO guest_id_documents (guest_id, document_type, front_image_url, back_image_url, verification_status)
    SELECT
      v_guest_id,
      COALESCE((p_guest_details->>'id_type')::guest_document_type, 'other'),
      p_guest_details->>'front_image_path',
      p_guest_details->>'back_image_path',
      'pending'
    WHERE NOT EXISTS (
       SELECT 1
       FROM guest_id_documents
       WHERE guest_id = v_guest_id
       AND document_type = COALESCE((p_guest_details->>'id_type')::guest_document_type, 'other')
    );
  END IF;

  -- 3. Create Stay (Physical Occupancy)
  INSERT INTO stays (
    hotel_id,
    guest_id,
    room_id,
    booking_id,
    booking_code,
    status,
    scheduled_checkin_at,
    scheduled_checkout_at,
    actual_checkin_at,
    source
  ) VALUES (
    v_booking.hotel_id,
    v_guest_id,
    p_room_id,
    p_booking_id,
    v_booking.code,
    'inhouse', -- Immediately inhouse
    v_booking.scheduled_checkin_at,
    v_booking.scheduled_checkout_at,
    now(),
    'pms_sync'
  ) RETURNING id INTO v_stay_id;

  -- 4. Update Booking (Concurrency Safe)
  UPDATE bookings
  SET status = 'CHECKED_IN'
  WHERE id = p_booking_id
  AND status IN ('CREATED','CONFIRMED');

  IF NOT FOUND THEN
     RAISE EXCEPTION 'Booking state changed concurrently during check-in';
  END IF;

  -- 5. Log Event (Standardized)
  INSERT INTO checkin_events (stay_id, event_type, actor_id, meta)
  VALUES (
    v_stay_id, 
    'COMPLETED', 
    p_actor_id, 
    jsonb_build_object(
       'method', 'booking_checkin',
       'actor_id', p_actor_id,
       'device', 'kiosk',
       'hotel_id', v_booking.hotel_id,
       'room_id', p_room_id
    )
  );

  RETURN jsonb_build_object('stay_id', v_stay_id, 'status', 'SUCCESS');
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_checkin_v2(p_booking_id uuid, p_guest_details jsonb, p_room_assignments jsonb, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_guest_id UUID;
  v_stay_id UUID;
  v_booking bookings%ROWTYPE;
  v_assignment JSONB;
  v_br_id UUID;
  v_booking_id UUID;
  v_room_id UUID;
  v_stay_ids UUID[] := '{}';
  v_rooms_count INT;
  v_rooms_checked INT := 0;
BEGIN
  -- ── 1. Validate Input ──
  IF p_room_assignments IS NULL OR jsonb_array_length(p_room_assignments) = 0 THEN
    RAISE EXCEPTION 'At least one room assignment is required';
  END IF;
  v_rooms_count := jsonb_array_length(p_room_assignments);

  -- ── 2. Lock & Validate Booking ──
  PERFORM pg_advisory_xact_lock(hashtextextended(p_booking_id::text, 0));

  SELECT * INTO v_booking
  FROM bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF v_booking.id IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF v_booking.hotel_id IS NULL THEN
    RAISE EXCEPTION 'Booking missing hotel association';
  END IF;

  -- Authorization (added 2026-06-14): check-in is a staff / back-office action.
  -- Authorize against the booking's REAL hotel. auth.uid() IS NULL = trusted
  -- backend context (pg_cron / service_role have no JWT 'sub'); anon is revoked
  -- at the GRANT layer below, so a null uid here is never an anonymous caller.
  -- This blocks an anonymous or non-member caller from checking in any booking.
  IF auth.uid() IS NOT NULL
     AND NOT (public.vaiyu_is_hotel_member(v_booking.hotel_id) OR public.is_platform_admin())
  THEN
    RAISE EXCEPTION 'Not authorized to check in for this hotel'
        USING ERRCODE = 'insufficient_privilege';
  END IF;


  -- Use UPPERCASE for status checks
  IF v_booking.status NOT IN ('CREATED', 'CONFIRMED', 'PRE_CHECKED_IN', 'CHECKED_IN', 'PARTIALLY_CHECKED_IN') THEN
    RAISE EXCEPTION 'Booking status % is not eligible for check-in', v_booking.status;
  END IF;

  IF v_booking.scheduled_checkout_at <= v_booking.scheduled_checkin_at THEN
    RAISE EXCEPTION 'Invalid booking time window';
  END IF;

  -- ── 3. Handle Guest (Modular) ──
  IF coalesce(trim(p_guest_details->>'full_name'),'') = '' AND v_booking.guest_id IS NULL THEN
    RAISE EXCEPTION 'Guest name required for check-in';
  END IF;

  -- Use modular helper
  v_guest_id := public.upsert_guest_v2(p_guest_details);

  -- Link guest to booking if not already linked
  IF v_booking.guest_id IS NULL OR v_booking.guest_id != v_guest_id THEN
    UPDATE bookings SET guest_id = v_guest_id, updated_at = now() WHERE id = p_booking_id;
  END IF;

  -- ── 4. Pre-loop: Duplicate Guards ──
  IF (
    SELECT COUNT(DISTINCT (a->>'room_id'))
    FROM jsonb_array_elements(p_room_assignments) a
  ) != jsonb_array_length(p_room_assignments)
  THEN
    RAISE EXCEPTION 'Duplicate rooms assigned';
  END IF;

  IF (
    SELECT COUNT(DISTINCT (a->>'booking_room_id'))
    FROM jsonb_array_elements(p_room_assignments) a
  ) != jsonb_array_length(p_room_assignments)
  THEN
    RAISE EXCEPTION 'Duplicate booking_room_ids provided';
  END IF;

  -- ── 5. Process Each Room Assignment (Loop) ──
  FOR v_assignment IN SELECT * FROM jsonb_array_elements(p_room_assignments)
  LOOP
    v_br_id  := (v_assignment->>'booking_room_id')::UUID;
    v_room_id := (v_assignment->>'room_id')::UUID;

    -- 5a. Validate booking_room belongs to this booking
    PERFORM 1
    FROM booking_rooms
    WHERE id = v_br_id
    AND booking_id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'booking_room % does not belong to booking %', v_br_id, p_booking_id;
    END IF;

    -- 5a-ii. Room-level idempotency & Arriving Transition
    v_stay_id := NULL;
    
    -- Check for inhouse (already done)
    SELECT id INTO v_stay_id FROM stays 
    WHERE booking_room_id = v_br_id AND status = 'inhouse' LIMIT 1;

    IF v_stay_id IS NOT NULL THEN
      -- Already checked in
      v_stay_ids := array_append(v_stay_ids, v_stay_id);
      CONTINUE; 
    END IF;

    -- Check for arriving (transition needed)
    SELECT id INTO v_stay_id FROM stays 
    WHERE booking_room_id = v_br_id AND status = 'arriving'
    FOR UPDATE;

    IF v_stay_id IS NOT NULL THEN
      -- Critical: Validate room overlap before updating room_id (prevent race conditions)
      PERFORM 1
      FROM stays
      WHERE room_id = v_room_id
      AND (status = 'arriving' OR status = 'inhouse')
      AND booking_room_id <> v_br_id
      AND tstzrange(scheduled_checkin_at, scheduled_checkout_at, '[)')
          && tstzrange(v_booking.scheduled_checkin_at, v_booking.scheduled_checkout_at, '[)')
      FOR UPDATE;

      IF FOUND THEN
        RAISE EXCEPTION 'Room % already occupied for the selected period', v_room_id;
      END IF;

      -- Transition existing stay to inhouse
      UPDATE stays 
      SET status = 'inhouse', 
          actual_checkin_at = now(),
          room_id = v_room_id -- Ensure room matches assignment
      WHERE id = v_stay_id;
      
      -- Proceed to update booking_room below
    ELSE
      -- 5b. Validate room belongs to hotel (only if creating new or updating room)
      PERFORM 1
      FROM rooms
      WHERE id = v_room_id
      AND hotel_id = v_booking.hotel_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Room % does not belong to hotel', v_room_id;
      END IF;

      -- 5c. Overlap guard
      PERFORM 1
      FROM stays
      WHERE room_id = v_room_id
      AND (status = 'arriving' OR status = 'inhouse')
      AND tstzrange(scheduled_checkin_at, scheduled_checkout_at, '[)')
          && tstzrange(v_booking.scheduled_checkin_at, v_booking.scheduled_checkout_at, '[)')
      FOR UPDATE;

      IF FOUND THEN
        RAISE EXCEPTION 'Room % already occupied for the selected period', v_room_id;
      END IF;

      -- 5d. Create Stay (New)
      INSERT INTO stays (
        hotel_id, guest_id, room_id, booking_id, booking_room_id,
        booking_code, status, scheduled_checkin_at, scheduled_checkout_at,
        actual_checkin_at, source
      ) VALUES (
        v_booking.hotel_id, v_guest_id, v_room_id, p_booking_id, v_br_id,
        v_booking.code, 'inhouse', v_booking.scheduled_checkin_at,
        v_booking.scheduled_checkout_at, now(), 'arrival_checkin'
      ) RETURNING id INTO v_stay_id;
    END IF;

    v_stay_ids := array_append(v_stay_ids, v_stay_id);
    v_rooms_checked := v_rooms_checked + 1;

    -- 5e. Update booking_rooms (Source of Truth) - Use UPPERCASEstatus
    UPDATE booking_rooms
    SET room_id = v_room_id,
        status = 'CHECKED_IN',
        updated_at = now()
    WHERE id = v_br_id
    AND (
      room_id IS DISTINCT FROM v_room_id
      OR status IS DISTINCT FROM 'CHECKED_IN'
    );

    -- 5f. Log event per room
    INSERT INTO checkin_events (stay_id, event_type, actor_id, meta)
    VALUES (
      v_stay_id, 'COMPLETED', p_actor_id,
      jsonb_build_object(
        'method', 'multi_room_checkin',
        'actor_id', p_actor_id,
        'hotel_id', v_booking.hotel_id,
        'room_id', v_room_id,
        'booking_room_id', v_br_id
      )
    );
  END LOOP;

  -- ── 6. Update Booking Status ──
  IF EXISTS (
      SELECT 1
      FROM booking_rooms
      WHERE booking_id = p_booking_id
      AND status != 'CHECKED_IN'
  ) THEN
      UPDATE bookings
      SET status = 'PARTIALLY_CHECKED_IN',
          checked_in_at = COALESCE(checked_in_at, now()),
          updated_at = now()
      WHERE id = p_booking_id
      AND status != 'CHECKED_IN';
  ELSE
      UPDATE bookings
      SET status = 'CHECKED_IN',
          checked_in_at = COALESCE(checked_in_at, now()),
          updated_at = now()
      WHERE id = p_booking_id
      RETURNING id INTO v_booking_id;
  END IF;

  RETURN jsonb_build_object(
    'stay_ids', to_jsonb(v_stay_ids),
    'rooms_checked_in', v_rooms_checked,
    'rooms_total', v_rooms_count,
    'status', 'SUCCESS'
  );
END;
$function$;


-- Postgres grants EXECUTE to PUBLIC by default (anon inherits via PUBLIC), so
-- revoke from PUBLIC and re-grant only to the trusted roles.
REVOKE ALL ON FUNCTION public.process_checkin(uuid, jsonb, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_checkin(uuid, jsonb, uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.process_checkin_v2(uuid, jsonb, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_checkin_v2(uuid, jsonb, jsonb, uuid) TO authenticated, service_role;
