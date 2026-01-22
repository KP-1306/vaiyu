-- ============================================================
-- 📸 TICKET PHOTO IMPLEMENTATION (Official)
-- ============================================================

-- 1. Create Storage Bucket (Ticket Attachments)
INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES (
  'ticket-attachments',
  'ticket-attachments',
  true, -- PUBLIC bucket
  false,
  10485760, -- 10MB limit
  '{image/*,video/*}' -- Allow images and videos
)
ON CONFLICT (id) DO NOTHING;

-- Storage Policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public Access' AND tablename = 'objects') THEN
    CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING ( bucket_id = 'ticket-attachments' );
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated Upload' AND tablename = 'objects') THEN
    CREATE POLICY "Authenticated Upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK ( bucket_id = 'ticket-attachments' );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Owner Delete' AND tablename = 'objects') THEN
    CREATE POLICY "Owner Delete" ON storage.objects FOR DELETE TO authenticated USING ( bucket_id = 'ticket-attachments' AND auth.uid() = owner );
  END IF;
END $$;


-- 2. Create Schema (ticket_attachments)
CREATE TABLE IF NOT EXISTS ticket_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_type TEXT,
  file_size BIGINT,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ticket_attachments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public read access to ticket attachments' AND tablename = 'ticket_attachments') THEN
    CREATE POLICY "Public read access to ticket attachments" ON ticket_attachments FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can upload attachments' AND tablename = 'ticket_attachments') THEN
    CREATE POLICY "Authenticated users can upload attachments" ON ticket_attachments FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  
   -- Explicit grant for anon (guest)
  GRANT INSERT, SELECT ON ticket_attachments TO anon;
END $$;

CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket_id ON ticket_attachments(ticket_id);


-- 3. Update RPC (create_service_request) with JSONB support
-- Drop ancient/ambiguous versions
DROP FUNCTION IF EXISTS create_service_request(UUID, UUID, UUID, UUID, TEXT, TEXT, UUID, UUID);
DROP FUNCTION IF EXISTS create_service_request(UUID, UUID, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT[]);

CREATE OR REPLACE FUNCTION create_service_request(
  p_hotel_id UUID,
  p_room_id UUID,
  p_zone_id UUID,
  p_service_id UUID,
  p_description TEXT,
  p_created_by_type TEXT,
  p_created_by_id UUID,
  p_stay_id UUID DEFAULT NULL,
  p_media_urls JSONB DEFAULT '[]'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket_id UUID;
  v_service_title TEXT;
  v_department_id UUID;
  v_url TEXT;
BEGIN
  ----------------------------------------------------------------
  -- 0️⃣ Input validation & Service Lookup
  ----------------------------------------------------------------
  -- Enforce location XOR rule
  IF (p_room_id IS NULL AND p_zone_id IS NULL)
     OR (p_room_id IS NOT NULL AND p_zone_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Exactly one of room_id or zone_id must be provided';
  END IF;

  -- Validate creator type
  IF p_created_by_type NOT IN ('GUEST','STAFF','FRONT_DESK','SYSTEM') THEN
    RAISE EXCEPTION 'Invalid created_by_type: %', p_created_by_type;
  END IF;

  -- Lookup Service & Department
  SELECT label, department_id INTO v_service_title, v_department_id
  FROM services WHERE id = p_service_id AND hotel_id = p_hotel_id;

  IF v_service_title IS NULL THEN
     RAISE EXCEPTION 'Service not found or invalid for this hotel (ID: %)', p_service_id;
  END IF;

  -- Ensure active SLA policy exists
  IF NOT EXISTS (SELECT 1 FROM sla_policies WHERE department_id = v_department_id AND is_active = true) THEN
    RAISE EXCEPTION 'No active SLA policy found for department %', v_department_id;
  END IF;

  ----------------------------------------------------------------
  -- 1️⃣ Create ticket
  ----------------------------------------------------------------
  INSERT INTO tickets (
    hotel_id, service_department_id, service_id, stay_id, room_id, zone_id, 
    title, description, status, current_assignee_id, created_by_type, created_by_id
  ) VALUES (
    p_hotel_id, v_department_id, p_service_id, p_stay_id, p_room_id, p_zone_id, 
    v_service_title, p_description, 'NEW', NULL, p_created_by_type, p_created_by_id
  ) RETURNING id INTO v_ticket_id;

  ----------------------------------------------------------------
  -- 1️⃣(b) Insert Attachments
  ----------------------------------------------------------------
  IF p_media_urls IS NOT NULL AND jsonb_array_length(p_media_urls) > 0 THEN
    FOR v_url IN SELECT value::text FROM jsonb_array_elements_text(p_media_urls)
    LOOP
      v_url := trim(both '"' from v_url);
      INSERT INTO ticket_attachments (ticket_id, file_path, uploaded_by)
      VALUES (
        v_ticket_id, v_url, 
        CASE 
          WHEN p_created_by_type IN ('STAFF', 'FRONT_DESK') AND p_created_by_id IS NOT NULL 
          THEN (SELECT user_id FROM hotel_members WHERE id = p_created_by_id)
          ELSE auth.uid() 
        END
      );
    END LOOP;
  END IF;

  ----------------------------------------------------------------
  -- 2️⃣ Audit: CREATED event
  ----------------------------------------------------------------
  INSERT INTO ticket_events (
    ticket_id, event_type, new_status, actor_type, actor_id, comment
  ) VALUES (
    v_ticket_id, 'CREATED', 'NEW', p_created_by_type,
    CASE WHEN p_created_by_type IN ('STAFF','FRONT_DESK') THEN p_created_by_id ELSE NULL END,
    'Service request created: ' || v_service_title
  );

  ----------------------------------------------------------------
  -- 3️⃣ Initialize SLA runtime state
  ----------------------------------------------------------------
  INSERT INTO ticket_sla_state (ticket_id, sla_policy_id)
  SELECT v_ticket_id, sp.id
  FROM sla_policies sp
  WHERE sp.department_id = v_department_id AND sp.is_active = true
  LIMIT 1;

  RETURN v_ticket_id;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION create_service_request(UUID, UUID, UUID, UUID, TEXT, TEXT, UUID, UUID, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION create_service_request(UUID, UUID, UUID, UUID, TEXT, TEXT, UUID, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION create_service_request(UUID, UUID, UUID, UUID, TEXT, TEXT, UUID, UUID, JSONB) TO service_role;

-- 4. Cleanup Debug
DROP TABLE IF EXISTS rpc_debug_logs;
