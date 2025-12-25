-- ============================================================
-- Fix Services Schema & Access
-- 1. Add missing department_id column
-- 2. Backfill existing data
-- 3. Enable RLS and allow public read for active items
-- ============================================================

-- 1. Add department_id if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'services'
        AND column_name = 'department_id'
    ) THEN
        ALTER TABLE services
        ADD COLUMN department_id UUID REFERENCES departments(id);
    END IF;
END $$;

-- 2. Backfill existing data (Prefill default to Housekeeping if missing)
--    We use a subquery to find the ID ensuring we don't crash if it's missing (though it should exist)
UPDATE services
SET department_id = (
  SELECT id FROM departments
  WHERE code = 'HOUSEKEEPING'
  LIMIT 1
)
WHERE department_id IS NULL;

-- 3. Enable RLS
ALTER TABLE services ENABLE ROW LEVEL SECURITY;

-- 4. Create public read policy (scoped to active items)
DROP POLICY IF EXISTS "Allow public read of services" ON services;
DROP POLICY IF EXISTS "Guests can view active services" ON services;

CREATE POLICY "Guests can view active services"
ON services
FOR SELECT
TO public
USING (
  active = true
);

-- 5. Create index for department lookups
CREATE INDEX IF NOT EXISTS idx_services_department
ON services (department_id);
