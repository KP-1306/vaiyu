-- ── Performance Indices for Global Guest Lookup ──
CREATE INDEX IF NOT EXISTS idx_guests_mobile_normalized ON public.guests(mobile_normalized);
CREATE INDEX IF NOT EXISTS idx_guests_email_lower ON public.guests (lower(email));

-- ── Schema Alignment: Hardened Guest Doc Versioning ──
-- This migration previously standardized a rigid constraint; we now rely on 
-- the partial unique index defined in the base schema to support history.
DROP INDEX IF EXISTS uq_guest_doc_unique;
ALTER TABLE guest_id_documents DROP CONSTRAINT IF EXISTS uq_guest_id_doc_type;
-- Rigid constraint removed to support is_active versioning.

-- ── Cleanup Old Variants ──
DROP FUNCTION IF EXISTS public.upsert_guest_v2(jsonb, uuid);
DROP FUNCTION IF EXISTS public.process_checkin_v2(uuid, jsonb, jsonb, uuid);

-- Modular Guest Upsert (v2) - Global Identity Aware
CREATE OR REPLACE FUNCTION public.upsert_guest_v2(
    p_guest_details jsonb,
    p_hotel_id uuid DEFAULT NULL -- Historical context if needed, but guests are now global
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_guest_id UUID;
    v_mobile TEXT;
    v_email TEXT;
    v_mobile_norm TEXT;
    v_doc_type public.guest_document_type;
    v_full_name TEXT;
BEGIN
    -- 1. Normalize Inputs
    v_full_name := NULLIF(trim(COALESCE(p_guest_details->>'full_name', p_guest_details->>'guest_name')), '');
    v_mobile := NULLIF(regexp_replace(COALESCE(p_guest_details->>'mobile', p_guest_details->>'phone'), '[^0-9]', '', 'g'), '');
    v_email := NULLIF(lower(trim(p_guest_details->>'email')), '');
    v_mobile_norm := v_mobile; -- Character-stripping IS the normalization in this schema

    -- Mobile validation guard (from original create_walkin_v2)
    IF v_mobile_norm IS NOT NULL AND length(v_mobile_norm) < 6 THEN
      RAISE EXCEPTION 'A valid mobile number (min 6 digits) is required';
    END IF;

    -- 2. Lookup existing guest (Global)
    -- Priority 1: mobile_normalized
    IF v_mobile_norm IS NOT NULL AND v_mobile_norm != '' THEN
        SELECT id INTO v_guest_id FROM public.guests WHERE mobile_normalized = v_mobile_norm ORDER BY created_at LIMIT 1;
    END IF;

    -- Priority 2: email
    IF v_guest_id IS NULL AND v_email IS NOT NULL AND v_email != '' THEN
        SELECT id INTO v_guest_id FROM public.guests WHERE lower(email) = v_email ORDER BY created_at LIMIT 1;
    END IF;

    -- 3. Upsert Logic
    IF v_guest_id IS NOT NULL THEN
        UPDATE public.guests
        SET 
            full_name = COALESCE(NULLIF(v_full_name, ''), full_name),
            email = COALESCE(NULLIF(v_email, ''), email),
            mobile = COALESCE(NULLIF(v_mobile, ''), mobile),
            nationality = COALESCE(NULLIF(trim(p_guest_details->>'nationality'), ''), nationality),
            address = COALESCE(NULLIF(trim(p_guest_details->>'address'), ''), address),
            updated_at = now()
        WHERE id = v_guest_id;
    ELSE
        INSERT INTO public.guests (
            full_name, 
            mobile, 
            mobile_normalized,
            email, 
            nationality, 
            address
        )
        VALUES (
            COALESCE(v_full_name, 'Guest'), 
            v_mobile, 
            v_mobile_norm,
            v_email, 
            NULLIF(trim(p_guest_details->>'nationality'), ''), 
            NULLIF(trim(p_guest_details->>'address'), '')
        )
        ON CONFLICT (mobile) WHERE mobile IS NOT NULL 
        DO UPDATE SET
            full_name = EXCLUDED.full_name,
            email = COALESCE(EXCLUDED.email, guests.email),
            updated_at = now()
        RETURNING id INTO v_guest_id;
    END IF;

    -- 4. Hardened Identity Documents (Privacy & Concurrency Aware)
    IF coalesce(p_guest_details->>'front_image_path', '') != '' THEN
        -- Link doc type
        v_doc_type := COALESCE((p_guest_details->>'id_type')::guest_document_type, 'other');
        BEGIN
            -- IF duplicate exists with same front_hash and is active, skip insertion
            IF NOT EXISTS (
              SELECT 1 FROM public.guest_id_documents
              WHERE guest_id = v_guest_id
                AND document_type = v_doc_type
                AND front_hash = p_guest_details->>'front_hash'
                AND is_active = true
            ) THEN
                -- Deactivate previous active doc with concurrency lock
                UPDATE public.guest_id_documents
                SET is_active = false
                WHERE id IN (
                    SELECT id
                    FROM public.guest_id_documents
                    WHERE guest_id = v_guest_id
                      AND document_type = v_doc_type
                      AND is_active = true
                    FOR UPDATE
                );

                -- Insert New Hardened Document
                INSERT INTO public.guest_id_documents (
                    guest_id, 
                    document_type, 
                    document_number_masked, 
                    front_image_url, 
                    back_image_url, 
                    storage_key,
                    front_hash,
                    back_hash,
                    issuing_country,
                    verification_status, 
                    is_active
                )
                VALUES (
                    v_guest_id,
                    v_doc_type,
                    CASE 
                        WHEN length(p_guest_details->>'id_number') > 4
                        THEN repeat('X', length(p_guest_details->>'id_number') - 4) || right(p_guest_details->>'id_number', 4)
                        ELSE p_guest_details->>'id_number'
                    END,
                    p_guest_details->>'front_image_path',
                    p_guest_details->>'back_image_path',
                    NULLIF(p_guest_details->>'storage_key', '')::UUID,
                    p_guest_details->>'front_hash',
                    p_guest_details->>'back_hash',
                    p_guest_details->>'issuing_country',
                    'pending',
                    true
                );
            END IF;
        END;
    END IF;

    RETURN v_guest_id;
END;
$$;

-- Revision of process_checkin_v2 with UPPERCASE statuses to satisfy constraints
CREATE OR REPLACE FUNCTION public.process_checkin_v2(
    p_booking_id uuid, 
    p_guest_details jsonb, 
    p_room_assignments jsonb, 
    p_actor_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

-- ── Grants ──
GRANT EXECUTE ON FUNCTION public.upsert_guest_v2(jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_guest_v2(jsonb, uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.process_checkin_v2(uuid, jsonb, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_checkin_v2(uuid, jsonb, jsonb, uuid) TO service_role;
