-- Walk-in orphan cleanup — PROD, run manually AFTER 20260611000002 is applied.
--
-- Background: before the folio-always fix, a walk-in for an unpriced room
-- created a CHECKED_IN booking + inhouse stay but NO folio (folio creation was
-- gated behind a non-null gross), then the frontend threw "booking/folio id
-- missing". Each failed click left an orphan: a checked-in booking with no
-- folio, and its room shown occupied. The fix prevents NEW orphans (the
-- unpriced-not-comp path now RAISEs and rolls back), but pre-existing orphans
-- must be cleaned up by hand.
--
-- This is a SELECT-FIRST script. Run STEP 1, eyeball the rows, confirm they are
-- genuinely the orphan signature (walk_in / CHECKED_IN / no folio / no payment),
-- THEN run STEP 2 inside the transaction.

-- ─── STEP 1: identify orphans (READ ONLY) ───────────────────────────────
SELECT
  b.id            AS booking_id,
  b.code,
  b.hotel_id,
  b.created_at,
  b.guest_name,
  (SELECT count(*) FROM public.stays s
     WHERE s.booking_id = b.id AND s.status IN ('inhouse','arriving')) AS active_stays,
  (SELECT string_agg(r.number, ', ') FROM public.stays s
     JOIN public.rooms r ON r.id = s.room_id
     WHERE s.booking_id = b.id AND s.status IN ('inhouse','arriving'))  AS rooms_held
FROM public.bookings b
WHERE b.source = 'walk_in'
  AND b.status = 'CHECKED_IN'
  AND NOT EXISTS (SELECT 1 FROM public.folios f       WHERE f.booking_id = b.id)
  AND NOT EXISTS (SELECT 1 FROM public.payments p     WHERE p.booking_id = b.id)
ORDER BY b.created_at DESC;

-- ─── STEP 2: cancel them (frees the rooms). Run only after reviewing STEP 1. ──
-- Cancel rather than hard-delete: keeps an auditable trail and is reversible.
-- Scope is identical to STEP 1's WHERE clause — no row outside it is touched.
/*
BEGIN;

WITH orphans AS (
  SELECT b.id
  FROM public.bookings b
  WHERE b.source = 'walk_in'
    AND b.status = 'CHECKED_IN'
    AND NOT EXISTS (SELECT 1 FROM public.folios f   WHERE f.booking_id = b.id)
    AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.booking_id = b.id)
)
UPDATE public.stays s
   SET status = 'cancelled'
  FROM orphans o
 WHERE s.booking_id = o.id
   AND s.status IN ('inhouse','arriving');

WITH orphans AS (
  SELECT b.id
  FROM public.bookings b
  WHERE b.source = 'walk_in'
    AND b.status = 'CHECKED_IN'
    AND NOT EXISTS (SELECT 1 FROM public.folios f   WHERE f.booking_id = b.id)
    AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.booking_id = b.id)
)
UPDATE public.bookings b
   SET status = 'CANCELLED', cancelled_at = now()
  FROM orphans o
 WHERE b.id = o.id;

-- Inspect counts before COMMIT; ROLLBACK if anything looks off.
COMMIT;
*/
