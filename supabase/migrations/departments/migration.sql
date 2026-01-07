--------------------------------------------------------
-- 1️⃣ department_templates — System Source of Truth
--------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.department_templates (
                                                           id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Stable system identifier (never changes)
    code TEXT NOT NULL UNIQUE,

    -- Human-readable label
    name TEXT NOT NULL,

    description TEXT NULL,

    display_order INTEGER NOT NULL DEFAULT 0,

    -- Default SLA values (used ONLY to create sla_policies)
    default_target_minutes INTEGER NOT NULL CHECK (default_target_minutes > 0),
    default_warn_minutes INTEGER NOT NULL CHECK (default_warn_minutes >= 0),
    default_escalate_minutes INTEGER NOT NULL CHECK (default_escalate_minutes > default_warn_minutes),

    default_sla_start_trigger TEXT NOT NULL DEFAULT 'ON_ASSIGN'
    CHECK (
              default_sla_start_trigger IN ('ON_CREATE','ON_ASSIGN','ON_SHIFT_START')
    ),

    is_active BOOLEAN NOT NULL DEFAULT true,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

CREATE TRIGGER trg_department_templates_updated
    BEFORE UPDATE ON department_templates
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();


--------------------------------------------------------
-- 2️⃣ Add template reference to departments
--------------------------------------------------------
ALTER TABLE public.departments
    ADD COLUMN IF NOT EXISTS template_id UUID
    REFERENCES department_templates(id);


--------------------------------------------------------
-- 3️⃣ Add is_custom to departments
--------------------------------------------------------
ALTER TABLE public.departments
    ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT false;


--------------------------------------------------------
-- 4️⃣ Backfill is_custom values
--------------------------------------------------------
UPDATE public.departments
SET is_custom = false
WHERE template_id IS NOT NULL;

UPDATE public.departments
SET is_custom = true
WHERE template_id IS NULL;


--------------------------------------------------------
-- 5️⃣ Enforce template ↔ custom consistency
--------------------------------------------------------
ALTER TABLE public.departments
    ADD CONSTRAINT chk_departments_custom_template_consistency
        CHECK (
            (is_custom = true AND template_id IS NULL)
                OR
            (is_custom = false AND template_id IS NOT NULL)
            );


--------------------------------------------------------
-- 6️⃣ Seed department templates
--------------------------------------------------------
INSERT INTO public.department_templates (
    code,
    name,
    display_order,
    default_target_minutes,
    default_warn_minutes,
    default_escalate_minutes,
    default_sla_start_trigger
)
VALUES
    ('HOUSEKEEPING', 'Housekeeping', 1, 30, 0, 45, 'ON_ASSIGN'),
    ('ENGINEERING', 'Engineering', 2, 60, 0, 90, 'ON_ASSIGN'),
    ('FRONT_OFFICE', 'Front Office', 3, 25, 0, 40, 'ON_ASSIGN'),
    ('SECURITY', 'Security', 4, 20, 0, 30, 'ON_ASSIGN'),
    ('IT_SUPPORT', 'IT Support', 5, 60, 0, 90, 'ON_ASSIGN'),
    ('CONCIERGE', 'Concierge', 6, 40, 0, 60, 'ON_ASSIGN'),
    ('MAINTENANCE', 'Maintenance', 7, 45, 0, 70, 'ON_ASSIGN'),
    ('LAUNDRY', 'Laundry', 8, 40, 0, 60, 'ON_ASSIGN')
    ON CONFLICT (code) DO NOTHING;


--------------------------------------------------------
-- 7️⃣ Backfill template_id for matching departments
--------------------------------------------------------
UPDATE public.departments d
SET template_id = dt.id,
    is_custom = false
    FROM public.department_templates dt
WHERE
    upper(d.code) = dt.code
  AND d.template_id IS NULL;




--------------------------------------------------------
-- 2️⃣ Add template linkage to departments
--------------------------------------------------------
ALTER TABLE public.departments
    ADD COLUMN template_id UUID NULL
REFERENCES department_templates(id);
