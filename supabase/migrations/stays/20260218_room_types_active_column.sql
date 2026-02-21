-- Add is_active column to room_types table
-- ==========================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'room_types' AND column_name = 'is_active'
    ) THEN
        ALTER TABLE public.room_types ADD COLUMN is_active BOOLEAN DEFAULT true;
    END IF;
END $$;

-- Update RLS policy if needed (optional, just ensuring SELECT still works)
-- We can add a policy specifically for active room types if needed, 
-- but usually the existing policy covers it. This is just adding the column.
