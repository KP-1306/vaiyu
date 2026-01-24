-- Create table for SLA Exception Reasons
CREATE TABLE IF NOT EXISTS sla_exception_reasons (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    description TEXT,
    allowed_for_staff BOOLEAN DEFAULT true,
    allowed_for_supervisor BOOLEAN DEFAULT true,
    requires_comment BOOLEAN DEFAULT true,
    category TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    idx INTEGER
);

-- Enable RLS (standard practice)
ALTER TABLE sla_exception_reasons ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON sla_exception_reasons TO authenticated;

-- Seed Data provided by user
INSERT INTO sla_exception_reasons (idx, code, label, description, allowed_for_staff, allowed_for_supervisor, requires_comment, category, is_active)
VALUES 
(0, 'GUEST_UNAVAILABLE', 'Guest unavailable', 'Guest not available at required time despite follow-up', true, true, true, 'GUEST_DEPENDENCY', true),
(1, 'MANAGEMENT_OVERRIDE', 'Management override', 'Supervisor-approved SLA exception for operational reasons', false, true, true, 'MANAGEMENT', true),
(2, 'SAFETY_OR_COMPLIANCE', 'Safety or compliance requirement', 'Work delayed due to safety or regulatory constraints', true, true, true, 'POLICY', true),
(3, 'STRUCTURAL_OR_INFRA_ISSUE', 'Structural or infrastructure issue', 'Underlying infrastructure problem caused unavoidable delay', true, true, true, 'INFRASTRUCTURE', true),
(4, 'VENDOR_DELAY', 'Vendor delay', 'External vendor delay outside hotel control', true, true, true, 'EXTERNAL_DEPENDENCY', true),
(5, 'WEATHER_OR_FORCE_MAJEURE', 'Weather or force majeure', 'Delay caused by weather or uncontrollable external events', true, true, true, 'FORCE_MAJEURE', true)
ON CONFLICT (code) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    allowed_for_staff = EXCLUDED.allowed_for_staff,
    allowed_for_supervisor = EXCLUDED.allowed_for_supervisor,
    requires_comment = EXCLUDED.requires_comment,
    category = EXCLUDED.category,
    is_active = EXCLUDED.is_active,
    idx = EXCLUDED.idx;
