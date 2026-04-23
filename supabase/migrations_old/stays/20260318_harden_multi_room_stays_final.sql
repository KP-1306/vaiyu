-- ============================================================
-- Migration: Harden Multi-Room Stays (Vaiyu Production Safe)
-- Purpose:
--   Enable multi-room bookings by removing incorrect uniqueness
--   constraints and keeping only the correct booking_room model.
-- ============================================================

-- ============================================================
-- 0. SAFETY: Ensure correct ("golden") constraint exists
--    One active stay per booking_room_id
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_stays_booking_room_active
ON public.stays (booking_room_id)
WHERE status IN ('arriving', 'inhouse');


-- ============================================================
-- 1. DROP WRONG UNIQUE CONSTRAINTS (NON-BLOCKING)
--    These were preventing multi-room bookings
-- ============================================================

DROP INDEX IF EXISTS public.stays_booking_code_unique;

DROP INDEX IF EXISTS public.uq_stays_booking_active;

DROP INDEX IF EXISTS public.stays_booking_open;


-- ============================================================
-- 2. CLEAN DUPLICATE ROOM OVERLAP CONSTRAINTS
--    Keep ONLY one physical room safety constraint
-- ============================================================

ALTER TABLE public.stays
DROP CONSTRAINT IF EXISTS stays_no_overlap;

ALTER TABLE public.stays
DROP CONSTRAINT IF EXISTS no_room_overlap;

-- NOTE:
-- We KEEP: stays_no_room_overlap (the correct one)


-- ============================================================
-- 3. KEEP booking_code AS LOOKUP ONLY (NON-UNIQUE)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_stays_booking_code
ON public.stays (booking_code)
WHERE booking_code IS NOT NULL;


-- ============================================================
-- 4. (OPTIONAL) VALIDATION CHECKS (SAFE TO RUN)
-- ============================================================

-- Ensure no duplicate active stays per booking_room_id
-- (Should return 0 rows; already validated by you)
-- SELECT booking_room_id, COUNT(*)
-- FROM public.stays
-- WHERE status IN ('arriving','inhouse')
-- GROUP BY booking_room_id
-- HAVING COUNT(*) > 1;


-- ============================================================
-- NOTES (IMPORTANT FOR FUTURE DEVELOPERS)
-- ============================================================

-- ✔ Multi-room bookings are supported via:
--    booking_id → multiple booking_rooms → multiple stays
--
-- ✔ DO NOT reintroduce uniqueness on:
--    booking_id
--    booking_code
--
-- ✔ booking_room_id is the ONLY unit of uniqueness
--
-- ✔ Always populate booking_room_id during check-in
--
-- ✔ For retry-safe inserts use:
--
-- INSERT ... 
-- ON CONFLICT (booking_room_id)
-- WHERE status IN ('arriving','inhouse')
-- DO NOTHING;
--
-- ✔ Guest Board must aggregate stays (NOT show per stay)
--
-- ============================================================
