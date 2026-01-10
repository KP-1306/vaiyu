-- ============================================================
-- ⚡ ENABLE REALTIME FOR TICKETS
-- Purpose: Allow Staff UI to react instantly to assignments
-- ============================================================

-- 1. Add table to publication
-- (Safe to run multiple times, but let's be explicit)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'tickets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE tickets;
  END IF;
END $$;
