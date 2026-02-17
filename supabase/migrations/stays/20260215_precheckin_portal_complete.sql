-- ============================================================
-- PRE-CHECK-IN PORTAL — CONSOLIDATED MIGRATION
-- 
-- Merged from:
--   • 20260212_precheckin_tokens.sql (table, RLS, RPCs)
--   • 20260216_precheckin_multiroom_fix.sql (Multi-room, Kiosk, Privacy)
--
-- Supports:
--   • Unique cryptographic tokens per booking
--   • Multi-room check-in & verification
--   • Private Identity Proof Storage (GDPR/Compliance)
--   • Fast-Track QR Check-In
--   • Guest Reminders
-- ============================================================


-- ============================================================
-- 1. PRECHECKIN_TOKENS TABLE & BASIC RLS
-- ============================================================
CREATE TABLE IF NOT EXISTS precheckin_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),

  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,            -- NULL until guest completes pre-check-in

  -- Guest submission data (filled by submit_precheckin RPC)
  precheckin_data JSONB,

  -- Multi-tenant locality (Added in Multi-room fix)
  hotel_id UUID REFERENCES hotels(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_precheckin_booking UNIQUE (booking_id)
);

-- Backfill hotel_id if missing (for existing tokens)
UPDATE precheckin_tokens pt
SET hotel_id = b.hotel_id
FROM bookings b
WHERE b.id = pt.booking_id
  AND pt.hotel_id IS NULL;

-- Enforce integrity
ALTER TABLE precheckin_tokens ALTER COLUMN hotel_id SET NOT NULL;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_precheckin_tokens_token
  ON precheckin_tokens (hotel_id, token);

CREATE INDEX IF NOT EXISTS idx_precheckin_tokens_booking
  ON precheckin_tokens (booking_id);

CREATE INDEX IF NOT EXISTS idx_precheckin_tokens_active
  ON precheckin_tokens (hotel_id, token)
  WHERE used_at IS NULL;


-- ============================================================
-- 2. RLS POLICIES
-- ============================================================
ALTER TABLE precheckin_tokens ENABLE ROW LEVEL SECURITY;

-- Public can read tokens (validation is done in RPC with SECURITY DEFINER)
DROP POLICY IF EXISTS "Public read precheckin tokens" ON precheckin_tokens;
CREATE POLICY "Public read precheckin tokens"
ON precheckin_tokens FOR SELECT USING (true);

-- Only server/service role can write
DROP POLICY IF EXISTS "Service write precheckin tokens" ON precheckin_tokens;
DROP POLICY IF EXISTS "Service role manages tokens" ON precheckin_tokens;
CREATE POLICY "Service role manages tokens"
ON precheckin_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Staff can view tokens for their hotel's bookings
DROP POLICY IF EXISTS "Staff can view tokens" ON precheckin_tokens;
CREATE POLICY "Staff can view tokens"
ON precheckin_tokens FOR SELECT TO authenticated
USING (
     EXISTS (
        SELECT 1 FROM public.bookings b
        JOIN public.hotels h ON b.hotel_id = h.id
        WHERE b.id = precheckin_tokens.booking_id
        AND EXISTS (
             SELECT 1 FROM public.hotel_members hm
             WHERE hm.hotel_id = h.id
             AND hm.user_id = auth.uid()
        )
    )
);


-- ============================================================
-- 3. SCHEMA ENHANCEMENTS (Status, Mobile, Rooms)
-- ============================================================

-- 3a. Add 'PRE_CHECKED_IN' status
ALTER TABLE public.bookings
DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings
ADD CONSTRAINT bookings_status_check
CHECK (status IN ('CREATED', 'CONFIRMED', 'PRE_CHECKED_IN', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW', 'COMPLETED'));

ALTER TABLE public.booking_rooms
DROP CONSTRAINT IF EXISTS booking_rooms_status_check;
ALTER TABLE public.booking_rooms
ADD CONSTRAINT booking_rooms_status_check
CHECK (status IN ('reserved', 'pre_checked_in', 'checked_in', 'cancelled'));

-- 3b. Add updated_at to booking_rooms
ALTER TABLE public.booking_rooms
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 3c. Guest Identity Indexes
CREATE INDEX IF NOT EXISTS idx_guests_mobile_norm
ON public.guests (hotel_id, mobile_normalized);

-- Partial unique index for ON CONFLICT support
CREATE UNIQUE INDEX IF NOT EXISTS uq_guests_mobile
ON public.guests (hotel_id, mobile)
WHERE mobile IS NOT NULL;

-- 3d. Performance Indexes for lookups
CREATE INDEX IF NOT EXISTS idx_bookings_code ON bookings (hotel_id, code);
CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings (hotel_id, phone);
CREATE INDEX IF NOT EXISTS idx_booking_rooms_booking ON booking_rooms (booking_id);


-- ============================================================
-- 4. RPC: validate_precheckin_token (Fast-Track QR Support)
-- Purpose: Validate token and return booking details
-- ============================================================
CREATE OR REPLACE FUNCTION validate_precheckin_token(
  p_token TEXT,
  p_hotel_id UUID DEFAULT NULL,
  p_ignore_usage BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token_record RECORD;
BEGIN
  -- Find valid token (with concurrency lock - Blocking FOR UPDATE to ensure consistency)
  SELECT
    pt.id AS token_id,
    pt.booking_id,
    pt.expires_at,
    pt.used_at,
    pt.precheckin_data,
    b.code AS booking_code,
    b.guest_name,
    COALESCE(g.mobile, b.phone) AS phone,
    COALESCE(g.email, b.email, (SELECT email FROM profiles WHERE id = b.guest_profile_id)) AS email,
    b.scheduled_checkin_at,
    b.scheduled_checkout_at,
    b.status AS booking_status,
    b.adults_total,
    b.children_total,
    b.rooms_total,
    h.id AS hotel_id,
    h.name AS hotel_name,
    (SELECT rt.name FROM booking_rooms br
     JOIN room_types rt ON rt.id = br.room_type_id
     WHERE br.booking_id = b.id
     ORDER BY br.room_seq LIMIT 1) AS room_type_name,
    (SELECT br.room_type_id FROM booking_rooms br
     WHERE br.booking_id = b.id
     ORDER BY br.room_seq LIMIT 1) AS room_type_id,
    (SELECT br.room_id FROM booking_rooms br
     WHERE br.booking_id = b.id
     ORDER BY br.room_seq LIMIT 1) AS room_id,
    g.nationality,
    g.address,
    (SELECT jsonb_build_object(
        'type', gid.document_type,
        'number', gid.document_number,
        'front_image', gid.front_image_url,
        'back_image', gid.back_image_url
     )
     FROM guest_id_documents gid
     WHERE gid.guest_id = b.guest_id
     ORDER BY gid.updated_at DESC LIMIT 1
    ) AS identity_proof
  INTO v_token_record
  FROM precheckin_tokens pt
  JOIN bookings b ON b.id = pt.booking_id
  JOIN hotels h ON h.id = b.hotel_id
  LEFT JOIN guests g ON g.id = b.guest_id
  WHERE pt.token = p_token
    AND (p_hotel_id IS NULL OR pt.hotel_id = p_hotel_id)
  FOR UPDATE OF pt;

  -- Token not found
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Invalid token'
    );
  END IF;

  -- Token already used (Bypass if p_ignore_usage is TRUE)
  IF v_token_record.used_at IS NOT NULL AND NOT p_ignore_usage THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Pre-check-in already completed',
      'completed_at', v_token_record.used_at
    );
  END IF;

  -- Token expired (NEVER bypassed by p_ignore_usage)
  IF v_token_record.expires_at IS NOT NULL 
     AND v_token_record.expires_at < now() THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'This link has expired'
    );
  END IF;

  -- Valid — return booking details
  RETURN jsonb_build_object(
    'valid', true,
    'token_id', v_token_record.token_id,
    'booking_id', v_token_record.booking_id,
    'id', v_token_record.booking_id,
    'code', v_token_record.booking_code,
    'booking_code', v_token_record.booking_code,
    'guest_name', v_token_record.guest_name,
    'phone', v_token_record.phone,
    'email', v_token_record.email,
    'scheduled_checkin_at', v_token_record.scheduled_checkin_at,
    'scheduled_checkout_at', v_token_record.scheduled_checkout_at,
    'status', v_token_record.booking_status,
    'booking_status', v_token_record.booking_status,
    'hotel_id', v_token_record.hotel_id,
    'hotel_name', v_token_record.hotel_name,
    'adults', COALESCE(v_token_record.adults_total, 1),
    'children', COALESCE(v_token_record.children_total, 0),
    'rooms_total', COALESCE(v_token_record.rooms_total, 1),
    'room_type', v_token_record.room_type_name,
    'room_type_id', v_token_record.room_type_id,
    'room_id', v_token_record.room_id,
    'nationality', v_token_record.nationality,
    'address', v_token_record.address,
    'identity_proof', v_token_record.identity_proof,
    'precheckin_completed', (v_token_record.used_at IS NOT NULL),
    'precheckin_data', v_token_record.precheckin_data
  );
END;
$$;

GRANT EXECUTE ON FUNCTION validate_precheckin_token TO anon, authenticated;


-- ============================================================
-- 5. RPC: submit_precheckin (Secure + Multi-Room + Identity Upload)
-- Purpose: Save guest pre-check-in data, mark token used, save ID
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
GRANT EXECUTE ON FUNCTION submit_precheckin TO anon, authenticated;


-- ============================================================
-- 6. RPC: search_booking (Kiosk Support)
-- ============================================================
CREATE OR REPLACE FUNCTION search_booking(
  p_query TEXT,
  p_hotel_id UUID DEFAULT NULL,
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
  adults INT,
  children INT,
  source TEXT,
  hotel_id UUID,
  nationality TEXT,
  address TEXT,
  room_type_id UUID,
  room_id UUID,
  identity_proof JSONB
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

  p_limit := LEAST(GREATEST(p_limit,1),50);

  RETURN QUERY
  SELECT DISTINCT ON (b.id)
    b.id::UUID,
    b.code::TEXT,
    b.status::TEXT,
    b.guest_name::TEXT,
    b.phone::TEXT,
    COALESCE(p.email, b.email)::TEXT,
    b.scheduled_checkin_at::TIMESTAMPTZ,
    b.scheduled_checkout_at::TIMESTAMPTZ,
    rt.name::TEXT,
    COALESCE(b.adults_total, 1)::INT,
    COALESCE(b.children_total, 0)::INT,
    b.source::TEXT,
    b.hotel_id::UUID,
    g.nationality::TEXT,
    g.address::TEXT,
    br.room_type_id::UUID,
    br.room_id::UUID,
    (SELECT jsonb_build_object(
        'type', gid.document_type,
        'number', gid.document_number,
        'front_image', gid.front_image_url,
        'back_image', gid.back_image_url
     )
     FROM guest_id_documents gid
     WHERE gid.guest_id = b.guest_id
     ORDER BY gid.updated_at DESC LIMIT 1
    )::JSONB
  FROM bookings b
  LEFT JOIN profiles p ON b.guest_profile_id = p.id
  LEFT JOIN booking_rooms br ON br.booking_id = b.id
  LEFT JOIN room_types rt ON rt.id = br.room_type_id
  LEFT JOIN guests g ON g.id = b.guest_id
  WHERE (p_hotel_id IS NULL OR b.hotel_id = p_hotel_id)
    AND (
        b.code ILIKE '%' || p_query || '%'
        OR b.phone ILIKE '%' || p_query || '%'
        OR p.email ILIKE '%' || p_query || '%'
        OR b.email ILIKE '%' || p_query || '%'
    )
    AND b.status IN ('CREATED','CONFIRMED','PRE_CHECKED_IN')
  ORDER BY b.id, br.room_seq NULLS LAST, b.scheduled_checkin_at
  LIMIT p_limit;
END;
$$;


-- ============================================================
-- 7. HELPER: generate_precheckin_tokens (Bulk generation)
-- ============================================================
CREATE OR REPLACE FUNCTION generate_precheckin_tokens(
  p_hotel_id UUID,
  p_days_before INT DEFAULT 1
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  INSERT INTO precheckin_tokens (booking_id, hotel_id, expires_at)
  SELECT
    b.id,
    b.hotel_id,
    b.scheduled_checkin_at + INTERVAL '23 hours'  -- expires at 11 PM on check-in day
  FROM bookings b
  WHERE b.hotel_id = p_hotel_id
    AND b.status IN ('CREATED', 'CONFIRMED')
    AND b.scheduled_checkin_at::date BETWEEN
        CURRENT_DATE AND
        (CURRENT_DATE + (p_days_before || ' days')::INTERVAL)
    AND NOT EXISTS (
      SELECT 1 FROM precheckin_tokens pt WHERE pt.booking_id = b.id
    )
  ON CONFLICT (booking_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION generate_precheckin_tokens TO authenticated;


-- ============================================================
-- 8. REMINDERS (T-1 & Arrival)
-- ============================================================
ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS precheckin_reminder1_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS precheckin_reminder2_sent_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.generate_precheckin_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- [Reminders Logic Placeholder - Standard T-1/T-0 updates]
    -- (Keeping concise for file limit, but fully implemented in orig)
    
    -- T-1 DAY
    WITH targets_1 AS (
        SELECT b.id, b.phone, b.email, t.token
        FROM public.bookings b
        JOIN public.hotels h ON h.id = b.hotel_id
        LEFT JOIN public.precheckin_tokens t ON t.booking_id = b.id
        WHERE b.status IN ('CREATED','CONFIRMED')
          AND b.precheckin_reminder1_sent_at IS NULL
          AND (b.scheduled_checkin_at AT TIME ZONE h.timezone)::date =
              ((now() AT TIME ZONE h.timezone)::date + 1)
          AND b.status NOT IN ('CHECKED_IN', 'CANCELLED', 'NO_SHOW', 'COMPLETED')
          AND NOT EXISTS ( SELECT 1 FROM public.stays s WHERE s.booking_id = b.id )
          AND ( (b.phone IS NOT NULL AND b.phone <> '') OR (b.email IS NOT NULL AND b.email <> '') )
        FOR UPDATE
    ),
    channels_1 AS (
        SELECT id, 'whatsapp' as channel, token FROM targets_1 WHERE phone IS NOT NULL AND phone <> ''
        UNION ALL
        SELECT id, 'email' as channel, token FROM targets_1 WHERE email IS NOT NULL AND email <> ''
    ),
    inserted_1 AS (
        INSERT INTO public.notification_queue (booking_id, channel, template_code, payload, status)
        SELECT id, channel, 'precheckin_reminder_1', jsonb_build_object('booking_id', id, 'token', token), 'pending'
        FROM channels_1 RETURNING booking_id
    )
    UPDATE public.bookings b SET precheckin_reminder1_sent_at = now()
    WHERE b.id IN (SELECT DISTINCT booking_id FROM inserted_1);

    -- T-0 ARRIVAL
    WITH targets_2 AS (
        SELECT b.id, b.phone, b.email, t.token
        FROM public.bookings b
        JOIN public.hotels h ON h.id = b.hotel_id
        LEFT JOIN public.precheckin_tokens t ON t.booking_id = b.id
        WHERE b.status IN ('CREATED','CONFIRMED')
          AND b.precheckin_reminder2_sent_at IS NULL
          AND (b.scheduled_checkin_at AT TIME ZONE h.timezone)::date = (now() AT TIME ZONE h.timezone)::date
          AND (now() AT TIME ZONE h.timezone)::time >= time '06:00'
          AND b.status NOT IN ('CHECKED_IN', 'CANCELLED', 'NO_SHOW', 'COMPLETED')
          AND NOT EXISTS ( SELECT 1 FROM public.stays s WHERE s.booking_id = b.id )
          AND ( (b.phone IS NOT NULL AND b.phone <> '') OR (b.email IS NOT NULL AND b.email <> '') )
        FOR UPDATE
    ),
    channels_2 AS (
        SELECT id, 'whatsapp' as channel, token FROM targets_2 WHERE phone IS NOT NULL AND phone <> ''
        UNION ALL
        SELECT id, 'email' as channel, token FROM targets_2 WHERE email IS NOT NULL AND email <> ''
    ),
    inserted_2 AS (
        INSERT INTO public.notification_queue (booking_id, channel, template_code, payload, status)
        SELECT id, channel, 'precheckin_reminder_2', jsonb_build_object('booking_id', id, 'token', token), 'pending'
        FROM channels_2 RETURNING booking_id
    )
    UPDATE public.bookings b SET precheckin_reminder2_sent_at = now()
    WHERE b.id IN (SELECT DISTINCT booking_id FROM inserted_2);
END;
$$;
GRANT EXECUTE ON FUNCTION public.generate_precheckin_reminders TO service_role;

-- Reminder Indexes
DROP INDEX IF EXISTS uq_notification_precheckin_reminders;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_precheckin_reminders
ON public.notification_queue(booking_id, template_code, channel)
WHERE template_code IN ('precheckin_reminder_1','precheckin_reminder_2');

CREATE INDEX IF NOT EXISTS idx_bookings_reminder1_pending
ON public.bookings(hotel_id, scheduled_checkin_at)
WHERE precheckin_reminder1_sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_reminder2_pending
ON public.bookings(hotel_id, scheduled_checkin_at)
WHERE precheckin_reminder2_sent_at IS NULL;


-- ============================================================
-- 9. STORAGE: identity_proofs (SECURE/PRIVATE)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('identity_proofs', 'identity_proofs', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Public Access" ON storage.objects;

-- Policy: Strict Upload (Anon + Authenticated)
DROP POLICY IF EXISTS "Upload identity proofs" ON storage.objects;
CREATE POLICY "identity_proofs_upload"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK ( bucket_id = 'identity_proofs' );

-- Policy: Strict Read (Service Role ONLY - No direct access)
-- Frontend must request Signed URLs via a backend Edge Function/RPC that verifies permissions.
DROP POLICY IF EXISTS "Secure Read" ON storage.objects;
CREATE POLICY "identity_proofs_service_read"
ON storage.objects FOR SELECT
TO service_role
USING ( bucket_id = 'identity_proofs' );

-- Policy: Owner Manage (Update/Delete own files)
DROP POLICY IF EXISTS "Owner Access" ON storage.objects;
-- Policy: Owner Manager (Update own files)
CREATE POLICY "identity_proofs_owner_update"
ON storage.objects FOR UPDATE
TO authenticated
USING ( bucket_id = 'identity_proofs' AND owner = auth.uid() );

-- Policy: Owner Delete (Delete own files)
CREATE POLICY "identity_proofs_owner_delete"
ON storage.objects FOR DELETE
TO authenticated
USING ( bucket_id = 'identity_proofs' AND owner = auth.uid() );
