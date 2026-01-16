-- ============================================================
-- Migration: cancel_reasons
-- Purpose: Create cancel_reasons table and seed data
-- Notes:
--   - Cancellation is terminal (unlike block)
--   - Reasons are role-gated and policy-driven
--   - Used by cancel_ticket RPC + UI dropdowns
-- ============================================================

-- ============================================================
-- Table: cancel_reasons
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cancel_reasons (
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NULL,

  -- Role permissions
  allowed_for_staff BOOLEAN NOT NULL DEFAULT FALSE,
  allowed_for_guest BOOLEAN NOT NULL DEFAULT FALSE,
  allowed_for_supervisor BOOLEAN NOT NULL DEFAULT TRUE,

  -- Workflow rules
  allow_when_new BOOLEAN NOT NULL DEFAULT TRUE,
  allow_when_in_progress BOOLEAN NOT NULL DEFAULT FALSE,

  -- Audit / UX
  requires_comment BOOLEAN NOT NULL DEFAULT FALSE,
  icon TEXT NULL,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  -- Future-proofing
  is_terminal BOOLEAN NOT NULL DEFAULT TRUE,
  intent_category TEXT NOT NULL DEFAULT 'INVALID_REQUEST',

  CONSTRAINT cancel_reasons_pkey PRIMARY KEY (code)
);

-- Index for active reasons lookup
CREATE INDEX IF NOT EXISTS idx_cancel_reasons_active
ON public.cancel_reasons USING btree (is_active);

-- Table documentation
COMMENT ON TABLE public.cancel_reasons IS
'Canonical cancellation reasons. Role-gated and workflow-driven. Do not reuse for blocking.';

-- ============================================================
-- Seed Data: Staff-allowed cancel reasons
-- ============================================================

INSERT INTO public.cancel_reasons (
  code,
  label,
  description,
  allowed_for_staff,
  allowed_for_guest,
  allowed_for_supervisor,
  allow_when_new,
  allow_when_in_progress,
  requires_comment,
  icon,
  is_active,
  is_terminal,
  intent_category
) VALUES


(
  'DUPLICATE_REQUEST',
  'Duplicate request',
  'Another ticket already exists for the same issue',
  TRUE, FALSE, TRUE,
  TRUE, TRUE,
  TRUE,
  'copy',
  TRUE,
  TRUE,
  'INVALID_REQUEST'
),

(
  'OUTSIDE_OPERATIONAL_SCOPE',
  'Outside operational scope',
  'Request is not the responsibility of hotel operations',
  TRUE, FALSE, TRUE,
  TRUE, TRUE,
  TRUE,
  'slash',
  TRUE,
  TRUE,
  'OPERATIONAL_CONSTRAINT'
),

(
  'ROOM_OUT_OF_SERVICE',
  'Room out of service',
  'Room is blocked or unavailable and work is not required',
  TRUE, FALSE, TRUE,
  TRUE, TRUE,
  FALSE,
  'lock',
  TRUE,
  TRUE,
  'OPERATIONAL_CONSTRAINT'
),

(
  'REQUEST_INVALID',
  'Invalid request',
  'Incorrect service, wrong room, or accidental request',
  TRUE, FALSE, TRUE,
  TRUE, TRUE,
  TRUE,
  'alert-circle',
  TRUE,
  TRUE,
  'INVALID_REQUEST'
),

(
  'RESOLVED_BY_OTHER_DEPARTMENT',
  'Resolved by another department',
  'Issue was resolved informally by a different team',
  TRUE, FALSE, TRUE,
  TRUE, TRUE,
  TRUE,
  'users',
  TRUE,
  TRUE,
  'RESOLVED_EXTERNALLY'
),

(
  'RESOLVED_OFF_SYSTEM',
  'Resolved outside the system',
  'Issue was fixed via vendor or manual process without using this ticket',
  TRUE, FALSE, TRUE,
  TRUE, TRUE,
  TRUE,
  'tool',
  TRUE,
  TRUE,
  'RESOLVED_EXTERNALLY'
)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- Seed Data: Supervisor-only cancel reasons
-- ============================================================

INSERT INTO public.cancel_reasons (
  code,
  label,
  description,
  allowed_for_staff,
  allowed_for_guest,
  allowed_for_supervisor,
  allow_when_new,
  allow_when_in_progress,
  requires_comment,
  icon,
  is_active,
  is_terminal,
  intent_category
) VALUES

(
  'POLICY_OVERRIDE',
  'Policy override',
  'Ticket cancelled due to policy decision',
  FALSE, FALSE, TRUE,
  TRUE, TRUE,
  TRUE,
  'shield',
  TRUE,
  TRUE,
  'MANAGEMENT_ACTION'
),

(
  'MANAGEMENT_DECISION',
  'Management decision',
  'Ticket cancelled by management instruction',
  FALSE, FALSE, TRUE,
  TRUE, TRUE,
  TRUE,
  'briefcase',
  TRUE,
  TRUE,
  'MANAGEMENT_ACTION'
),

(
  'COMPENSATION_PROVIDED',
  'Compensation provided',
  'Guest compensated and work cancelled',
  FALSE, FALSE, TRUE,
  TRUE, TRUE,
  TRUE,
  'gift',
  TRUE,
  TRUE,
  'MANAGEMENT_ACTION'
),

(
  'SLA_EXCEPTION_GRANTED',
  'SLA exception granted',
  'Ticket cancelled with SLA exception approval',
  FALSE, FALSE, TRUE,
  TRUE, TRUE,
  TRUE,
  'clock-off',
  TRUE,
  TRUE,
  'SLA_EXCEPTION'
)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- Migration: seed guest-specific cancel reasons
-- Purpose:
--   - Allow guests to cancel their own tickets safely
--   - Reasons represent withdrawal of intent, not operations
-- ============================================================

INSERT INTO public.cancel_reasons (
  code,
  label,
  description,

  allowed_for_guest,
  allowed_for_staff,
  allowed_for_supervisor,

  allow_when_new,
  allow_when_in_progress,

  requires_comment,
  icon,
  is_active,

  is_terminal,
  intent_category
) VALUES

(
  'REQUEST_NO_LONGER_REQUIRED',
  'Request no longer required',
  'Guest no longer needs this service',
  TRUE, FALSE, TRUE,
  TRUE, TRUE,
  FALSE,
  'x-circle',
  TRUE,
  TRUE,
  'INVALID_REQUEST'
),

(
  'REQUEST_MADE_BY_MISTAKE',
  'Request made by mistake',
  'Guest accidentally created the request',
  TRUE, FALSE, TRUE,
  TRUE, TRUE,
  FALSE,
  'undo',
  TRUE,
  TRUE,
  'INVALID_REQUEST'
),

(
  'GUEST_RESOLVED_SELF',
  'Resolved by guest',
  'Guest resolved the issue themselves',
  TRUE, FALSE, TRUE,
  TRUE, TRUE,
  FALSE,
  'check-circle',
  TRUE,
  TRUE,
  'RESOLVED_EXTERNALLY'
)

ON CONFLICT (code) DO NOTHING;

