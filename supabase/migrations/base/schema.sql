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

CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  service_department_id UUID NOT NULL
    REFERENCES departments(id) ON DELETE RESTRICT,

  room_id UUID,

  title TEXT NOT NULL,
  description TEXT,

  status TEXT NOT NULL
    CHECK (status IN ('NEW','IN_PROGRESS','BLOCKED','COMPLETED','CANCELLED')),

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

CREATE INDEX idx_tickets_status
ON tickets (status);

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
-- END OF v1_production.sql
-- ============================================================
