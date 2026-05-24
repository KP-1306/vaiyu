-- ============================================================
-- VAiyu – pricing_current_rates.applied_by: allow NULL
-- ============================================================
-- Bug caught during auto-apply smoke test:
--   apply_pricing_change_system (added in 20260424000002) passes NULL for
--   applied_by because system-initiated cron runs have no auth.uid().
--   But pricing_current_rates.applied_by is NOT NULL — every cron tick
--   would fail with: "null value in column applied_by violates not-null
--   constraint".
--
-- Fix: make the column nullable. NULL means "system / cron applied".
-- pricing_change_log already has applied_by NULL + a check constraint
-- requiring source='auto' when applied_by IS NULL. This brings
-- pricing_current_rates in line with that pattern.
-- ============================================================

ALTER TABLE public.pricing_current_rates
  ALTER COLUMN applied_by DROP NOT NULL;

COMMENT ON COLUMN public.pricing_current_rates.applied_by IS
  'Auth uid of the user who applied this override. NULL = system-applied (cron / auto-apply edge function).';
