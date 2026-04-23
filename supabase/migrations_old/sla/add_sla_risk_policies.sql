-- ============================================================
-- SLA RISK POLICIES
-- ============================================================

CREATE TABLE IF NOT EXISTS sla_risk_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  hotel_id UUID NOT NULL,
  department_id UUID NOT NULL,

  -- Risk calculation knobs
  risk_percent INTEGER NOT NULL DEFAULT 25,
  max_risk_minutes INTEGER NOT NULL DEFAULT 30,
  min_risk_minutes INTEGER NOT NULL DEFAULT 5,

  is_active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (hotel_id, department_id)
);

-- Seed defaults for existing departments (if not exist)
INSERT INTO sla_risk_policies (
  hotel_id,
  department_id,
  risk_percent,
  max_risk_minutes,
  min_risk_minutes,
  is_active
)
SELECT
  d.hotel_id,
  d.id AS department_id,
  25 AS risk_percent,
  30 AS max_risk_minutes,
  5  AS min_risk_minutes,
  true
FROM departments d
WHERE NOT EXISTS (
    SELECT 1
    FROM sla_risk_policies rp
    WHERE rp.hotel_id = d.hotel_id
      AND rp.department_id = d.id
);

-- Enable RLS
ALTER TABLE sla_risk_policies ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can read
CREATE POLICY "Authenticated users can read sla_risk_policies"
ON sla_risk_policies FOR SELECT
TO authenticated
USING (true);

--Add a trigger so this never breaks again: to add default risk policies for new departments
CREATE OR REPLACE FUNCTION trg_seed_risk_policy_on_department_create()
RETURNS trigger AS $$
BEGIN
  INSERT INTO sla_risk_policies (
    hotel_id,
    department_id,
    risk_percent,
    max_risk_minutes,
    min_risk_minutes,
    is_active
  )
  VALUES (
    NEW.hotel_id,
    NEW.id,
    25,
    30,
    5,
    true
  )
  ON CONFLICT (hotel_id, department_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER seed_risk_policy_on_department_create
AFTER INSERT ON departments
FOR EACH ROW
EXECUTE FUNCTION trg_seed_risk_policy_on_department_create();
