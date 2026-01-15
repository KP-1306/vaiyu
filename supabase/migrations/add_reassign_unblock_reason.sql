-- ============================================================
-- Add REASSIGNED_BY_SUPERVISOR to unblock_reasons
-- ============================================================

INSERT INTO unblock_reasons (code, label, description, is_active)
VALUES (
  'REASSIGNED_BY_SUPERVISOR',
  'Reassigned by supervisor',
  'Task was reassigned to different staff by supervisor',
  true
)
ON CONFLICT (code) DO NOTHING;

-- Add compatibility mapping
INSERT INTO block_unblock_compatibility (
  block_reason_code,
  unblock_reason_code
)
VALUES (
  'supervisor_approval',
  'REASSIGNED_BY_SUPERVISOR'
)
ON CONFLICT DO NOTHING;
