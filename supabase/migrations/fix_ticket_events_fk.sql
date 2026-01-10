-- ============================================================
-- Fix: Allow Unblock Reasons in ticket_events
--
-- The ticket_events table currently has a foreign key that enforces
-- reason_code to be present in the 'block_reasons' table.
-- Since we now want to log 'unblock_reasons' in the same column
-- (for UNBLOCKED events), we must remove this strict constraint.
--
-- Note: The validaty of the reason code is already checked
-- by the 'unblock_task' RPC before insertion.
-- ============================================================

ALTER TABLE ticket_events
DROP CONSTRAINT IF EXISTS ticket_events_reason_code_fkey;

-- Optional: If you want to enforce referential integrity rigorously,
-- you would need to implement a trigger constraint that checks
-- both tables, but dropping the standard FK is standard for
-- polymorphic columns.
