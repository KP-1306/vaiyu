-- ============================================================
-- Vaiyu Staff Runner – v1 Production Schema
-- ============================================================

-- ============================================================
-- Utility: updated_at trigger function
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 1️⃣ Departments (authoritative service dimension)
-- ============================================================

CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  hotel_id UUID NOT NULL
    REFERENCES hotels(id) ON DELETE CASCADE,

  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,

  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (hotel_id, code)
);

CREATE TRIGGER trg_departments_updated
BEFORE UPDATE ON departments
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_departments_hotel_active
ON departments (hotel_id)
WHERE is_active = true;


-- ============================================================
-- 2️⃣ Hotel Members (identity within a hotel)
-- ============================================================

CREATE TABLE hotel_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  hotel_id UUID NOT NULL
    REFERENCES hotels(id) ON DELETE CASCADE,

  user_id UUID NOT NULL,

  role TEXT NOT NULL
    CHECK (role IN ('OWNER','MANAGER','STAFF')),

  department_id UUID NOT NULL
    REFERENCES departments(id),

  is_active BOOLEAN NOT NULL DEFAULT true,
  is_verified BOOLEAN NOT NULL DEFAULT false,

  status TEXT NOT NULL DEFAULT 'invited',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (hotel_id, user_id)
);

CREATE TRIGGER trg_hotel_members_updated
BEFORE UPDATE ON hotel_members
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_hotel_members_user_active
ON hotel_members (user_id)
WHERE is_active = true;

CREATE INDEX idx_hotel_members_hotel_active
ON hotel_members (hotel_id)
WHERE is_active = true;

CREATE INDEX idx_hotel_members_department
ON hotel_members (department_id)
WHERE is_active = true;


-- ============================================================
-- 3️⃣ Hotel Roles (business roles)
-- ============================================================

CREATE TABLE hotel_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  hotel_id UUID NOT NULL
    REFERENCES hotels(id) ON DELETE CASCADE,

  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,

  is_active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (hotel_id, code)
);

CREATE TRIGGER trg_hotel_roles_updated
BEFORE UPDATE ON hotel_roles
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_hotel_roles_hotel_active
ON hotel_roles (hotel_id)
WHERE is_active = true;


-- ============================================================
-- 4️⃣ Hotel Member ↔ Roles (many-to-many)
-- ============================================================

CREATE TABLE hotel_member_roles (
  hotel_member_id UUID NOT NULL
    REFERENCES hotel_members(id) ON DELETE CASCADE,

  role_id UUID NOT NULL
    REFERENCES hotel_roles(id) ON DELETE CASCADE,

  PRIMARY KEY (hotel_member_id, role_id)
);

CREATE INDEX idx_member_roles_member
ON hotel_member_roles (hotel_member_id);

CREATE INDEX idx_member_roles_role
ON hotel_member_roles (role_id);


-- ============================================================
-- 5️⃣ Hotel Zones (physical segmentation)
-- ============================================================

CREATE TABLE hotel_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  hotel_id UUID NOT NULL
    REFERENCES hotels(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  floor INT,
  wing TEXT,

  is_active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (hotel_id, name)
);

CREATE TRIGGER trg_hotel_zones_updated
BEFORE UPDATE ON hotel_zones
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_hotel_zones_hotel_active
ON hotel_zones (hotel_id)
WHERE is_active = true;


-- ============================================================
-- 6️⃣ Staff ↔ Zone Assignments (immutable history)
-- ============================================================

CREATE TABLE staff_zone_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  staff_id UUID NOT NULL
    REFERENCES hotel_members(id) ON DELETE CASCADE,

  zone_id UUID NOT NULL
    REFERENCES hotel_zones(id) ON DELETE CASCADE,

  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to TIMESTAMPTZ,

  assigned_by UUID
    REFERENCES hotel_members(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_zone_assignments_active
ON staff_zone_assignments (zone_id, staff_id)
WHERE effective_to IS NULL;

CREATE INDEX idx_zone_assignments_staff
ON staff_zone_assignments (staff_id);


-- ============================================================
-- 7️⃣ Staff Shifts
-- ============================================================

CREATE TABLE staff_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  staff_id UUID NOT NULL
    REFERENCES hotel_members(id) ON DELETE CASCADE,

  shift_start TIMESTAMPTZ NOT NULL,
  shift_end TIMESTAMPTZ NOT NULL,

  is_active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  CHECK (shift_end > shift_start)
);

CREATE TRIGGER trg_staff_shifts_updated
BEFORE UPDATE ON staff_shifts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_staff_shifts_active
ON staff_shifts (staff_id)
WHERE is_active = true;

CREATE INDEX idx_staff_shifts_time
ON staff_shifts (shift_start, shift_end);


--2️⃣ Introduce staff_shift_notes (this is what you were missing)



CREATE TABLE staff_shift_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  shift_id UUID NOT NULL
    REFERENCES staff_shifts(id) ON DELETE CASCADE,

  note TEXT NOT NULL,

  created_by UUID
    REFERENCES hotel_members(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_staff_shift_notes_updated
BEFORE UPDATE ON staff_shift_notes
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_shift_notes_shift
ON staff_shift_notes (shift_id, created_at);

CREATE INDEX idx_shift_notes_created_by
ON staff_shift_notes (created_by);


-- ============================================================
-- 8️⃣ SLA Policies
-- ============================================================

CREATE TABLE sla_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  department_id UUID NOT NULL
    REFERENCES departments(id) ON DELETE CASCADE,

  target_minutes INT NOT NULL,
  warn_minutes INT NOT NULL,
  escalate_minutes INT NOT NULL,

  is_active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sla_policies
ADD COLUMN sla_start_trigger TEXT NOT NULL
CHECK (
  sla_start_trigger IN (
    'ON_CREATE',
    'ON_ASSIGN',
    'ON_SHIFT_START'
  )
)
DEFAULT 'ON_ASSIGN';


CREATE TRIGGER trg_sla_policies_updated
BEFORE UPDATE ON sla_policies
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_sla_policies_department_active
ON sla_policies (department_id)
WHERE is_active = true;


-- ============================================================
-- 9️⃣ Tickets (core work unit)
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS ticket_display_id_seq START 1000;

CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  display_id TEXT UNIQUE,

  service_department_id UUID NOT NULL
    REFERENCES departments(id) ON DELETE RESTRICT,

  room_id UUID,

  title TEXT NOT NULL,
  description TEXT,

  status TEXT NOT NULL
    CHECK (status IN ('NEW','IN_PROGRESS','BLOCKED','COMPLETED','CANCELLED')),

  priority TEXT DEFAULT 'NORMAL'
    CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),

  current_assignee_id UUID
    REFERENCES hotel_members(id),

  created_by_type TEXT NOT NULL
    CHECK (created_by_type IN ('GUEST','STAFF','SYSTEM','FRONT_DESK')),

  created_by_id UUID,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE TRIGGER trg_tickets_updated
BEFORE UPDATE ON tickets
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION generate_ticket_display_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.display_id IS NULL OR NEW.display_id = '' THEN
    NEW.display_id := 'REQ-' || nextval('ticket_display_id_seq');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_ticket_display_id
BEFORE INSERT ON tickets
FOR EACH ROW
EXECUTE FUNCTION generate_ticket_display_id();

CREATE INDEX idx_tickets_status
ON tickets (status);

CREATE UNIQUE INDEX idx_tickets_display_id
ON tickets (display_id);

CREATE INDEX idx_tickets_assignee
ON tickets (current_assignee_id)
WHERE current_assignee_id IS NOT NULL;

CREATE INDEX idx_tickets_department
ON tickets (service_department_id);

CREATE INDEX idx_tickets_open
ON tickets (service_department_id, status)
WHERE status IN ('NEW','IN_PROGRESS','BLOCKED');

ALTER TABLE tickets
ADD COLUMN zone_id UUID
REFERENCES hotel_zones(id);

ALTER TABLE tickets
ADD CONSTRAINT tickets_room_id_fkey
FOREIGN KEY (room_id)
REFERENCES rooms(id)
ON DELETE RESTRICT;

ALTER TABLE tickets
    ADD COLUMN stay_id UUID
        REFERENCES stays(id)
            ON DELETE RESTRICT;

CREATE INDEX idx_tickets_stay
    ON tickets (stay_id);



-- ============================================================
-- 🔟 Ticket SLA Runtime State
-- ============================================================

CREATE TABLE ticket_sla_state (
  ticket_id UUID PRIMARY KEY
    REFERENCES tickets(id) ON DELETE CASCADE,

  sla_policy_id UUID
    REFERENCES sla_policies(id) ON DELETE SET NULL,

  sla_started_at TIMESTAMPTZ,
  sla_paused_at TIMESTAMPTZ,
  sla_resumed_at TIMESTAMPTZ,

  total_paused_seconds INT NOT NULL DEFAULT 0,

  breached BOOLEAN NOT NULL DEFAULT false,
  breached_at TIMESTAMPTZ,

  current_remaining_seconds INT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_ticket_sla_state_updated
BEFORE UPDATE ON ticket_sla_state
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_sla_state_active
ON ticket_sla_state (current_remaining_seconds)
WHERE breached = false;

CREATE INDEX idx_sla_state_policy
ON ticket_sla_state (sla_policy_id);


-- ============================================================
-- 1️⃣1️⃣ Ticket Events (immutable audit log)
-- ============================================================

CREATE TABLE ticket_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  ticket_id UUID NOT NULL
    REFERENCES tickets(id) ON DELETE CASCADE,

  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'CREATED','ASSIGNED','REASSIGNED','STARTED',
      'BLOCKED','UNBLOCKED','COMPLETED','ESCALATED','RESET'
    )),

  previous_status TEXT,
  new_status TEXT,

  reason_code TEXT,
  comment TEXT,

  actor_type TEXT NOT NULL
    CHECK (actor_type IN ('STAFF','SYSTEM','GUEST','FRONT_DESK')),

  actor_id UUID,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ticket_events_ticket
ON ticket_events (ticket_id, created_at);

CREATE INDEX idx_ticket_events_type
ON ticket_events (event_type);

ALTER TABLE ticket_events
ADD COLUMN resume_after TIMESTAMPTZ;

ALTER TABLE ticket_events
    ADD CONSTRAINT ticket_events_status_check
        CHECK (
            previous_status IS NULL
                OR previous_status IN ('NEW','IN_PROGRESS','BLOCKED','COMPLETED','CANCELLED')
            );



ALTER TABLE public.ticket_events
    ADD CONSTRAINT ticket_events_reason_code_fkey
        FOREIGN KEY (reason_code)
            REFERENCES public.block_reasons(code)
            DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.ticket_events
    ADD CONSTRAINT ticket_events_new_status_check
        CHECK (
            new_status IS NULL
                OR new_status IN (
                                  'NEW',
                                  'IN_PROGRESS',
                                  'BLOCKED',
                                  'COMPLETED',
                                  'CANCELLED'
                )
            );

ALTER TABLE public.ticket_events
DROP CONSTRAINT ticket_events_event_type_check;

ALTER TABLE ticket_events
DROP CONSTRAINT IF EXISTS ticket_events_event_type_check;

ALTER TABLE ticket_events
    ADD CONSTRAINT ticket_events_event_type_check
        CHECK (
            event_type IN (
                -- lifecycle
                           'CREATED',
                           'ASSIGNED',
                           'REASSIGNED',
                           'STARTED',
                           'COMPLETED',
                           'CANCELLED',
                           'REOPENED',
                           'RESET',

                -- blocking
                           'BLOCKED',
                           'UNBLOCKED',

                -- supervisor decision flow
                           'SUPERVISOR_REQUESTED',
                           'SUPERVISOR_APPROVED',
                           'SUPERVISOR_REJECTED',

                -- SLA exception flow
                           'SLA_EXCEPTION_REQUESTED',
                           'SLA_EXCEPTION_GRANTED',
                           'SLA_EXCEPTION_REJECTED',

                -- escalation (system-driven)
                           'ESCALATED',

                -- communication
                           'COMMENT_ADDED'
                )
            );

-- ============================================================
-- 1️⃣2️⃣ Block Reasons (global reference data)
-- ============================================================

CREATE TABLE block_reasons (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,

  requires_comment BOOLEAN NOT NULL DEFAULT false,
  pauses_sla BOOLEAN NOT NULL DEFAULT true,

  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX idx_block_reasons_active
ON block_reasons (is_active);


ALTER TABLE block_reasons
ADD COLUMN requires_resume_time BOOLEAN NOT NULL DEFAULT false;

---stay
ALTER TABLE stays
    ADD COLUMN booking_code TEXT;

CREATE UNIQUE INDEX stays_booking_code_unique
    ON stays (booking_code)
    WHERE booking_code IS NOT NULL;

-- ============================================================
-- 1️⃣3️⃣ Ticket Attachments
-- ============================================================

-- 1. Create Schema (ticket_attachments)
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

-- 2. Create Storage Bucket (Ticket Attachments)
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


-- ============================================================
-- 1️⃣4️⃣ RPC: Create Service Request
-- ============================================================

CREATE OR REPLACE FUNCTION create_service_request(
  p_hotel_id UUID,
  p_room_id UUID,
  p_zone_id UUID,
  p_service_id UUID,
  p_description TEXT,
  p_created_by_type TEXT,
  p_created_by_id UUID,
  p_stay_id UUID DEFAULT NULL,
  p_media_urls JSONB DEFAULT '[]'::jsonb,
  p_priority TEXT DEFAULT 'NORMAL'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket_id UUID;
  v_display_id TEXT;
  v_service_title TEXT;
  v_department_id UUID;
  v_url TEXT;
  v_final_priority TEXT;
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
  
  -- Validate & Normalize priority (Handle Case Insensitivity)
  v_final_priority := UPPER(p_priority);
  IF v_final_priority NOT IN ('LOW', 'NORMAL', 'HIGH', 'URGENT') THEN
     v_final_priority := 'NORMAL'; -- Fallback safety
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
    title, description, status, current_assignee_id, created_by_type, created_by_id, priority
  ) VALUES (
    p_hotel_id, v_department_id, p_service_id, p_stay_id, p_room_id, p_zone_id, 
    v_service_title, p_description, 'NEW', NULL, p_created_by_type, p_created_by_id, v_final_priority
  ) RETURNING id, display_id INTO v_ticket_id, v_display_id;

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

  RETURN jsonb_build_object(
    'id', v_ticket_id,
    'display_id', v_display_id
  );
END;
$$;

-- Grant permissions (Update signature grantees)
GRANT EXECUTE ON FUNCTION create_service_request(UUID, UUID, UUID, UUID, TEXT, TEXT, UUID, UUID, JSONB, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION create_service_request(UUID, UUID, UUID, UUID, TEXT, TEXT, UUID, UUID, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION create_service_request(UUID, UUID, UUID, UUID, TEXT, TEXT, UUID, UUID, JSONB, TEXT) TO service_role;

-- ============================================================
-- 1️⃣5️⃣ RPC: Get Ticket Details (Public Tracker)
-- ============================================================
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
    'current_assignee_id', t.current_assignee_id,
    'booking_code', st.booking_code,
    'sla_started_at', tss.sla_started_at,
    'service', jsonb_build_object(
      'label', s.label,
      'sla_minutes', s.sla_minutes,
      'description_en', s.description_en
    ),
    'room', CASE WHEN r.id IS NOT NULL THEN jsonb_build_object('number', r.number) ELSE null END,
    'zone', CASE WHEN z.id IS NOT NULL THEN jsonb_build_object('id', z.id, 'name', z.name) ELSE null END,
    'attachments', (
       SELECT coalesce(jsonb_agg(jsonb_build_object('file_path', file_path, 'created_at', created_at)), '[]'::jsonb)
       FROM ticket_attachments ta
       WHERE ta.ticket_id = t.id
    )
  ) INTO v_result
  FROM tickets t
  JOIN services s ON s.id = t.service_id
  LEFT JOIN stays st ON st.id = t.stay_id
  LEFT JOIN rooms r ON r.id = t.room_id
  LEFT JOIN hotel_zones z ON z.id = t.zone_id
  LEFT JOIN ticket_sla_state tss ON tss.ticket_id = t.id
  WHERE t.display_id = p_display_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_ticket_details(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_ticket_details(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_ticket_details(TEXT) TO service_role;

-- ============================================================
-- END OF v1_production.sql
-- ============================================================
