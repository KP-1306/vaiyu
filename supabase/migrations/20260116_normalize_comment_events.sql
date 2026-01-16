-- ============================================================
-- Migration: Normalize Comment Event Types
-- Purpose: Consolidate GUEST_COMMENT and STAFF_COMMENT into COMMENT_ADDED
-- Reason: Single event type, rely on actor_type to distinguish
-- ============================================================

-- Update existing GUEST_COMMENT events to COMMENT_ADDED
UPDATE ticket_events
SET event_type = 'COMMENT_ADDED'
WHERE event_type = 'GUEST_COMMENT';

-- Update existing STAFF_COMMENT events to COMMENT_ADDED (if any exist)
UPDATE ticket_events
SET event_type = 'COMMENT_ADDED'
WHERE event_type = 'STAFF_COMMENT';

-- Verify the migration
SELECT 
  event_type,
  actor_type,
  COUNT(*) as count
FROM ticket_events
WHERE event_type = 'COMMENT_ADDED'
GROUP BY event_type, actor_type
ORDER BY actor_type;
