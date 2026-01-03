--------------------------------------------------------
--1️⃣ service_templates — System Source of Truth
--------------------------------------------------------
CREATE TABLE public.service_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stable system identifier (never changes)
  code TEXT NOT NULL,

  -- Human readable label
  label TEXT NOT NULL,

  -- Default owning department (by CODE, not ID)
  default_department_code TEXT NOT NULL,

  -- Default SLA in minutes (used if no override)
  default_sla_minutes INT NOT NULL CHECK (default_sla_minutes > 0),

  -- Whether Vaiyu ships this service by default
  is_system_default BOOLEAN NOT NULL DEFAULT true,

  -- Whether hotels can create tickets for this service
  is_active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT service_templates_code_unique UNIQUE (code)
);

--------------------------------------------------------
--2️⃣ Supporting Indexes & Trigger
--------------------------------------------------------

-- Fast lookup by department
CREATE INDEX IF NOT EXISTS idx_service_templates_department
ON public.service_templates (default_department_code);

-- Only active services
CREATE INDEX IF NOT EXISTS idx_service_templates_active
ON public.service_templates (is_active);

-- updated_at maintenance
CREATE TRIGGER trg_service_templates_updated
BEFORE UPDATE ON public.service_templates
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

--------------------------------------------------------
--3️⃣ Seed Data (what Vaiyu should ship)
--------------------------------------------------------

INSERT INTO public.service_templates
(code, label, default_department_code, default_sla_minutes)
VALUES
-- Housekeeping
('room_cleaning',        'Room Cleaning',              'HOUSEKEEPING', 45),
('extra_towels',         'Extra Towels',               'HOUSEKEEPING', 20),
('laundry',              'Laundry',                    'HOUSEKEEPING', 60),
('turn_down_service',    'Turn Down Service',          'HOUSEKEEPING', 30),

-- Maintenance / Engineering
('maintenance_ac',       'AC – Not Cooling',           'MAINTENANCE', 30),
('maintenance_plumbing', 'Bathroom / Plumbing Issue', 'MAINTENANCE', 40),
('maintenance_electric', 'Electrical Issue',           'MAINTENANCE', 25),

-- Kitchen / F&B
('room_service',         'Room Service',               'KITCHEN', 30),
('missing_cutlery',      'Missing Cutlery',            'KITCHEN', 15),
('food_delay',           'Food Delivery Delay',        'KITCHEN', 20),

-- Front Desk
('late_checkout',        'Late Checkout Request',      'FRONT_DESK', 10),
('key_card_issue',       'Key Card Issue',              'FRONT_DESK', 5);
