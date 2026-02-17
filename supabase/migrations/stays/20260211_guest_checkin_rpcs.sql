-- ============================================================
-- GUEST CHECK-IN SYSTEM RPCs
-- ============================================================

-- 1. Search Booking
-- ============================================================
CREATE OR REPLACE FUNCTION search_booking(
  p_query TEXT,
  p_hotel_id UUID,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  booking_id UUID,
  booking_code TEXT,
  status TEXT,
  guest_name TEXT,
  phone TEXT,
  email TEXT,
  scheduled_checkin_at TIMESTAMPTZ,
  scheduled_checkout_at TIMESTAMPTZ,
  room_type TEXT,
  hotel_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  p_query := trim(p_query);

  IF length(p_query) < 2 THEN
     RAISE EXCEPTION 'Search query too short';
  END IF;

  -- Limit Protection
  p_limit := LEAST(GREATEST(p_limit,1),50);

  RETURN QUERY
  SELECT
    b.id,
    b.code,
    b.status,
    b.guest_name,
    b.phone,
    p.email, -- via profile if linked
    b.scheduled_checkin_at,
    b.scheduled_checkout_at,
    NULL::text,
    b.hotel_id
  FROM bookings b
  LEFT JOIN profiles p ON b.guest_profile_id = p.id
  WHERE b.hotel_id = p_hotel_id
  AND (
    b.code ILIKE '%' || p_query || '%'
    OR b.phone ILIKE '%' || p_query || '%'
    OR p.email ILIKE '%' || p_query || '%'
  )
  AND b.status IN ('CREATED', 'CONFIRMED') -- Only searchable if not already checked in/cancelled
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION search_booking(TEXT, UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION search_booking(TEXT, UUID, INT) TO anon;


-- 2. Process Check-in (Strict Lifecycle)
-- ============================================================
-- Returns the new stay_id
CREATE OR REPLACE FUNCTION process_checkin(
  p_booking_id UUID,
  p_guest_details JSONB, -- {id, name, ...} if updating guest, or linking existing
  p_room_id UUID DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  
  IF v_booking.status NOT IN ('CREATED', 'CONFIRMED', 'PRE_CHECKED_IN') THEN
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
  AND status IN ('CREATED','CONFIRMED','PRE_CHECKED_IN');

  IF NOT FOUND THEN
     RAISE EXCEPTION 'Booking state changed concurrently during check-in';
  END IF;

  -- 4b. Persist Room Assignment to booking_rooms (Source of Truth)
  UPDATE booking_rooms
  SET room_id = p_room_id,
      status = 'checked_in',
      updated_at = now()
  WHERE booking_id = p_booking_id
  AND room_seq = 1;

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
$$;

GRANT EXECUTE ON FUNCTION process_checkin(UUID, JSONB, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION process_checkin(UUID, JSONB, UUID, UUID) TO service_role;


-- Moved to 20260217_create_walkin_v2.sql to handle checked_in_at dependency
-- CREATE OR REPLACE FUNCTION process_checkin_v2(...)


-- 3. Create Walk-in (Booking First)
-- ============================================================
CREATE OR REPLACE FUNCTION create_walkin(
  p_hotel_id UUID,
  p_guest_details JSONB,
  p_room_id UUID,
  p_duration_nights INT,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_phone TEXT;
  v_guest_id UUID;
  v_booking_id UUID;
  v_stay_id UUID;
  v_booking_code TEXT;
  v_checkin_ts TIMESTAMPTZ := now();
  v_checkout_ts TIMESTAMPTZ;
BEGIN
  IF p_duration_nights <= 0 THEN
     RAISE EXCEPTION 'Duration must be greater than zero';
  END IF;

  IF p_room_id IS NULL THEN
     RAISE EXCEPTION 'Room must be provided for walk-in';
  END IF;

  -- Room Lock (Concurrency Safety & Isolation)
  PERFORM 1 
  FROM rooms 
  WHERE id = p_room_id 
  AND hotel_id = p_hotel_id 
  FOR UPDATE;
  
  IF NOT FOUND THEN
     RAISE EXCEPTION 'Room does not belong to the booking hotel';
  END IF;

  v_clean_phone := regexp_replace(p_guest_details->>'mobile', '[^0-9]', '', 'g');
  v_checkout_ts := v_checkin_ts + (p_duration_nights || ' days')::interval;

  -- Overlap Guard (Defensive)
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

  IF v_checkout_ts <= v_checkin_ts THEN
     RAISE EXCEPTION 'Invalid checkout timestamp';
  END IF;

  -- 1. Create Guest (Smart Upsert)
  -- Deduplicate by Mobile + Hotel
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

  -- 1b. Insert Guest Documents (Anti-spam)
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

  -- 2. Create Booking (Walk-in source)
  -- Better Code Generation: W-YYMMDD-UUID6
  v_booking_code := 'W-' || to_char(now(), 'YYMMDD') || '-' || substring(gen_random_uuid()::text, 1, 6);

  INSERT INTO bookings (
    hotel_id,
    guest_id,
    guest_name,
    phone,
    status,
    source,
    code,
    scheduled_checkin_at,
    scheduled_checkout_at
  ) VALUES (
    p_hotel_id,
    v_guest_id,
    p_guest_details->>'full_name',
    v_clean_phone,
    'CHECKED_IN',
    'walk_in',
    v_booking_code,
    v_checkin_ts,
    v_checkout_ts
  ) RETURNING id INTO v_booking_id;

  -- 3. Create Stay
  INSERT INTO stays (
    hotel_id,
    guest_id,
    room_id,
    booking_id,
    booking_code,
    status,
    source,
    scheduled_checkin_at,
    scheduled_checkout_at,
    actual_checkin_at
  ) VALUES (
    p_hotel_id,
    v_guest_id,
    p_room_id,
    v_booking_id,
    v_booking_code,
    'inhouse',
    'walk_in',
    v_checkin_ts,
    v_checkout_ts,
    now()
  ) RETURNING id INTO v_stay_id;

  -- 4. Log Event (Standardized)
  INSERT INTO checkin_events (stay_id, event_type, actor_id, meta)
  VALUES (
    v_stay_id, 
    'COMPLETED', 
    p_actor_id, 
    jsonb_build_object(
       'method', 'walk_in', 
       'actor_id', p_actor_id,
       'device', 'kiosk',
       'hotel_id', p_hotel_id,
       'room_id', p_room_id
    )
  );

  RETURN jsonb_build_object(
    'stay_id', v_stay_id,
    'booking_id', v_booking_id,
    'booking_code', v_booking_code
  );
END;
$$;

GRANT EXECUTE ON FUNCTION create_walkin(UUID, JSONB, UUID, INT, UUID) TO authenticated;

-- Ensure Ownership for RLS Bypass
ALTER FUNCTION process_checkin(UUID, JSONB, UUID, UUID) OWNER TO postgres;
ALTER FUNCTION create_walkin(UUID, JSONB, UUID, INT, UUID) OWNER TO postgres;
ALTER FUNCTION search_booking(TEXT, UUID, INT) OWNER TO postgres;
