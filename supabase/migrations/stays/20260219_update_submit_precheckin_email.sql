-- ============================================================
-- PRE-CHECK-IN EMAIL TRIGGER
-- Updates submit_precheckin function to queue an email on success
-- ============================================================

CREATE OR REPLACE FUNCTION submit_precheckin(
  p_token TEXT,
  p_data JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token_id UUID;
  v_booking_id UUID;
  v_used_at TIMESTAMPTZ;
  v_expires_at TIMESTAMPTZ;
  v_guest_id UUID;
  v_first_room_id UUID;
  v_mobile_normalized TEXT;
  v_hotel_id UUID;
BEGIN
  -- 1. Validate token
  -- 1. Validate token (with optimized Hotel ID lookup & lock)
  SELECT pt.id, pt.booking_id, pt.used_at, pt.expires_at, b.hotel_id
  INTO v_token_id, v_booking_id, v_used_at, v_expires_at, v_hotel_id
  FROM precheckin_tokens pt
  JOIN bookings b ON b.id = pt.booking_id
  WHERE pt.token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid token');
  END IF;

  IF v_used_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'booking_id', v_booking_id,
      'already_completed', true
    );
  END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'This link has expired');
  END IF;

  -- 1.1 Token is LOCKED by FOR UPDATE above.
  -- We will mark it used at the VERY END of the transaction to prevent partial failure.
  -- If this transaction fails (e.g. constraint violation), the token remains unused.

  -- 2. Resolve / Create Primary Guest Identity
  -- Lock booking row to prevent race conditions
  SELECT guest_id
  INTO v_guest_id
  FROM bookings 
  WHERE id = v_booking_id
  FOR UPDATE;

  IF v_guest_id IS NULL THEN
      -- Create new guest if missing (Fallback)
      -- Compute normalized mobile for consistent lookup/insert
      v_mobile_normalized := regexp_replace(NULLIF(p_data->>'phone', ''), '[^0-9]', '', 'g');

      -- 2A. Try to find by normalized mobile first (Deduplication Layer)
      IF v_mobile_normalized IS NOT NULL THEN
          SELECT id INTO v_guest_id 
          FROM guests 
          WHERE hotel_id = v_hotel_id
          AND mobile_normalized = v_mobile_normalized
          LIMIT 1;
      END IF;

      -- 2B. If still not found, Insert distinct guest
      IF v_guest_id IS NULL THEN
          INSERT INTO guests (hotel_id, full_name, email, mobile, nationality, address)
          VALUES (
              v_hotel_id,
              p_data->>'guest_name',
              NULLIF(p_data->>'email', ''),
              NULLIF(p_data->>'phone', ''),
              p_data->>'nationality',
              p_data->>'address'
          )
          ON CONFLICT (hotel_id, mobile) WHERE mobile IS NOT NULL 
          DO UPDATE SET
              full_name = EXCLUDED.full_name,
              email = COALESCE(EXCLUDED.email, guests.email),
              updated_at = now()
          RETURNING id INTO v_guest_id;
      END IF;
      
      -- If still null (race condition?), try fetch one last time
      IF v_guest_id IS NULL THEN
          SELECT id INTO v_guest_id FROM guests 
          WHERE hotel_id = v_hotel_id
          AND mobile = NULLIF(p_data->>'phone', '');
      END IF;
      
      -- Link to booking
      UPDATE bookings SET guest_id = v_guest_id WHERE id = v_booking_id;
  ELSE
      -- Update existing guest profile safely
      v_mobile_normalized := regexp_replace(NULLIF(p_data->>'phone', ''), '[^0-9]', '', 'g');
      
      UPDATE guests
      SET 
          full_name = COALESCE(p_data->>'guest_name', full_name),
          email = COALESCE(NULLIF(p_data->>'email', ''), email),
          mobile = COALESCE(NULLIF(p_data->>'phone', ''), mobile),
          nationality = COALESCE(p_data->>'nationality', nationality),
          address = COALESCE(p_data->>'address', address),
          updated_at = now()
      WHERE id = v_guest_id;
  END IF;

  -- 2.1 Safety Check: Ensure booking_rooms exist
  IF NOT EXISTS (SELECT 1 FROM booking_rooms WHERE booking_id = v_booking_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Booking has no assigned rooms. Please contact front desk.');
  END IF;

  -- 3. Update booking header
  UPDATE bookings
  SET
    guest_name = COALESCE(p_data->>'guest_name', guest_name),
    phone = COALESCE(p_data->>'phone', phone),
    email = COALESCE(p_data->>'email', email),
    status = 'PRE_CHECKED_IN',
    updated_at = now()
  WHERE id = v_booking_id;

  -- 4. Mark all rooms as PRE_CHECKED_IN
  UPDATE booking_rooms
  SET status = 'pre_checked_in', updated_at = now()
  WHERE booking_id = v_booking_id
  AND status = 'reserved';

  -- 5. Assign Primary Guest to ALL Rooms
  INSERT INTO booking_room_guests (booking_room_id, guest_id, is_primary)
  SELECT id, v_guest_id, true
  FROM booking_rooms
  WHERE booking_id = v_booking_id
  ON CONFLICT (booking_room_id) WHERE is_primary = true
  DO UPDATE SET guest_id = EXCLUDED.guest_id;

  -- 6. Assign Additional Guests to First Room (Placeholder)
  IF p_data->'additional_guests' IS NOT NULL AND jsonb_array_length(p_data->'additional_guests') > 0 THEN
      -- Get first room
      SELECT id INTO v_first_room_id
      FROM booking_rooms 
      WHERE booking_id = v_booking_id 
      ORDER BY room_seq ASC NULLS LAST, created_at ASC 
      LIMIT 1;

      IF v_first_room_id IS NOT NULL THEN
          BEGIN
              WITH new_guests AS (
                  INSERT INTO guests (hotel_id, full_name, mobile, is_vip, created_at, updated_at)
                  SELECT 
                      v_hotel_id,
                      g->>'name',
                      NULLIF(g->>'mobile', ''),
                      false,
                      now(),
                      now()
                  FROM jsonb_array_elements(p_data->'additional_guests') g
                  ON CONFLICT (hotel_id, mobile) WHERE mobile IS NOT NULL
                  DO UPDATE SET updated_at = now()
                  RETURNING id
              )
              INSERT INTO booking_room_guests (booking_room_id, guest_id, is_primary)
              SELECT v_first_room_id, id, false
              FROM new_guests
              ON CONFLICT (booking_room_id, guest_id) DO NOTHING;
          EXCEPTION WHEN OTHERS THEN
              RAISE WARNING 'Failed to add additional guests: %', SQLERRM;
          END;
      END IF;
  END IF;

  -- 7. Insert ID Document (Secure with Images)
  IF p_data->>'id_number' IS NOT NULL AND p_data->>'id_number' != '' THEN
      INSERT INTO guest_id_documents (
          guest_id, 
          document_type, 
          document_number, 
          front_image_url, 
          back_image_url, 
          verification_status
      )
      VALUES (
        v_guest_id,
        COALESCE((p_data->>'id_type')::guest_document_type, 'other'),
        p_data->>'id_number',
        p_data->>'front_image_url',
        p_data->>'back_image_url',
        'pending'
      )
      ON CONFLICT (guest_id, document_type) 
      DO UPDATE SET 
          document_number = EXCLUDED.document_number,
          front_image_url = COALESCE(EXCLUDED.front_image_url, guest_id_documents.front_image_url),
          back_image_url = COALESCE(EXCLUDED.back_image_url, guest_id_documents.back_image_url),
          verification_status = 'pending',
          updated_at = now();
  END IF;

  -- 8. Mark Token Used (Final Step - Atomic Commit)
  UPDATE precheckin_tokens
  SET
    precheckin_data = p_data,
    used_at = now(),
    updated_at = now()
  WHERE id = v_token_id;

  -- 9. Queue "Stay Portal Access" Email
  -- If email exists, queue a notification for magic link generation
  IF (p_data->>'email') IS NOT NULL AND (p_data->>'email') != '' THEN
    INSERT INTO public.notification_queue (booking_id, channel, template_code, payload, status)
    VALUES (
      v_booking_id,
      'email',
      'precheckin_completed_access',
      jsonb_build_object(
        'booking_id', v_booking_id,
        'guest_name', COALESCE(p_data->>'guest_name', 'Guest'),
        'email', p_data->>'email'
      ),
      'pending'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking_id,
    'guest_id', v_guest_id,
    'token', p_token,
    'qr_url', 'https://vaiyu.co.in/checkin?tkn=' || p_token,
    'completed_at', now()
  );
END;
$$;
