-- ============================================================
-- Ticket Schema Updates (Post-Base)
-- ============================================================

-- 1. Unblock Reasons Table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.unblock_reasons (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    description TEXT,
    requires_comment BOOLEAN NOT NULL DEFAULT false,
    notify_supervisor BOOLEAN NOT NULL DEFAULT false,
    resumes_sla BOOLEAN NOT NULL DEFAULT true,
    display_order INT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'unblock_reasons' AND column_name = 'icon') THEN
    ALTER TABLE unblock_reasons ADD COLUMN icon TEXT;
  END IF;
END $$;


-- 2. Initial Data for Unblock Reasons
-- ============================================================
INSERT INTO unblock_reasons (code, label, description, requires_comment, notify_supervisor, display_order, icon)
VALUES
('SUPPLIES_ARRIVED', 'Supplies arrived', 'Required supplies are now available on the floor', false, false, 1, '📦'),
('GUEST_LEFT_ROOM', 'Guest left room', 'Guest is no longer inside the room', false, false, 2, '🏃'),
('ROOM_UNLOCKED', 'Room unlocked', 'Room access is now available', false, false, 3, '🔓'),
('MAINTENANCE_COMPLETED', 'Maintenance completed', 'Maintenance dependency has been resolved', false, false, 4, '🔧'),
('SUPERVISOR_APPROVED', 'Supervisor approved', 'Supervisor approved resuming the task', false, true, 5, '👮'),
('WORKAROUND_APPLIED', 'Temporary workaround applied', 'Task resumed using a temporary workaround', true, true, 6, '🔄'),
('RESUME_AT_REQUESTED_TIME', 'Resume at requested time', 'Guest requested service later and time has arrived', false, false, 7, '⏰'),
('REASSIGNED_BY_SUPERVISOR', 'Reassigned by supervisor', 'Task was reassigned to different staff by supervisor', false, false, 8, '👥'),
('OTHER', 'Something else', 'Other valid reason for resuming the task', true, true, 99, '📝')
ON CONFLICT (code) DO UPDATE SET icon = EXCLUDED.icon;


-- 3. Block/Unblock Compatibility
-- ============================================================
CREATE TABLE IF NOT EXISTS block_unblock_compatibility (
    block_reason_code TEXT NOT NULL REFERENCES block_reasons(code),
    unblock_reason_code TEXT NOT NULL REFERENCES unblock_reasons(code),
    PRIMARY KEY (block_reason_code, unblock_reason_code)
);

-- Compatibility Data
INSERT INTO block_unblock_compatibility (block_reason_code, unblock_reason_code)
VALUES
('guest_inside', 'GUEST_LEFT_ROOM'), ('guest_inside', 'SUPERVISOR_APPROVED'), ('guest_inside', 'OTHER'),
('GUEST_REQUESTED_LATER', 'RESUME_AT_REQUESTED_TIME'), ('GUEST_REQUESTED_LATER', 'SUPERVISOR_APPROVED'), ('GUEST_REQUESTED_LATER', 'OTHER'),
('room_locked', 'ROOM_UNLOCKED'), ('room_locked', 'SUPERVISOR_APPROVED'), ('room_locked', 'OTHER'),
('supplies_unavailable', 'SUPPLIES_ARRIVED'), ('supplies_unavailable', 'WORKAROUND_APPLIED'), ('supplies_unavailable', 'SUPERVISOR_APPROVED'), ('supplies_unavailable', 'OTHER'),
('waiting_maintenance', 'MAINTENANCE_COMPLETED'), ('waiting_maintenance', 'WORKAROUND_APPLIED'), ('waiting_maintenance', 'SUPERVISOR_APPROVED'), ('waiting_maintenance', 'OTHER'),
('supervisor_approval', 'SUPERVISOR_APPROVED'), ('supervisor_approval', 'REASSIGNED_BY_SUPERVISOR'), ('supervisor_approval', 'OTHER'),
('something_else', 'OTHER'), ('something_else', 'SUPERVISOR_APPROVED')
ON CONFLICT DO NOTHING;


-- 4. Cancel Reasons Table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cancel_reasons (
  code TEXT NOT NULL PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NULL,

  -- Role permissions
  allowed_for_staff BOOLEAN NOT NULL DEFAULT FALSE,
  allowed_for_guest BOOLEAN NOT NULL DEFAULT FALSE,
  allowed_for_supervisor BOOLEAN NOT NULL DEFAULT TRUE,

  -- Workflow rules
  allow_when_new BOOLEAN NOT NULL DEFAULT TRUE,
  allow_when_in_progress BOOLEAN NOT NULL DEFAULT FALSE,

  requires_comment BOOLEAN NOT NULL DEFAULT FALSE,
  icon TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_terminal BOOLEAN NOT NULL DEFAULT TRUE,
  intent_category TEXT NOT NULL DEFAULT 'INVALID_REQUEST'
);

CREATE INDEX IF NOT EXISTS idx_cancel_reasons_active ON public.cancel_reasons (is_active);


-- 5. Cancel Reasons Data
-- ============================================================
INSERT INTO public.cancel_reasons (code, label, description, allowed_for_staff, allowed_for_guest, allowed_for_supervisor, allow_when_new, allow_when_in_progress, requires_comment, icon, intent_category) VALUES
-- Staff-allowed
('DUPLICATE_REQUEST', 'Duplicate request', 'Another ticket already exists for the same issue', TRUE, FALSE, TRUE, TRUE, TRUE, TRUE, 'copy', 'INVALID_REQUEST'),
('OUTSIDE_OPERATIONAL_SCOPE', 'Outside operational scope', 'Request is not the responsibility of hotel operations', TRUE, FALSE, TRUE, TRUE, TRUE, TRUE, 'slash', 'OPERATIONAL_CONSTRAINT'),
('ROOM_OUT_OF_SERVICE', 'Room out of service', 'Room is blocked or unavailable and work is not required', TRUE, FALSE, TRUE, TRUE, TRUE, FALSE, 'lock', 'OPERATIONAL_CONSTRAINT'),
('REQUEST_INVALID', 'Invalid request', 'Incorrect service, wrong room, or accidental request', TRUE, FALSE, TRUE, TRUE, TRUE, TRUE, 'alert-circle', 'INVALID_REQUEST'),
('RESOLVED_BY_OTHER_DEPARTMENT', 'Resolved by another department', 'Issue was resolved informally by a different team', TRUE, FALSE, TRUE, TRUE, TRUE, TRUE, 'users', 'RESOLVED_EXTERNALLY'),
('RESOLVED_OFF_SYSTEM', 'Resolved outside the system', 'Issue was fixed via vendor or manual process without using this ticket', TRUE, FALSE, TRUE, TRUE, TRUE, TRUE, 'tool', 'RESOLVED_EXTERNALLY'),

-- Supervisor-only
('POLICY_OVERRIDE', 'Policy override', 'Ticket cancelled due to policy decision', FALSE, FALSE, TRUE, TRUE, TRUE, TRUE, 'shield', 'MANAGEMENT_ACTION'),
('MANAGEMENT_DECISION', 'Management decision', 'Ticket cancelled by management instruction', FALSE, FALSE, TRUE, TRUE, TRUE, TRUE, 'briefcase', 'MANAGEMENT_ACTION'),
('COMPENSATION_PROVIDED', 'Compensation provided', 'Guest compensated and work cancelled', FALSE, FALSE, TRUE, TRUE, TRUE, TRUE, 'gift', 'MANAGEMENT_ACTION'),
('SLA_EXCEPTION_GRANTED', 'SLA exception granted', 'Ticket cancelled with SLA exception approval', FALSE, FALSE, TRUE, TRUE, TRUE, TRUE, 'clock-off', 'SLA_EXCEPTION'),

-- Guest-allowed
('REQUEST_NO_LONGER_REQUIRED', 'Request no longer required', 'Guest no longer needs this service', FALSE, TRUE, TRUE, TRUE, TRUE, FALSE, 'x-circle', 'INVALID_REQUEST'),
('REQUEST_MADE_BY_MISTAKE', 'Request made by mistake', 'Guest accidentally created the request', FALSE, TRUE, TRUE, TRUE, TRUE, FALSE, 'undo', 'INVALID_REQUEST'),
('GUEST_RESOLVED_SELF', 'Resolved by guest', 'Guest resolved the issue themselves', FALSE, TRUE, TRUE, TRUE, TRUE, FALSE, 'check-circle', 'RESOLVED_EXTERNALLY')
ON CONFLICT (code) DO UPDATE SET
  allowed_for_guest = EXCLUDED.allowed_for_guest,
  allowed_for_staff = EXCLUDED.allowed_for_staff,
  label = EXCLUDED.label,
  icon = EXCLUDED.icon;


-- 6. Update Tickets Table (reason_code)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tickets' AND column_name = 'reason_code') THEN
    ALTER TABLE tickets ADD COLUMN reason_code TEXT REFERENCES block_reasons(code);
    CREATE INDEX idx_tickets_reason_code ON tickets (reason_code);
  END IF;
END $$;
