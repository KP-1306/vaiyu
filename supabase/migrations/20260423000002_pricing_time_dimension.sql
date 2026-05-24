-- ============================================================
-- VAiyu: Pricing — Time Dimension (P1)
-- Adds day-of-week, seasonality window, and lead-time fields
-- to pricing_rules so rules can target specific calendar contexts.
--
-- Design notes
--  - applicable_dow: SMALLINT[] with values 0..6 (0=Sunday..6=Saturday).
--    NULL or empty array = matches any day of week.
--  - season_start_mmdd / season_end_mmdd: INT MMDD (101..1231) stored as
--    MM*100+DD. Year-agnostic, supports wrap (e.g. 1215..0115 = mid-Dec
--    through mid-Jan). Both NULL = no seasonal constraint. Both must be
--    non-NULL together.
--  - lead_time_min_days / lead_time_max_days: inclusive days between
--    evaluation date and stay date. NULL = unbounded on that side.
-- ============================================================

BEGIN;

ALTER TABLE public.pricing_rules
  ADD COLUMN IF NOT EXISTS applicable_dow       SMALLINT[] NULL,
  ADD COLUMN IF NOT EXISTS season_start_mmdd    INT NULL,
  ADD COLUMN IF NOT EXISTS season_end_mmdd      INT NULL,
  ADD COLUMN IF NOT EXISTS lead_time_min_days   INT NULL,
  ADD COLUMN IF NOT EXISTS lead_time_max_days   INT NULL;

-- DOW values must be 0..6
ALTER TABLE public.pricing_rules
  DROP CONSTRAINT IF EXISTS chk_pricing_rules_dow_range;
ALTER TABLE public.pricing_rules
  ADD CONSTRAINT chk_pricing_rules_dow_range CHECK (
    applicable_dow IS NULL
    OR applicable_dow <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]
  );

-- MMDD shape: 101..1231 and DD between 1..31. Both-or-neither.
ALTER TABLE public.pricing_rules
  DROP CONSTRAINT IF EXISTS chk_pricing_rules_season_mmdd;
ALTER TABLE public.pricing_rules
  ADD CONSTRAINT chk_pricing_rules_season_mmdd CHECK (
    (season_start_mmdd IS NULL AND season_end_mmdd IS NULL)
    OR (
      season_start_mmdd IS NOT NULL AND season_end_mmdd IS NOT NULL
      AND season_start_mmdd BETWEEN 101 AND 1231
      AND season_end_mmdd   BETWEEN 101 AND 1231
      AND (season_start_mmdd / 100) BETWEEN 1 AND 12
      AND (season_end_mmdd   / 100) BETWEEN 1 AND 12
      AND (season_start_mmdd % 100) BETWEEN 1 AND 31
      AND (season_end_mmdd   % 100) BETWEEN 1 AND 31
    )
  );

-- Lead-time sanity
ALTER TABLE public.pricing_rules
  DROP CONSTRAINT IF EXISTS chk_pricing_rules_lead_time;
ALTER TABLE public.pricing_rules
  ADD CONSTRAINT chk_pricing_rules_lead_time CHECK (
    (lead_time_min_days IS NULL OR lead_time_min_days >= 0)
    AND (lead_time_max_days IS NULL OR lead_time_max_days >= 0)
    AND (
      lead_time_min_days IS NULL
      OR lead_time_max_days IS NULL
      OR lead_time_max_days >= lead_time_min_days
    )
  );

COMMENT ON COLUMN public.pricing_rules.applicable_dow IS
  '0=Sunday..6=Saturday. NULL/empty = any day.';
COMMENT ON COLUMN public.pricing_rules.season_start_mmdd IS
  'MMDD (month*100 + day). Year-agnostic; wraps across year boundary when end < start.';
COMMENT ON COLUMN public.pricing_rules.season_end_mmdd IS
  'MMDD (month*100 + day). See season_start_mmdd.';
COMMENT ON COLUMN public.pricing_rules.lead_time_min_days IS
  'Inclusive minimum days between evaluation date and stay date. NULL = unbounded.';
COMMENT ON COLUMN public.pricing_rules.lead_time_max_days IS
  'Inclusive maximum days between evaluation date and stay date. NULL = unbounded.';

COMMIT;
