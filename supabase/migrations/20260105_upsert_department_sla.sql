-- ============================================================
-- SLA Historical Tracking Implementation
-- ============================================================
-- This migration adds:
-- 1. Unique constraint to ensure only one active SLA per department
-- 2. RPC function to handle SLA updates with historical tracking
-- ============================================================

-- ============================================================
-- 1️⃣ Add unique constraint for one active SLA per department
-- ============================================================
-- This prevents data integrity issues by ensuring only one SLA
-- can be active (valid_to IS NULL) for a department at any time

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_sla_per_department
ON sla_policies (department_id)
WHERE valid_to IS NULL;

-- ============================================================
-- 2️⃣ Create RPC function for SLA upsert with historical tracking
-- ============================================================

CREATE OR REPLACE FUNCTION upsert_department_sla(
  p_department_id UUID,
  p_target_minutes INT,
  p_warn_minutes INT,
  p_escalate_minutes INT,
  p_sla_start_trigger TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing_sla_id UUID;
  v_new_sla_id UUID;
BEGIN
  -- ============================================================
  -- Step 1: Check if current active SLA has identical values
  -- If so, return existing ID (no-op prevention)
  -- ============================================================
  SELECT id INTO v_existing_sla_id
  FROM sla_policies
  WHERE department_id = p_department_id
    AND valid_to IS NULL
    AND is_active = true
    AND target_minutes = p_target_minutes
    AND warn_minutes = p_warn_minutes
    AND escalate_minutes = p_escalate_minutes
    AND sla_start_trigger = p_sla_start_trigger;

  -- If values are identical, return existing SLA (no versioning needed)
  IF v_existing_sla_id IS NOT NULL THEN
    RETURN v_existing_sla_id;
  END IF;

  -- ============================================================
  -- Step 2: Mark existing active SLA as inactive (if exists)
  -- ============================================================
  UPDATE sla_policies
  SET 
    valid_to = now(),
    is_active = false,
    updated_at = now()
  WHERE department_id = p_department_id
    AND valid_to IS NULL
    AND is_active = true;

  -- ============================================================
  -- Step 3: Insert new SLA policy
  -- ============================================================
  INSERT INTO sla_policies (
    department_id,
    target_minutes,
    warn_minutes,
    escalate_minutes,
    sla_start_trigger,
    valid_from,
    valid_to,
    is_active,
    created_at,
    updated_at
  )
  VALUES (
    p_department_id,
    p_target_minutes,
    p_warn_minutes,
    p_escalate_minutes,
    p_sla_start_trigger,
    now(),
    NULL,
    true,
    now(),
    now()
  )
  RETURNING id INTO v_new_sla_id;

  RETURN v_new_sla_id;
END;
$$;

-- ============================================================
-- 3️⃣ Grant execute permission to authenticated users
-- ============================================================
GRANT EXECUTE ON FUNCTION upsert_department_sla(UUID, INT, INT, INT, TEXT) TO authenticated;

-- ============================================================
-- 4️⃣ Add helpful comment
-- ============================================================
COMMENT ON FUNCTION upsert_department_sla IS 
'Upserts SLA policy for a department with historical tracking. 
Prevents no-op versioning by checking if values are identical.
Marks old SLA as inactive and creates new version if values changed.';
