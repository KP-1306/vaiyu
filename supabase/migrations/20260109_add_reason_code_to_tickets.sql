-- ============================================================
-- Fix: Add missing 'reason_code' column to tickets table
-- This is required for:
-- 1. trg_pause_sla_on_block (SLA triggers)
-- 2. block_task (RPC)
-- ============================================================

ALTER TABLE tickets
ADD COLUMN reason_code TEXT
REFERENCES block_reasons(code);

-- Create index for performance
CREATE INDEX idx_tickets_reason_code
ON tickets (reason_code);
