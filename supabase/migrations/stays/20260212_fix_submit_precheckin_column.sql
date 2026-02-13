-- Fix submit_precheckin RPC: use document_number instead of id_number for guest_id_documents table

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
