CREATE TABLE public.unblock_reasons (
                                        code TEXT PRIMARY KEY,

    -- Human readable label (UI)
                                        label TEXT NOT NULL,

    -- Explanation shown in supervisor timeline / audit
                                        description TEXT,

    -- Whether staff must add a note
                                        requires_comment BOOLEAN NOT NULL DEFAULT false,

    -- Whether resuming should notify supervisor
                                        notify_supervisor BOOLEAN NOT NULL DEFAULT false,

    -- Whether SLA should resume immediately
                                        resumes_sla BOOLEAN NOT NULL DEFAULT true,

    -- Used for UI ordering
                                        display_order INT,

    -- Soft control
                                        is_active BOOLEAN NOT NULL DEFAULT true,

                                        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- Unblock / Resume Reasons (FINAL, PRODUCTION-GRADE)
-- ============================================================

INSERT INTO unblock_reasons
(code, label, description, requires_comment, notify_supervisor, display_order)
VALUES

-- 📦 Supplies related
('SUPPLIES_ARRIVED',
 'Supplies arrived',
 'Required supplies are now available on the floor',
 false,
 false,
 1),

-- 🧑 Guest related
('GUEST_LEFT_ROOM',
 'Guest left room',
 'Guest is no longer inside the room',
 false,
 false,
 2),

-- 🔒 Access related
('ROOM_UNLOCKED',
 'Room unlocked',
 'Room access is now available',
 false,
 false,
 3),

-- 🔧 Maintenance related
('MAINTENANCE_COMPLETED',
 'Maintenance completed',
 'Maintenance dependency has been resolved',
 false,
 false,
 4),

-- 🧑‍✈️ Supervisor action
('SUPERVISOR_APPROVED',
 'Supervisor approved',
 'Supervisor approved resuming the task',
 false,
 true,
 5),

-- 🔁 Workaround / exception
('WORKAROUND_APPLIED',
 'Temporary workaround applied',
 'Task resumed using a temporary workaround',
 true,
 true,
 6),

-- 🕒 Guest timing based
('RESUME_AT_REQUESTED_TIME',
 'Resume at requested time',
 'Guest requested service later and time has arrived',
 false,
 false,
 7),

-- ✏️ Escape hatch (mandatory comment)
('OTHER',
 'Something else',
 'Other valid reason for resuming the task',
 true,
 true,
 99);





CREATE TABLE block_unblock_compatibility (
                                             block_reason_code TEXT NOT NULL
                                                 REFERENCES block_reasons(code),

                                             unblock_reason_code TEXT NOT NULL
                                                 REFERENCES unblock_reasons(code),

                                             PRIMARY KEY (block_reason_code, unblock_reason_code)
);

ALTER TABLE block_unblock_compatibility
    ADD CONSTRAINT uniq_block_unblock_pair
        UNIQUE (block_reason_code, unblock_reason_code);


-- ============================================================
-- Block → Unblock Compatibility Mapping
-- ============================================================

-- 🧑 Guest inside room
INSERT INTO block_unblock_compatibility VALUES
                                            ('guest_inside', 'GUEST_LEFT_ROOM'),
                                            ('guest_inside', 'SUPERVISOR_APPROVED'),
                                            ('guest_inside', 'OTHER');

-- 🕒 Guest requested service later
INSERT INTO block_unblock_compatibility VALUES
                                            ('GUEST_REQUESTED_LATER', 'RESUME_AT_REQUESTED_TIME'),
                                            ('GUEST_REQUESTED_LATER', 'SUPERVISOR_APPROVED'),
                                            ('GUEST_REQUESTED_LATER', 'OTHER');

-- 🔒 Room locked / no access
INSERT INTO block_unblock_compatibility VALUES
                                            ('room_locked', 'ROOM_UNLOCKED'),
                                            ('room_locked', 'SUPERVISOR_APPROVED'),
                                            ('room_locked', 'OTHER');

-- 📦 Supplies unavailable
INSERT INTO block_unblock_compatibility VALUES
                                            ('supplies_unavailable', 'SUPPLIES_ARRIVED'),
                                            ('supplies_unavailable', 'WORKAROUND_APPLIED'),
                                            ('supplies_unavailable', 'SUPERVISOR_APPROVED'),
                                            ('supplies_unavailable', 'OTHER');

-- 🔧 Waiting on maintenance
INSERT INTO block_unblock_compatibility VALUES
                                            ('waiting_maintenance', 'MAINTENANCE_COMPLETED'),
                                            ('waiting_maintenance', 'WORKAROUND_APPLIED'),
                                            ('waiting_maintenance', 'SUPERVISOR_APPROVED'),
                                            ('waiting_maintenance', 'OTHER');

-- 🧑‍✈️ Waiting on supervisor approval
INSERT INTO block_unblock_compatibility VALUES
                                            ('supervisor_approval', 'SUPERVISOR_APPROVED'),
                                            ('supervisor_approval', 'OTHER');

-- ✏️ Something else (escape hatch)
INSERT INTO block_unblock_compatibility VALUES
                                            ('something_else', 'OTHER'),
                                            ('something_else', 'SUPERVISOR_APPROVED');

