-- ============================================================
-- 🏛️ SLA TRIGGER ARCHITECT FIX (v3)
-- Features: Self-Healing, Concurrency-Safe, Timezone-Aware
-- ============================================================

-- 1. SCHEMA HARDENING (Idempotent)
-- Add pause_count for audit/debugging
ALTER TABLE ticket_sla_state 
ADD COLUMN IF NOT EXISTS pause_count INT DEFAULT 0;

-- Add constraint to prevent "Paused but not Started" state
-- (We use DO block to avoid error if constraint exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_pause_requires_start') THEN
    ALTER TABLE ticket_sla_state
    ADD CONSTRAINT chk_pause_requires_start
    CHECK (sla_paused_at IS NULL OR sla_started_at IS NOT NULL);
  END IF;
END $$;


-- 2. DROP EXISTING TRIGGERS
DROP TRIGGER IF EXISTS start_sla_on_assign ON tickets;
DROP TRIGGER IF EXISTS pause_sla_on_block ON tickets;
DROP TRIGGER IF EXISTS resume_sla_on_unblock ON tickets;


-- 3. RECREATE FUNCTIONS (The Pro Logic)

-- ✅ A. START SLA (Upsert + Status Guard)
CREATE OR REPLACE FUNCTION trg_start_sla_on_assign()
RETURNS trigger AS $$
DECLARE
  v_start_policy TEXT;
  v_target_minutes INT;
BEGIN
  -- Validate: Don't restart if Completed or Cancelled
  IF NEW.status IN ('COMPLETED', 'CANCELLED') THEN
    RETURN NEW;
  END IF;

  SELECT sla_start_trigger, target_minutes
  INTO v_start_policy, v_target_minutes
  FROM sla_policies
  WHERE department_id = NEW.service_department_id
    AND is_active = true;

  IF v_start_policy = 'ON_ASSIGN'
     AND NEW.current_assignee_id IS NOT NULL
     AND OLD.current_assignee_id IS NULL THEN

    -- 🛡️ GUARDIAN 1: Ensure Row Exists (Self-Healing)
    INSERT INTO ticket_sla_state (ticket_id)
    VALUES (NEW.id)
    ON CONFLICT (ticket_id) DO NOTHING;

    -- Update State
    UPDATE ticket_sla_state
    SET
      sla_started_at = clock_timestamp(), -- 🕒 Precise Time
      sla_resumed_at = clock_timestamp(),
      current_remaining_seconds = (v_target_minutes * 60)
    WHERE ticket_id = NEW.id
      AND sla_started_at IS NULL; -- Idempotent: Only start once
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ✅ B. PAUSE SLA (Start Check + Counter)
CREATE OR REPLACE FUNCTION trg_pause_sla_on_block()
RETURNS trigger AS $$
DECLARE
  v_pauses BOOLEAN;
BEGIN
  SELECT pauses_sla INTO v_pauses
  FROM block_reasons WHERE code = NEW.reason_code;

  IF v_pauses = true AND NEW.status = 'BLOCKED' THEN
    UPDATE ticket_sla_state
    SET 
      sla_paused_at = clock_timestamp(),
      pause_count = COALESCE(pause_count, 0) + 1 -- 📊 Audit Trail
    WHERE ticket_id = NEW.id
      AND sla_paused_at IS NULL
      AND sla_started_at IS NOT NULL; -- 🛡️ GUARDIAN 2: Must be started
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ✅ C. RESUME SLA (Robust Math)
CREATE OR REPLACE FUNCTION trg_resume_sla_on_unblock()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'BLOCKED' AND NEW.status = 'IN_PROGRESS' THEN
    UPDATE ticket_sla_state
    SET
      -- 🛡️ GUARDIAN 3: Null Protection & Precise Math
      total_paused_seconds = 
        COALESCE(total_paused_seconds, 0) + 
        EXTRACT(EPOCH FROM (clock_timestamp() - COALESCE(sla_paused_at, clock_timestamp())))::INT,
      
      sla_paused_at = NULL,
      sla_resumed_at = clock_timestamp()
    WHERE ticket_id = NEW.id
      AND sla_paused_at IS NOT NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- 4. REATTACH TRIGGERS

CREATE TRIGGER start_sla_on_assign
AFTER UPDATE OF current_assignee_id ON tickets
FOR EACH ROW
EXECUTE FUNCTION trg_start_sla_on_assign();

CREATE TRIGGER pause_sla_on_block
AFTER UPDATE OF status ON tickets
FOR EACH ROW
WHEN (NEW.status = 'BLOCKED' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION trg_pause_sla_on_block();

CREATE TRIGGER resume_sla_on_unblock
AFTER UPDATE OF status ON tickets
FOR EACH ROW
WHEN (OLD.status = 'BLOCKED' AND NEW.status = 'IN_PROGRESS')
EXECUTE FUNCTION trg_resume_sla_on_unblock();
