-- Add icon column
ALTER TABLE unblock_reasons ADD COLUMN icon TEXT;

-- Update existing records with icons
UPDATE unblock_reasons SET icon = '📦' WHERE code = 'SUPPLIES_ARRIVED';
UPDATE unblock_reasons SET icon = '🏃' WHERE code = 'GUEST_LEFT_ROOM';
UPDATE unblock_reasons SET icon = '🔓' WHERE code = 'ROOM_UNLOCKED';
UPDATE unblock_reasons SET icon = '🔧' WHERE code = 'MAINTENANCE_COMPLETED';
UPDATE unblock_reasons SET icon = '👮' WHERE code = 'SUPERVISOR_APPROVED';
UPDATE unblock_reasons SET icon = '🔄' WHERE code = 'WORKAROUND_APPLIED';
UPDATE unblock_reasons SET icon = '⏰' WHERE code = 'RESUME_AT_REQUESTED_TIME';
UPDATE unblock_reasons SET icon = '📝' WHERE code = 'OTHER';
