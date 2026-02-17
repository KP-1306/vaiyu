-- FIX: Correctly map room_type_id respecting Hotel ID scope & Enforce Strict Constraints
-- Final production hardening: Table-scoped checks + Zero-downtime index creation.

-- [BLOCK 1] Data Repair & Constraint Hardening (Transactional)
ALTER TABLE public.rooms
ALTER COLUMN room_type_id DROP NOT NULL;

BEGIN;

-- 0. Safety Check: Verify no existing duplicates for the composite unique constraint
DO $$
DECLARE
    v_dup_count INT;
BEGIN
    SELECT COUNT(*) INTO v_dup_count
    FROM (
        SELECT 1 FROM public.room_types
        GROUP BY id, hotel_id
        HAVING COUNT(*) > 1
    ) AS dups;

    IF v_dup_count > 0 THEN
        RAISE EXCEPTION 'Detected % duplicate id/hotel_id pairs in room_types. Fix data before continuing.', v_dup_count;
    END IF;
END $$;

-- 1. Prepare room_types for Composite FK (Table-Scoped Check)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE c.conname = 'uq_room_types_id_hotel'
          AND t.relname = 'room_types'
    ) THEN
        ALTER TABLE public.room_types
        ADD CONSTRAINT uq_room_types_id_hotel UNIQUE (id, hotel_id);
    END IF;
END $$;

-- 2. Prevent ambiguous names per hotel
CREATE UNIQUE INDEX IF NOT EXISTS ux_room_types_hotel_name
ON public.room_types (hotel_id, lower(name));

-- 3. Clean up invalid cross-hotel mappings
UPDATE public.rooms r
SET room_type_id = NULL
WHERE room_type_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM public.room_types rt
    WHERE rt.id = r.room_type_id
    AND rt.hotel_id = r.hotel_id
);

-- 4. Re-map correctly using the Name of the currently linked (but possibly wrong-tenant) room type
-- This handles cases where the 'type' column has already been dropped.
UPDATE public.rooms r
SET room_type_id = rt_correct.id
FROM public.room_types rt_old
JOIN public.room_types rt_correct ON lower(rt_old.name) = lower(rt_correct.name)
WHERE r.room_type_id = rt_old.id
  AND rt_correct.hotel_id = r.hotel_id
  AND r.room_type_id != rt_correct.id;

-- 4b. Optional: If 'type' column DOES still exist, use it as an additional source
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='rooms' AND column_name='type'
    ) THEN
        UPDATE public.rooms r
        SET room_type_id = rt.id
        FROM public.room_types rt
        WHERE lower(r.type) = lower(rt.name)
          AND r.hotel_id = rt.hotel_id
          AND r.room_type_id IS NULL;
    END IF;
END $$;

-- 4c. Orphan Protection: Auto-create 'Standard' room type for hotels that have rooms but no types
-- This is the "Zero-Downtime" way to fix broken data topology.
INSERT INTO public.room_types (hotel_id, name, base_occupancy, max_occupancy)
SELECT DISTINCT r.hotel_id, 'Standard', 2, 3
FROM public.rooms r
LEFT JOIN public.room_types rt ON rt.hotel_id = r.hotel_id
WHERE rt.id IS NULL
ON CONFLICT (hotel_id, lower(name)) DO NOTHING;

-- 4d. Catch-all Fallback: Ensure NO rooms are left with NULL room_type_id
-- Now that we've guaranteed a type exists, this COALESCE will never be NULL.
UPDATE public.rooms r
SET room_type_id = COALESCE(
    (SELECT id FROM public.room_types WHERE hotel_id = r.hotel_id AND lower(name) = 'standard' LIMIT 1),
    (SELECT id FROM public.room_types WHERE hotel_id = r.hotel_id LIMIT 1)
)
WHERE room_type_id IS NULL;

ALTER TABLE public.rooms
ALTER COLUMN room_type_id SET NOT NULL;

-- 5. Apply Strict Composite Foreign Key (Architect Hardened)
ALTER TABLE public.rooms
DROP CONSTRAINT IF EXISTS rooms_room_type_fkey;

ALTER TABLE public.rooms
DROP CONSTRAINT IF EXISTS rooms_room_type_fk;

ALTER TABLE public.rooms
ADD CONSTRAINT rooms_room_type_fk
FOREIGN KEY (room_type_id, hotel_id)
REFERENCES public.room_types (id, hotel_id)
ON UPDATE CASCADE
ON DELETE RESTRICT
NOT VALID;

ALTER TABLE public.rooms
VALIDATE CONSTRAINT rooms_room_type_fk;

COMMIT;

-- [BLOCK 2] Performance Optimization (Non-Transactional for CONCURRENTLY)
-- Supporting Composite Index (Zero-Downtime)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rooms_roomtype_hotel
ON public.rooms (room_type_id, hotel_id);
