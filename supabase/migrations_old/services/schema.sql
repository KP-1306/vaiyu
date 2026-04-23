-- ============================================================
-- SERVICES & TEMPLATES
-- ============================================================

-- 1. Service Templates (System Source of Truth)
-- ============================================================
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  default_department_code TEXT NOT NULL,
  default_sla_minutes INT NOT NULL CHECK (default_sla_minutes > 0),
  description_en TEXT,
  requires_description BOOLEAN NOT NULL DEFAULT false,
  is_system_default BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_templates_department ON service_templates (default_department_code);
CREATE INDEX IF NOT EXISTS idx_service_templates_active ON service_templates (is_active);

CREATE TRIGGER trg_service_templates_updated
BEFORE UPDATE ON service_templates
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed Data
INSERT INTO service_templates (code, label, default_department_code, default_sla_minutes, description_en, requires_description) VALUES
('room_cleaning', 'Room Cleaning', 'HOUSEKEEPING', 45, 'Schedule a full room cleaning service.', true),
('extra_towels', 'Extra Towels', 'HOUSEKEEPING', 20, 'Fresh towels, toiletries, and bathroom supplies.', false),
('laundry', 'Laundry', 'HOUSEKEEPING', 60, 'Request laundry pickup or ironing services.', true),
('turn_down_service', 'Turn Down Service', 'HOUSEKEEPING', 30, 'Request evening turn down service.', true),
('maintenance_ac', 'AC – Not Cooling', 'MAINTENANCE', 30, 'Report AC or heating issues.', true),
('maintenance_plumbing', 'Bathroom / Plumbing Issue', 'MAINTENANCE', 40, 'Report plumbing issues like leaks or clogs.', true),
('maintenance_electric', 'Electrical Issue', 'MAINTENANCE', 25, 'Report issues with lights or power.', true),
('room_service', 'Room Service', 'KITCHEN', 30, 'Order food and drinks to your room.', false),
('missing_cutlery', 'Missing Cutlery', 'KITCHEN', 15, 'Request cutlery, plates, or glasses.', false),
('food_delay', 'Food Delivery Delay', 'KITCHEN', 20, 'Report a delay in your food order.', false),
('late_checkout', 'Late Checkout Request', 'FRONT_DESK', 10, 'Request a late checkout extensions.', false),
('key_card_issue', 'Key Card Issue', 'FRONT_DESK', 5, 'Get help with key cards or room access.', false)
ON CONFLICT (code) DO UPDATE SET
  description_en = EXCLUDED.description_en,
  requires_description = EXCLUDED.requires_description;


-- 2. Services (Hotel Instances)
-- ============================================================
CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  label_en TEXT,
  description TEXT,
  description_en TEXT,
  requires_description BOOLEAN DEFAULT false,
  
  department_id UUID REFERENCES departments(id),
  template_id UUID REFERENCES service_templates(id),
  
  sla_minutes INTEGER DEFAULT 30,
  active BOOLEAN DEFAULT true,
  priority_weight INTEGER DEFAULT 0,
  is_custom BOOLEAN NOT NULL DEFAULT false,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE (hotel_id, key)
);

CREATE INDEX IF NOT EXISTS idx_services_hotel ON services (hotel_id);
CREATE INDEX IF NOT EXISTS idx_services_hotel_active ON services (hotel_id, active);
CREATE INDEX IF NOT EXISTS idx_services_department ON services (department_id);

CREATE TRIGGER trg_services_updated
BEFORE UPDATE ON services
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Backfill department_id (Fix for Legacy Data)
UPDATE services
SET department_id = (
  SELECT id FROM departments
  WHERE code = 'HOUSEKEEPING'
  LIMIT 1
)
WHERE department_id IS NULL;

-- 3. RLS Policies
-- ============================================================
ALTER TABLE services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read of services" ON services;
DROP POLICY IF EXISTS "Guests can view active services" ON services;

CREATE POLICY "Guests can view active services"
ON services
FOR SELECT
TO public
USING (
  active = true
);


-- 4. Link Tickets to Services
-- ============================================================
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE RESTRICT;

-- Backfill Logic (if running on existing data)
DO $$ BEGIN
  UPDATE tickets t
  SET service_id = s.id
  FROM services s
  WHERE t.service_id IS NULL
    AND t.title = s.label
    AND s.hotel_id = t.hotel_id;
EXCEPTION
  WHEN OTHERS THEN RAISE NOTICE 'Backfill skipped or failed';
END $$;

ALTER TABLE tickets ALTER COLUMN service_id SET NOT NULL;
