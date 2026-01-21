-- ============================================================
-- DEPARTMENTS & TEMPLATES
-- ============================================================

-- 1. Department Templates
-- ============================================================
CREATE TABLE IF NOT EXISTS department_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  
  default_target_minutes INTEGER NOT NULL CHECK (default_target_minutes > 0),
  default_warn_minutes INTEGER NOT NULL CHECK (default_warn_minutes >= 0),
  default_escalate_minutes INTEGER NOT NULL CHECK (default_escalate_minutes > default_warn_minutes),
  
  default_sla_start_trigger TEXT NOT NULL DEFAULT 'ON_ASSIGN'
    CHECK (default_sla_start_trigger IN ('ON_CREATE','ON_ASSIGN','ON_SHIFT_START')),
    
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_department_templates_updated
BEFORE UPDATE ON department_templates
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2. Link Departments to Templates
-- ============================================================
ALTER TABLE departments ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES department_templates(id);
ALTER TABLE departments ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE departments ADD CONSTRAINT chk_departments_custom_template_consistency
  CHECK ((is_custom = true AND template_id IS NULL) OR (is_custom = false AND template_id IS NOT NULL));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;


-- 3. Seed Templates
-- ============================================================
INSERT INTO department_templates (
  code, name, display_order, default_target_minutes, default_warn_minutes, default_escalate_minutes, default_sla_start_trigger
) VALUES
('HOUSEKEEPING', 'Housekeeping', 1, 30, 0, 45, 'ON_ASSIGN'),
('ENGINEERING', 'Engineering', 2, 60, 0, 90, 'ON_ASSIGN'),
('FRONT_OFFICE', 'Front Office', 3, 25, 0, 40, 'ON_ASSIGN'),
('SECURITY', 'Security', 4, 20, 0, 30, 'ON_ASSIGN'),
('IT_SUPPORT', 'IT Support', 5, 60, 0, 90, 'ON_ASSIGN'),
('CONCIERGE', 'Concierge', 6, 40, 0, 60, 'ON_ASSIGN'),
('MAINTENANCE', 'Maintenance', 7, 45, 0, 70, 'ON_ASSIGN'),
('LAUNDRY', 'Laundry', 8, 40, 0, 60, 'ON_ASSIGN')
ON CONFLICT (code) DO NOTHING;
