-- Add upi_id column to hotels table
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS upi_id TEXT;

-- Verify it exists
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'hotels' AND column_name = 'upi_id';
