-- 1. Allow Anon Uploads to ticket-attachments bucket
-- (Guests need to upload photos)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anon Upload' AND tablename = 'objects') THEN
    CREATE POLICY "Anon Upload" ON storage.objects
    FOR INSERT TO anon
    WITH CHECK (
      bucket_id = 'ticket-attachments'
      AND name LIKE 'tickets/%'
    );
  END IF;
END $$;

-- 1.1 Add uploaded_by_type to ticket_attachments if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ticket_attachments' AND column_name = 'uploaded_by_type') THEN
        ALTER TABLE ticket_attachments ADD COLUMN uploaded_by_type TEXT;
    END IF;
END $$;


-- 2. RPC: Guest Update Ticket
-- Appends to description and adds attachments
CREATE OR REPLACE FUNCTION guest_update_ticket(
  p_display_id TEXT,
  p_details TEXT DEFAULT NULL,
  p_media_urls JSONB DEFAULT NULL -- array of strings
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket_id UUID;
  v_old_description TEXT;
  v_guest_id UUID;
  v_url TEXT;
BEGIN
  -- Get ticket ID with Security Check (Not Completed/Cancelled)
  SELECT id, description, created_by_id INTO v_ticket_id, v_old_description, v_guest_id
  FROM tickets
  WHERE display_id = p_display_id
    AND status NOT IN ('COMPLETED', 'CANCELLED');

  IF v_ticket_id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found or closed for updates';
  END IF;

  -- Update Description (Append)
  IF p_details IS NOT NULL AND length(trim(p_details)) > 0 THEN
    UPDATE tickets 
    SET description = COALESCE(description, '') || E'\n\n[Guest Update]: ' || p_details,
        updated_at = now()
    WHERE id = v_ticket_id;

    -- Log Event
    INSERT INTO ticket_events (ticket_id, event_type, actor_type, actor_id, comment)
    VALUES (v_ticket_id, 'COMMENT_ADDED', 'GUEST', v_guest_id, p_details);
  END IF;

  -- Add Attachments
  IF p_media_urls IS NOT NULL AND jsonb_array_length(p_media_urls) > 0 THEN
    FOR v_url IN SELECT * FROM jsonb_array_elements_text(p_media_urls)
    LOOP
      v_url := trim(both '"' from v_url);
      
      -- Validate path (Must start with tickets/)
      IF v_url NOT LIKE 'tickets/%' THEN
         RAISE EXCEPTION 'Invalid file path: %', v_url;
      END IF;

      INSERT INTO ticket_attachments (ticket_id, file_path, uploaded_by, uploaded_by_type)
      VALUES (v_ticket_id, v_url, NULL, 'GUEST'); -- Explicit actor type
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION guest_update_ticket(TEXT, TEXT, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION guest_update_ticket(TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION guest_update_ticket(TEXT, TEXT, JSONB) TO service_role;


-- 3. Update get_ticket_details to include attachments
CREATE OR REPLACE FUNCTION get_ticket_details(p_display_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'id', t.id,
    'display_id', t.display_id,
    'status', t.status,
    'created_at', t.created_at,
    'completed_at', t.completed_at,
    'description', t.description,
    'stay_id', t.stay_id,
    'sla_started_at', tss.sla_started_at,
    'service', jsonb_build_object(
      'label', s.label,
      'sla_minutes', s.sla_minutes,
      'description_en', s.description_en
    ),
    'room', CASE WHEN r.id IS NOT NULL THEN jsonb_build_object('number', r.number) ELSE null END,
    'attachments', (
       SELECT coalesce(jsonb_agg(jsonb_build_object('file_path', file_path, 'created_at', created_at)), '[]'::jsonb)
       FROM ticket_attachments ta
       WHERE ta.ticket_id = t.id
    )
  ) INTO v_result
  FROM tickets t
  JOIN services s ON s.id = t.service_id
  LEFT JOIN rooms r ON r.id = t.room_id
  LEFT JOIN ticket_sla_state tss ON tss.ticket_id = t.id
  WHERE t.display_id = p_display_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_ticket_details(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_ticket_details(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_ticket_details(TEXT) TO service_role;
