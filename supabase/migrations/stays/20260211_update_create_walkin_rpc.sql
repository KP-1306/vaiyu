-- Update create_walkin RPC with detailed parameters AND restored ID Logic
CREATE OR REPLACE FUNCTION create_walkin(
  p_hotel_id UUID,
  p_guest_details JSONB,
  p_room_id UUID,
  p_checkin_date DATE,
  p_checkout_date DATE,
  p_adults INT DEFAULT 1,
  p_children INT DEFAULT 0,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guest_id UUID;
  v_booking_id UUID;
  v_stay_id UUID;
  v_booking_code TEXT;
  v_checkin_ts TIMESTAMPTZ;
  v_checkout_ts TIMESTAMPTZ;
  v_clean_phone TEXT;
BEGIN
  -- 0. Validations
  IF p_room_id IS NULL THEN
     RAISE EXCEPTION 'Room ID required';
  END IF;

  PERFORM 1 
  FROM rooms 
  WHERE id = p_room_id 
  AND hotel_id = p_hotel_id 
  FOR UPDATE;
  
  IF NOT FOUND THEN
     RAISE EXCEPTION 'Room does not belong to the booking hotel';
  END IF;

  v_clean_phone := regexp_replace(p_guest_details->>'mobile', '[^0-9]', '', 'g');
  
  IF p_checkin_date = CURRENT_DATE THEN
      v_checkin_ts := now();
  ELSE
      v_checkin_ts := (p_checkin_date || ' 14:00:00')::timestamptz;
  END IF;
  
  v_checkout_ts := (p_checkout_date || ' 11:00:00')::timestamptz;

  IF v_checkout_ts <= v_checkin_ts THEN
     RAISE EXCEPTION 'Checkout must be after checkin';
  END IF;

  -- Overlap Guard
  PERFORM 1
  FROM stays
  WHERE room_id = p_room_id
  AND status IN ('arriving', 'inhouse')
  AND tstzrange(scheduled_checkin_at, scheduled_checkout_at, '[)')
      && tstzrange(v_checkin_ts, v_checkout_ts, '[)')
  FOR UPDATE;

  IF FOUND THEN
     RAISE EXCEPTION 'Room already occupied for the selected period';
  END IF;

  IF coalesce(trim(p_guest_details->>'full_name'),'') = '' THEN
     RAISE EXCEPTION 'Guest name required';
  END IF;

  -- 1. Create Guest (Smart Upsert)
  SELECT id INTO v_guest_id
  FROM guests
  WHERE hotel_id = p_hotel_id
  AND mobile = v_clean_phone
  LIMIT 1;

  IF v_guest_id IS NULL THEN
    INSERT INTO guests (hotel_id, full_name, mobile, email, nationality, address)
    VALUES (
      p_hotel_id,
      p_guest_details->>'full_name',
      v_clean_phone,
      p_guest_details->>'email',
      p_guest_details->>'nationality',
      p_guest_details->>'address'
    ) RETURNING id INTO v_guest_id;
  END IF;

  -- 1b. Insert Guest Documents (from original RPC)
  IF p_guest_details->>'front_image_path' IS NOT NULL AND p_guest_details->>'front_image_path' != '' THEN
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

  -- 2. Create Booking
  v_booking_code := 'W-' || to_char(now(), 'YYMMDD') || '-' || substring(gen_random_uuid()::text, 1, 6);

  INSERT INTO bookings (
    hotel_id, guest_id, guest_name, phone, email,
    status, source, code,
    scheduled_checkin_at, scheduled_checkout_at,
    adults, children
  ) VALUES (
    p_hotel_id, v_guest_id,
    p_guest_details->>'full_name', v_clean_phone, p_guest_details->>'email',
    'CHECKED_IN', 'walk_in', v_booking_code,
    v_checkin_ts, v_checkout_ts,
    p_adults, p_children
  ) RETURNING id INTO v_booking_id;

  -- 3. Create Stay
  INSERT INTO stays (
    hotel_id, guest_id, room_id, booking_id, booking_code,
    status, source,
    scheduled_checkin_at, scheduled_checkout_at, actual_checkin_at
  ) VALUES (
    p_hotel_id, v_guest_id, p_room_id, v_booking_id, v_booking_code,
    'inhouse', 'walk_in',
    v_checkin_ts, v_checkout_ts, now()
  ) RETURNING id INTO v_stay_id;

  -- 4. Log Event
  INSERT INTO checkin_events (stay_id, event_type, actor_id, meta)
  VALUES (
    v_stay_id, 'COMPLETED', p_actor_id, 
    jsonb_build_object(
       'method', 'walk_in', 'actor_id', p_actor_id,
       'device', 'kiosk', 'hotel_id', p_hotel_id, 'room_id', p_room_id
    )
  );

  RETURN jsonb_build_object(
    'stay_id', v_stay_id,
    'booking_id', v_booking_id,
    'booking_code', v_booking_code
  );
END;
$$;