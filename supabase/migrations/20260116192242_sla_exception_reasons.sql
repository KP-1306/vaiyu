-- ============================================================
-- Table: sla_exception_reasons
-- Purpose: Canonical reasons for SLA exception requests
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sla_exception_reasons (
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NULL,

  -- Role gating
  allowed_for_staff BOOLEAN NOT NULL DEFAULT TRUE,
  allowed_for_supervisor BOOLEAN NOT NULL DEFAULT TRUE,

  -- Policy / UX
  requires_comment BOOLEAN NOT NULL DEFAULT TRUE,

  -- Analytics
  category TEXT NOT NULL,

  -- Lifecycle
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  CONSTRAINT sla_exception_reasons_pkey PRIMARY KEY (code)
);

CREATE INDEX IF NOT EXISTS idx_sla_exception_reasons_active
ON public.sla_exception_reasons (is_active);

INSERT INTO public.sla_exception_reasons (
  code,
  label,
  description,
  allowed_for_staff,
  allowed_for_supervisor,
  requires_comment,
  category,
  is_active
) VALUES

(
  'VENDOR_DELAY',
  'Vendor delay',
  'External vendor delay outside hotel control',
  TRUE, TRUE,
  TRUE,
  'EXTERNAL_DEPENDENCY',
  TRUE
),

(
  'SAFETY_OR_COMPLIANCE',
  'Safety or compliance requirement',
  'Work delayed due to safety or regulatory constraints',
  TRUE, TRUE,
  TRUE,
  'POLICY',
  TRUE
),

(
  'STRUCTURAL_OR_INFRA_ISSUE',
  'Structural or infrastructure issue',
  'Underlying infrastructure problem caused unavoidable delay',
  TRUE, TRUE,
  TRUE,
  'INFRASTRUCTURE',
  TRUE
),

(
  'GUEST_UNAVAILABLE',
  'Guest unavailable',
  'Guest not available at required time despite follow-up',
  TRUE, TRUE,
  TRUE,
  'GUEST_DEPENDENCY',
  TRUE
),

(
  'WEATHER_OR_FORCE_MAJEURE',
  'Weather or force majeure',
  'Delay caused by weather or uncontrollable external events',
  TRUE, TRUE,
  TRUE,
  'FORCE_MAJEURE',
  TRUE
),

(
  'MANAGEMENT_OVERRIDE',
  'Management override',
  'Supervisor-approved SLA exception for operational reasons',
  FALSE, TRUE,
  TRUE,
  'MANAGEMENT',
  TRUE
)
ON CONFLICT (code) DO NOTHING;
