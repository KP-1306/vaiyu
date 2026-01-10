-- ============================================================
-- 🚀 SLA PERFORMANCE BOOST
-- Purpose: Optimize for "Model A" (Live Calculation)
-- ============================================================

-- 1. DROP DEAD INDEX
-- We no longer query or update `current_remaining_seconds`, so this index is useless write-overhead.
DROP INDEX IF EXISTS idx_sla_state_active;


-- 2. CREATE COVERING INDEX (The "Turbo" Button)
-- Why:
--   The View and Cron Job BOTH look for "Running" tickets
--   and need `sla_started_at` + `total_paused_seconds` for math.
--   Using `INCLUDE` allows Postgres to do the math WITHOUT touching the heap (Index-Only Scan).

CREATE INDEX IF NOT EXISTS idx_sla_running_calc
ON ticket_sla_state (ticket_id)
INCLUDE (sla_started_at, total_paused_seconds)
WHERE sla_started_at IS NOT NULL 
  AND sla_paused_at IS NULL;


-- 3. EXPLANATION
-- Query Pattern:
--   SELECT ... (Now - sla_started_at - total_paused_seconds)
--   FROM ticket_sla_state
--   WHERE ticket_id = ... AND sla_paused_at IS NULL

-- With this index:
--   Postgres finds the ticket_id immediately.
--   It checks the WHERE condition from the index itself.
--   It grabs the values from INCLUDE.
--   Zero Table IO required.
