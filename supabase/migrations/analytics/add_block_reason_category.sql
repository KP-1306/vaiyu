-- Add category to block_reasons
ALTER TABLE block_reasons ADD COLUMN category TEXT CHECK (category IN ('delay', 'inventory', 'other')) DEFAULT 'other';

-- Update existing reasons (example mapping)
UPDATE block_reasons SET category = 'delay' WHERE code LIKE '%wait%' OR code LIKE '%delay%' OR code LIKE '%prevent%';
UPDATE block_reasons SET category = 'inventory' WHERE code LIKE '%stock%' OR code LIKE '%inventory%';
-- Others remain 'other' by default
