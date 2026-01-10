-- ============================================================
-- Fix: Add BLOCK_UPDATED to ticket_events check constraint
--
-- The ticket_events table has a CHECK constraint ensuring
-- event_type is one of a specific list. We need to add
-- 'BLOCK_UPDATED' to this list.
-- ============================================================

ALTER TABLE ticket_events
DROP CONSTRAINT IF EXISTS ticket_events_event_type_check;

ALTER TABLE ticket_events
ADD CONSTRAINT ticket_events_event_type_check
CHECK (event_type IN (
  'CREATED',
  'ASSIGNED',
  'REASSIGNED',
  'STARTED',
  'BLOCKED',
  'UNBLOCKED',
  'COMPLETED',
  'ESCALATED',
  'RESET',
  'PING_SUPERVISOR',
  'BLOCK_UPDATED'  -- <--- New value
));
