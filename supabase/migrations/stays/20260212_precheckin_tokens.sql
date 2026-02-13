-- ============================================================
-- PRE-CHECK-IN TOKENS — GUEST SELF-SERVICE
--
-- Supports:
--   • Unique cryptographic tokens per booking
--   • Expiry-based access control
--   • Single-use validation
--   • Guest data submission via RPC
-- ============================================================


-- ============================================================
-- 1. PRECHECKIN_TOKENS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS precheckin_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),

  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,            -- NULL until guest completes pre-check-in

  -- Guest submission data (filled by submit_precheckin RPC)
  precheckin_data JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_precheckin_booking UNIQUE (booking_id)
);

-- Fast token lookup
CREATE INDEX IF NOT EXISTS idx_precheckin_tokens_token
  ON precheckin_tokens (token);

CREATE INDEX IF NOT EXISTS idx_precheckin_tokens_booking
  ON precheckin_tokens (booking_id);

CREATE INDEX IF NOT EXISTS idx_precheckin_tokens_expires
  ON precheckin_tokens (expires_at)
  WHERE used_at IS NULL;


-- ============================================================
-- 2. RLS POLICIES
-- ============================================================
ALTER TABLE precheckin_tokens ENABLE ROW LEVEL SECURITY;

-- Public can read tokens (validation is done in RPC with SECURITY DEFINER)
DROP POLICY IF EXISTS "Public read precheckin tokens" ON precheckin_tokens;
CREATE POLICY "Public read precheckin tokens"
ON precheckin_tokens
FOR SELECT
USING (true);

-- Only server/service role can write
DROP POLICY IF EXISTS "Service write precheckin tokens" ON precheckin_tokens;
CREATE POLICY "Service write precheckin tokens"
ON precheckin_tokens
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);


-- ============================================================
-- 3. RPC: validate_precheckin_token
-- Purpose: Validates a token and returns booking details
-- Access: Public (anon-safe)
-- ============================================================
CREATE OR REPLACE FUNCTION validate_precheckin_token(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token_record RECORD;
BEGIN
  -- Find valid token
  SELECT
    pt.id AS token_id,
    pt.booking_id,
    pt.expires_at,
    pt.used_at,
    pt.precheckin_data,
    b.code AS booking_code,
    b.guest_name,
    b.phone,
    g.email,
    b.scheduled_checkin_at,
    b.scheduled_checkout_at,
    b.status AS booking_status,
    h.id AS hotel_id,
    h.name AS hotel_name
  INTO v_token_record
  FROM precheckin_tokens pt
  JOIN bookings b ON b.id = pt.booking_id
  JOIN hotels h ON h.id = b.hotel_id
  LEFT JOIN guests g ON g.id = b.guest_id
  WHERE pt.token = p_token;

  -- Token not found
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Invalid token'
    );
  END IF;

  -- Token already used
  IF v_token_record.used_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Pre-check-in already completed',
      'completed_at', v_token_record.used_at
    );
  END IF;

  -- Token expired
  IF v_token_record.expires_at < now() THEN
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
    'booking_code', v_token_record.booking_code,
    'guest_name', v_token_record.guest_name,
    'phone', v_token_record.phone,
    'email', v_token_record.email,
    'checkin_date', v_token_record.scheduled_checkin_at,
    'checkout_date', v_token_record.scheduled_checkout_at,
    'booking_status', v_token_record.booking_status,
    'hotel_id', v_token_record.hotel_id,
    'hotel_name', v_token_record.hotel_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION validate_precheckin_token TO anon, authenticated;


-- ============================================================
-- 4. RPC: submit_precheckin
-- Purpose: Save guest pre-check-in data and mark token as used
-- Access: Public (anon-safe, validated by token)
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
BEGIN
  -- 1. Validate token
  SELECT id, booking_id, used_at, expires_at
  INTO v_token_id, v_booking_id, v_used_at, v_expires_at
  FROM precheckin_tokens
  WHERE token = p_token
  FOR UPDATE;  -- Lock to prevent concurrent submissions

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid token');
  END IF;

  IF v_used_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pre-check-in already completed');
  END IF;

  IF v_expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'This link has expired');
  END IF;

  -- 2. Save guest data and mark as used
  UPDATE precheckin_tokens
  SET
    precheckin_data = p_data,
    used_at = now(),
    updated_at = now()
  WHERE id = v_token_id;

  -- 3. Update booking with guest details from pre-check-in
  UPDATE bookings
  SET
    guest_name = COALESCE(p_data->>'guest_name', guest_name),
    phone = COALESCE(p_data->>'phone', phone),
    updated_at = now()
  WHERE id = v_booking_id;

  -- 4. Insert guest ID document if provided
  IF p_data->>'id_number' IS NOT NULL AND p_data->>'id_number' != '' THEN
    -- Find or use the guest_id from the booking
    DECLARE
      v_guest_id UUID;
    BEGIN
      SELECT guest_id INTO v_guest_id FROM bookings WHERE id = v_booking_id;

      IF v_guest_id IS NOT NULL THEN
        INSERT INTO guest_id_documents (guest_id, document_type, document_number, verification_status)
        VALUES (
          v_guest_id,
          COALESCE((p_data->>'id_type')::guest_document_type, 'other'),
          p_data->>'id_number',
          'pending'
        )
        ON CONFLICT DO NOTHING;
      END IF;
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking_id,
    'completed_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION submit_precheckin TO anon, authenticated;


-- ============================================================
-- 5. HELPER: generate_precheckin_tokens (Bulk generation)
-- Purpose: Generate tokens for upcoming bookings
-- Access: Authenticated (staff/admin)
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
  INSERT INTO precheckin_tokens (booking_id, expires_at)
  SELECT
    b.id,
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
