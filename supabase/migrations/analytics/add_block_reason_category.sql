ALTER TABLE block_reasons
ADD COLUMN category TEXT
CHECK (
  category IN (
    'guest_constraint',
    'dependency',
    'inventory',
    'approval',
    'other'
  )
)
NOT NULL
DEFAULT 'other';


UPDATE block_reasons
SET category = 'guest_constraint'
WHERE code IN (
  'guest_inside',
  'GUEST_REQUESTED_LATER',
  'room_locked'
);

UPDATE block_reasons
SET category = 'dependency'
WHERE code IN (
  'waiting_maintenance'
);

UPDATE block_reasons
SET category = 'inventory'
WHERE code IN (
  'supplies_unavailable'
);


UPDATE block_reasons
SET category = 'approval'
WHERE code IN (
  'supervisor_approval'
);


UPDATE block_reasons
SET category = 'other'
WHERE code IN (
  'something_else'
);