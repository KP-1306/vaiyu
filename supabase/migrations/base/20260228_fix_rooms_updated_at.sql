-- ============================================================
-- FIX: ADD MISSING updated_at TO rooms TABLE
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'rooms' AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE rooms ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
        
        -- Backfill
        UPDATE rooms SET updated_at = created_at WHERE updated_at IS NULL;
        
        -- Enforce NOT NULL
        ALTER TABLE rooms ALTER COLUMN updated_at SET NOT NULL;
    END IF;
END $$;

-- Ensure trigger function exists (standard helper)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger
DROP TRIGGER IF EXISTS trg_rooms_updated ON rooms;
CREATE TRIGGER trg_rooms_updated
BEFORE UPDATE ON rooms
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
