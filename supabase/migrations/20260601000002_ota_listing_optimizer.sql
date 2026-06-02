-- OTA Listing Optimizer v0 — Growth Hub Position 2 (growth sheet)
--
-- INTERNAL OTA-readiness self-audit workbook. Helps owners identify what's
-- missing across 8 OTAs (MMT, Goibibo, Booking.com, Agoda, Airbnb, Expedia,
-- Yatra, TripAdvisor) using deterministic readiness scoring per category.
-- Visibility Score signal `ota_listing_ready` reads from this module.
--
-- This is NOT:
--   • A channel manager (no inventory/rate sync to OTAs)
--   • OTA automation (no API calls, no scraping, no browser automation)
--   • An OTA ranking predictor (we do not claim to predict bookings)
--   • A booking/revenue forecaster
--   • An AI feature (no LLM calls, no embeddings, no learned weights)
--   • A public-publishing surface
--
-- Two tables (lean per architectural review — no catalog table, no events table):
--   • hotel_ota_optimizer_settings  — per-hotel preferences (active OTAs,
--                                     mountain override, wizard completion)
--   • hotel_ota_readiness_state     — per (hotel × OTA × category × item)
--                                     status row with reviewed_at staleness
--
-- Five enums:
--   • ota_platform               — 8 OTAs supported in v0
--   • ota_readiness_category     — 11 categories (10 generic + 1 mountain)
--   • ota_readiness_status       — 5 states (COMPLETE / PARTIAL / MISSING /
--                                 UNKNOWN / NOT_APPLICABLE)
--   • ota_readiness_band         — 3 bands (CRITICAL < 50, MODERATE 50-80,
--                                 PREMIUM ≥ 80)
--   • ota_review_action          — 4 actions (STATUS_SET / BULK_SET /
--                                 REVIEW_COMPLETED / WIZARD_COMPLETED) —
--                                 used as audit-log action enum only, not a
--                                 column on any table
--
-- Catalog approach (per architectural review):
--   • _ota_catalog() SQL function = authoritative weights + applicability
--     rules for ~52 items across 11 categories. Returns rows; no catalog
--     table. Bumping requires version bump + TS mirror update.
--   • web/src/config/otaOptimizer.ts = labels (EN+Hi), descriptions,
--     fix-action deep-link paths, tone tokens.
--   • Vitest parity test asserts SQL catalog ↔ TS catalog key-set match.
--
-- Scoring rules (deterministic, no AI):
--   • Each item has a numeric weight within its category
--   • Status → earned ratio: COMPLETE=1.0, PARTIAL=0.5, MISSING=0, UNKNOWN=0
--   • NOT_APPLICABLE excluded from both earned and possible (denominator)
--   • Mountain-only items contribute only when hotel is mountain (derived
--     from hotels.state shortlist OR per-hotel override)
--   • OTA-specific N/A items excluded per OTA (e.g., room_naming on Airbnb)
--   • OTA score = 100 * SUM(earned) / SUM(possible), per OTA
--   • Hotel overall = AVG(ota_score) across active OTAs
--   • Bands: PREMIUM ≥ 80, MODERATE 50–80, CRITICAL < 50
--
-- Staleness rules (TTL):
--   • reviewed_at ≥ now() - 90d  → fresh
--   • reviewed_at < now() - 90d  → stale (UI badge, still counted)
--   • reviewed_at < now() - 120d → expired (treated as UNKNOWN for scoring)
--
-- Mountain gating:
--   • State-derived default: hotels.state IN _ota_mountain_states()
--   • Per-hotel override: hotel_ota_optimizer_settings.show_mountain_checks_override
--     (NULLABLE: null = use derived; true/false = explicit override)
--   • Mountain-only catalog items invisible (and excluded from scoring) when
--     mountain is false.
--
-- Audit:
--   • All writes audit to va_audit_logs (no per-entity events table)
--   • action ∈ ('ota_status_set','ota_bulk_set','ota_review_completed',
--               'ota_wizard_completed','ota_active_otas_set',
--               'ota_mountain_override_set','ota_reset')
--   • entity = 'ota_readiness_state' | 'ota_optimizer_settings'
--
-- Governance:
--   • All members can mutate readiness (no manager-only paths in v0 — this is
--     a self-audit workbook, not a regulated finance flow)
--   • Wizard idempotent: re-runnable; UPSERT-based
--   • Owner can reset all states (auditable)
--
-- OTA compliance (per PO spec, verbatim):
--   • Zero OTA API calls
--   • Zero scraping
--   • Zero credentials collected
--   • Zero auto-actions (every status change is owner-driven)
--
-- Per CLAUDE.md:
--   • Multi-tenancy: vaiyu_is_hotel_member RLS + RPC-level recheck
--   • Audit: writes go to va_audit_logs (shared infra; no new events table)
--   • Writes via SECURITY DEFINER RPCs only — direct INSERT/UPDATE/DELETE revoked
--   • No phase 2, no deferred items — every reviewer concern landed in v1

-- ─── Enums ──────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.ota_platform AS ENUM (
    'MMT',
    'GOIBIBO',
    'BOOKING_COM',
    'AGODA',
    'AIRBNB',
    'EXPEDIA',
    'YATRA',
    'TRIPADVISOR'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ota_readiness_category AS ENUM (
    'LISTING_QUALITY',
    'PHOTOS_MEDIA',
    'ROOM_NAMING',
    'AMENITIES_FACILITIES',
    'POLICIES',
    'REVIEW_DISCIPLINE',
    'PAYMENT_BOOKING_CLARITY',
    'SEASONAL_POSITIONING',
    'TRUST_SIGNALS',
    'DIRECT_BOOKING_READINESS',
    'MOUNTAIN_DISCLOSURE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ota_readiness_status AS ENUM (
    'COMPLETE',
    'PARTIAL',
    'MISSING',
    'UNKNOWN',
    'NOT_APPLICABLE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ota_readiness_band AS ENUM (
    'CRITICAL',
    'MODERATE',
    'PREMIUM'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Helper: mountain-state shortlist (text[]) ──────────────────────────────
-- IMMUTABLE constant function. Mirrors web/src/config/otaOptimizer.ts
-- MOUNTAIN_STATES array. Used to derive default mountain-checks visibility
-- when the per-hotel override is null. Matches Seasonal Calendar's
-- region_state_codes pattern (state codes from hotels.state, not full names).

CREATE OR REPLACE FUNCTION public._ota_mountain_states()
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$
  SELECT ARRAY[
    'Uttarakhand',
    'Himachal Pradesh',
    'Jammu and Kashmir',
    'Ladakh',
    'Sikkim',
    'Arunachal Pradesh'
  ]::text[];
$$;
COMMENT ON FUNCTION public._ota_mountain_states() IS
  'Default mountain-state shortlist for auto-deriving show_mountain_checks. Per-hotel override on hotel_ota_optimizer_settings takes precedence when set. TS mirror in web/src/config/otaOptimizer.ts; vitest parity test enforces no drift.';

-- ─── Helper: catalog (authoritative weights + applicability) ────────────────
-- IMMUTABLE so it can be inlined by the planner. Returns one row per
-- (category, item_key). TS mirror in web/src/config/otaOptimizer.ts;
-- vitest parity test asserts key-set match.
--
-- Weight semantics: relative within the catalog. The view normalizes by
-- SUM(possible) so absolute scale doesn't matter; we keep weights small
-- integers for legibility.
--
-- not_applicable_otas: OTAs where this item structurally cannot apply
-- (e.g., room_naming on Airbnb where listings are single units; payment
-- methods on TripAdvisor where it's a review-only platform).

CREATE OR REPLACE FUNCTION public._ota_catalog()
RETURNS TABLE (
  catalog_version       int,
  category              public.ota_readiness_category,
  item_key              text,
  weight                numeric,
  is_mountain_only      boolean,
  not_applicable_otas   public.ota_platform[],
  display_order         int
)
LANGUAGE sql IMMUTABLE
AS $$
  WITH rows(category, item_key, weight, is_mountain_only, not_applicable_otas, display_order) AS (
    VALUES
      -- ─── LISTING_QUALITY (category weight 12, 4 items) ─────────────────
      ('LISTING_QUALITY'::public.ota_readiness_category, 'title_quality',            4::numeric, false, ARRAY[]::public.ota_platform[], 10),
      ('LISTING_QUALITY',          'description_clear',        4, false, ARRAY[]::public.ota_platform[], 11),
      ('LISTING_QUALITY',          'uniqueness',               2, false, ARRAY[]::public.ota_platform[], 12),
      ('LISTING_QUALITY',          'consistency_across_otas',  2, false, ARRAY[]::public.ota_platform[], 13),

      -- ─── PHOTOS_MEDIA (category weight 18, 7 items) ────────────────────
      ('PHOTOS_MEDIA',             'exterior_photos',          4, false, ARRAY[]::public.ota_platform[], 20),
      ('PHOTOS_MEDIA',             'room_photos',              4, false, ARRAY[]::public.ota_platform[], 21),
      ('PHOTOS_MEDIA',             'bathroom_photos',          2, false, ARRAY[]::public.ota_platform[], 22),
      ('PHOTOS_MEDIA',             'dining_photos',            2, false, ARRAY[]::public.ota_platform[], 23),
      ('PHOTOS_MEDIA',             'common_area_photos',       2, false, ARRAY[]::public.ota_platform[], 24),
      ('PHOTOS_MEDIA',             'parking_photos',           2, false, ARRAY[]::public.ota_platform[], 25),
      ('PHOTOS_MEDIA',             'attraction_photos',        2, false, ARRAY[]::public.ota_platform[], 26),

      -- ─── ROOM_NAMING (cat 6, 3 items) — N/A on Airbnb (single-unit) ────
      ('ROOM_NAMING',              'naming_consistency',       2, false, ARRAY['AIRBNB']::public.ota_platform[], 30),
      ('ROOM_NAMING',              'differentiation',          2, false, ARRAY['AIRBNB']::public.ota_platform[], 31),
      ('ROOM_NAMING',              'occupancy_clarity',        2, false, ARRAY[]::public.ota_platform[], 32),

      -- ─── AMENITIES_FACILITIES (cat 9, 3 items) ─────────────────────────
      ('AMENITIES_FACILITIES',     'amenities_complete',       3, false, ARRAY[]::public.ota_platform[], 40),
      ('AMENITIES_FACILITIES',     'facilities_clear',         3, false, ARRAY[]::public.ota_platform[], 41),
      ('AMENITIES_FACILITIES',     'service_visibility',       3, false, ARRAY[]::public.ota_platform[], 42),

      -- ─── POLICIES (cat 12, 5 items) ────────────────────────────────────
      ('POLICIES',                 'cancellation_policy',      4, false, ARRAY[]::public.ota_platform[], 50),
      ('POLICIES',                 'child_policy',             2, false, ARRAY[]::public.ota_platform[], 51),
      ('POLICIES',                 'pet_policy',               2, false, ARRAY[]::public.ota_platform[], 52),
      ('POLICIES',                 'checkin_policy',           2, false, ARRAY[]::public.ota_platform[], 53),
      ('POLICIES',                 'checkout_policy',          2, false, ARRAY[]::public.ota_platform[], 54),

      -- ─── REVIEW_DISCIPLINE (cat 10, 3 items) ───────────────────────────
      ('REVIEW_DISCIPLINE',        'review_collection',        3, false, ARRAY[]::public.ota_platform[], 60),
      ('REVIEW_DISCIPLINE',        'review_response',          4, false, ARRAY[]::public.ota_platform[], 61),
      ('REVIEW_DISCIPLINE',        'trust_management',         3, false, ARRAY[]::public.ota_platform[], 62),

      -- ─── PAYMENT_BOOKING_CLARITY (cat 8, 3 items) — N/A on TripAdvisor
      ('PAYMENT_BOOKING_CLARITY',  'payment_methods',          3, false, ARRAY['TRIPADVISOR']::public.ota_platform[], 70),
      ('PAYMENT_BOOKING_CLARITY',  'booking_policy',           3, false, ARRAY['TRIPADVISOR']::public.ota_platform[], 71),
      ('PAYMENT_BOOKING_CLARITY',  'refund_policy',            2, false, ARRAY['TRIPADVISOR']::public.ota_platform[], 72),

      -- ─── SEASONAL_POSITIONING (cat 8, 4 items) ─────────────────────────
      ('SEASONAL_POSITIONING',     'summer_readiness',         2, false, ARRAY[]::public.ota_platform[], 80),
      ('SEASONAL_POSITIONING',     'winter_readiness',         2, false, ARRAY[]::public.ota_platform[], 81),
      ('SEASONAL_POSITIONING',     'monsoon_readiness',        2, false, ARRAY[]::public.ota_platform[], 82),
      ('SEASONAL_POSITIONING',     'festival_readiness',       2, false, ARRAY[]::public.ota_platform[], 83),

      -- ─── TRUST_SIGNALS (cat 8, 3 items) ────────────────────────────────
      ('TRUST_SIGNALS',            'verification_ready',       3, false, ARRAY[]::public.ota_platform[], 90),
      ('TRUST_SIGNALS',            'brand_assets',             3, false, ARRAY[]::public.ota_platform[], 91),
      ('TRUST_SIGNALS',            'business_proof',           2, false, ARRAY[]::public.ota_platform[], 92),

      -- ─── DIRECT_BOOKING_READINESS (cat 9, 4 items) ─────────────────────
      ('DIRECT_BOOKING_READINESS', 'website_ready',            3, false, ARRAY[]::public.ota_platform[], 100),
      ('DIRECT_BOOKING_READINESS', 'microsite_ready',          2, false, ARRAY[]::public.ota_platform[], 101),
      ('DIRECT_BOOKING_READINESS', 'whatsapp_ready',           2, false, ARRAY[]::public.ota_platform[], 102),
      ('DIRECT_BOOKING_READINESS', 'enquiry_ready',            2, false, ARRAY[]::public.ota_platform[], 103),

      -- ─── MOUNTAIN_DISCLOSURE (cat 30, 13 items, mountain-only) ─────────
      ('MOUNTAIN_DISCLOSURE',      'parking_visibility',       3, true,  ARRAY[]::public.ota_platform[], 200),
      ('MOUNTAIN_DISCLOSURE',      'road_approach',            3, true,  ARRAY[]::public.ota_platform[], 201),
      ('MOUNTAIN_DISCLOSURE',      'steep_road_disclosure',    3, true,  ARRAY[]::public.ota_platform[], 202),
      ('MOUNTAIN_DISCLOSURE',      'monsoon_access',           3, true,  ARRAY[]::public.ota_platform[], 203),
      ('MOUNTAIN_DISCLOSURE',      'winter_snow_readiness',    2, true,  ARRAY[]::public.ota_platform[], 204),
      ('MOUNTAIN_DISCLOSURE',      'heating_info',             2, true,  ARRAY[]::public.ota_platform[], 205),
      ('MOUNTAIN_DISCLOSURE',      'hot_water_info',           2, true,  ARRAY[]::public.ota_platform[], 206),
      ('MOUNTAIN_DISCLOSURE',      'wifi_quality',             2, true,  ARRAY[]::public.ota_platform[], 207),
      ('MOUNTAIN_DISCLOSURE',      'power_backup',             2, true,  ARRAY[]::public.ota_platform[], 208),
      ('MOUNTAIN_DISCLOSURE',      'workation_ready',          2, true,  ARRAY[]::public.ota_platform[], 209),
      ('MOUNTAIN_DISCLOSURE',      'driver_stay_availability', 2, true,  ARRAY[]::public.ota_platform[], 210),
      ('MOUNTAIN_DISCLOSURE',      'pet_policy_mountain',      2, true,  ARRAY[]::public.ota_platform[], 211),
      ('MOUNTAIN_DISCLOSURE',      'early_checkin_clarity',    2, true,  ARRAY[]::public.ota_platform[], 212)
  )
  SELECT 1::int AS catalog_version, * FROM rows;
$$;
COMMENT ON FUNCTION public._ota_catalog() IS
  'Authoritative OTA Listing Optimizer catalog. ~52 items across 11 categories. catalog_version bumped on every change; TS mirror in web/src/config/otaOptimizer.ts + vitest parity test enforces no silent drift. Non-mountain items sum to 100 (relative weight); mountain items add 30 for mountain hotels. View normalizes by SUM(possible) so absolute scale is invariant.';

-- ─── Helper: catalog item existence check ───────────────────────────────────
-- Used by RPC input validation to reject orphaned writes. We don't FK to
-- a catalog table (because there isn't one); instead, the RPC enforces it.

CREATE OR REPLACE FUNCTION public._ota_catalog_has_item(
  p_category public.ota_readiness_category,
  p_item_key text
)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public._ota_catalog() c
     WHERE c.category = p_category AND c.item_key = p_item_key
  );
$$;
COMMENT ON FUNCTION public._ota_catalog_has_item(public.ota_readiness_category, text) IS
  'Returns true iff (category, item_key) is in the current catalog. Called by every state-write RPC to reject orphaned writes since we do not have a catalog table to FK against.';

-- ─── Table: hotel_ota_optimizer_settings ────────────────────────────────────
-- Per-hotel preferences row. One row per hotel (PK on hotel_id). Created
-- lazily on first wizard step or first active-OTA mutation.

CREATE TABLE IF NOT EXISTS public.hotel_ota_optimizer_settings (
  hotel_id                          uuid PRIMARY KEY REFERENCES public.hotels(id) ON DELETE CASCADE,

  -- Which OTAs the owner currently lists on. Defaults to all 8 (per user's
  -- locked decision). Owner can toggle off ones they don't list on; those
  -- OTAs are excluded from scoring and matrix display.
  active_otas                       public.ota_platform[] NOT NULL DEFAULT ARRAY[
    'MMT','GOIBIBO','BOOKING_COM','AGODA','AIRBNB','EXPEDIA','YATRA','TRIPADVISOR'
  ]::public.ota_platform[],

  -- Mountain-checks visibility override:
  --   NULL  → derive from hotels.state ∈ _ota_mountain_states()
  --   TRUE  → force mountain checks ON (e.g., Tamil Nadu's Ooty)
  --   FALSE → force mountain checks OFF (e.g., plains hotel marketing as 'mountain getaway')
  show_mountain_checks_override     boolean,

  -- Wizard completion stamp — UI shows resume-wizard CTA when null.
  wizard_completed_at               timestamptz,

  -- Bookkeeping
  created_at                        timestamptz NOT NULL DEFAULT now(),
  updated_at                        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ota_settings_active_otas_nonempty
    CHECK (array_length(active_otas, 1) >= 1)
);
COMMENT ON TABLE public.hotel_ota_optimizer_settings IS
  'Per-hotel preferences for OTA Listing Optimizer. active_otas selects which platforms to score; show_mountain_checks_override is a nullable per-hotel override for the state-derived mountain check default. Wizard completion timestamp drives cold-start UX.';

CREATE INDEX IF NOT EXISTS idx_ota_settings_hotel
  ON public.hotel_ota_optimizer_settings(hotel_id);

DROP TRIGGER IF EXISTS trg_ota_settings_updated_at
  ON public.hotel_ota_optimizer_settings;
CREATE TRIGGER trg_ota_settings_updated_at
  BEFORE UPDATE ON public.hotel_ota_optimizer_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Table: hotel_ota_readiness_state ───────────────────────────────────────
-- Per (hotel × OTA × category × item_key) status row. Items are referenced
-- by (category, item_key) text — no FK to a catalog table since the catalog
-- lives in _ota_catalog() SQL function. The bulk-set/single-set RPCs validate
-- against _ota_catalog_has_item() before insert.

CREATE TABLE IF NOT EXISTS public.hotel_ota_readiness_state (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id     uuid NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  ota          public.ota_platform NOT NULL,
  category     public.ota_readiness_category NOT NULL,
  item_key     text NOT NULL CHECK (length(item_key) BETWEEN 1 AND 64),
  status       public.ota_readiness_status NOT NULL DEFAULT 'UNKNOWN',

  -- Staleness driver. Bumped on every status change AND on review-complete
  -- stamp (so an owner who has reviewed a stale-but-still-correct item can
  -- refresh its freshness without changing the status).
  reviewed_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Optional owner note (max 2000 chars — matches Seasonal Calendar / SEO Planner)
  note         text CHECK (note IS NULL OR length(note) <= 2000),

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT hotel_ota_readiness_state_uq UNIQUE (hotel_id, ota, category, item_key)
);
COMMENT ON TABLE public.hotel_ota_readiness_state IS
  'Per (hotel × OTA × category × item_key) status row. (category, item_key) references _ota_catalog() — validated by write RPCs since there is no catalog table to FK against. reviewed_at drives the 90d/120d staleness UX. Missing rows are treated as UNKNOWN by the view.';

CREATE INDEX IF NOT EXISTS idx_ota_state_hotel_ota_cat
  ON public.hotel_ota_readiness_state(hotel_id, ota, category);
CREATE INDEX IF NOT EXISTS idx_ota_state_hotel_reviewed
  ON public.hotel_ota_readiness_state(hotel_id, reviewed_at);

DROP TRIGGER IF EXISTS trg_ota_state_updated_at
  ON public.hotel_ota_readiness_state;
CREATE TRIGGER trg_ota_state_updated_at
  BEFORE UPDATE ON public.hotel_ota_readiness_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Helper: effective mountain flag (state-derived + override) ─────────────
-- Returns boolean. Reads hotels.state and hotel_ota_optimizer_settings.
-- STABLE (depends on table contents but not on session state).

CREATE OR REPLACE FUNCTION public._ota_effective_mountain(p_hotel_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    s.show_mountain_checks_override,
    (SELECT h.state = ANY(public._ota_mountain_states())
       FROM public.hotels h WHERE h.id = p_hotel_id)
  )
  FROM public.hotel_ota_optimizer_settings s
  WHERE s.hotel_id = p_hotel_id
  UNION ALL
  -- Fallback: no settings row yet — derive purely from state
  SELECT (h.state = ANY(public._ota_mountain_states()))
    FROM public.hotels h
   WHERE h.id = p_hotel_id
     AND NOT EXISTS (SELECT 1 FROM public.hotel_ota_optimizer_settings s2 WHERE s2.hotel_id = p_hotel_id)
  LIMIT 1;
$$;
COMMENT ON FUNCTION public._ota_effective_mountain(uuid) IS
  'Returns the effective mountain-checks flag for a hotel. Per-hotel override (when set) takes precedence; otherwise derived from hotels.state ∈ _ota_mountain_states(). Returns NULL only if the hotel does not exist.';

-- ─── View: v_hotel_ota_readiness (per-OTA score breakdown) ──────────────────
-- One row per (hotel × active OTA). The hotel filter is via
-- vaiyu_is_hotel_member (defense-in-depth — lesson from Seasonal Calendar
-- leak where view used security_invoker only but hotels has permissive
-- public-read policies).
--
-- Staleness: items with reviewed_at < now() - 120d are treated as UNKNOWN
-- for scoring purposes (oldest_review_at exposed for UI staleness badge).

DROP VIEW IF EXISTS public.v_hotel_ota_readiness CASCADE;
CREATE VIEW public.v_hotel_ota_readiness WITH (security_invoker = on) AS
WITH member_hotels AS (
  SELECT h.id AS hotel_id, h.state, h.slug, h.name
  FROM public.hotels h
  WHERE public.vaiyu_is_hotel_member(h.id)
),
hotel_settings AS (
  SELECT mh.hotel_id, mh.state, mh.slug, mh.name,
         COALESCE(s.active_otas, ARRAY[
           'MMT','GOIBIBO','BOOKING_COM','AGODA','AIRBNB','EXPEDIA','YATRA','TRIPADVISOR'
         ]::public.ota_platform[]) AS active_otas,
         COALESCE(
           s.show_mountain_checks_override,
           mh.state = ANY(public._ota_mountain_states())
         ) AS effective_mountain,
         s.wizard_completed_at,
         s.hotel_id IS NOT NULL AS settings_exists
  FROM member_hotels mh
  LEFT JOIN public.hotel_ota_optimizer_settings s ON s.hotel_id = mh.hotel_id
),
active_grid AS (
  -- Cartesian: hotels × their active OTAs × applicable catalog items
  SELECT hs.hotel_id, hs.slug, hs.name, hs.wizard_completed_at, hs.effective_mountain,
         unnest(hs.active_otas) AS ota,
         c.category, c.item_key, c.weight, c.is_mountain_only, c.not_applicable_otas
  FROM hotel_settings hs
  CROSS JOIN public._ota_catalog() c
),
applicable AS (
  -- Filter out mountain-only items for non-mountain hotels + OTA-specific N/A
  SELECT *
  FROM active_grid ag
  WHERE (NOT ag.is_mountain_only OR ag.effective_mountain = true)
    AND NOT (ag.ota = ANY(ag.not_applicable_otas))
),
scored AS (
  SELECT
    a.hotel_id, a.slug, a.name, a.ota, a.category, a.item_key, a.weight,
    a.wizard_completed_at, a.effective_mountain,
    -- Effective status: missing row → UNKNOWN; expired → UNKNOWN; explicit NA → NA
    CASE
      WHEN s.id IS NULL THEN 'UNKNOWN'::public.ota_readiness_status
      WHEN s.status = 'NOT_APPLICABLE' THEN 'NOT_APPLICABLE'::public.ota_readiness_status
      WHEN s.reviewed_at < now() - INTERVAL '120 days' THEN 'UNKNOWN'::public.ota_readiness_status
      ELSE s.status
    END AS effective_status,
    s.reviewed_at,
    s.note,
    -- Mark stale items for UI badge (>90d but ≤120d). Expired items already
    -- reverted to UNKNOWN above (so this flag only matters when status fresh).
    (s.id IS NOT NULL
      AND s.reviewed_at < now() - INTERVAL '90 days'
      AND s.reviewed_at >= now() - INTERVAL '120 days') AS is_stale
  FROM applicable a
  LEFT JOIN public.hotel_ota_readiness_state s
    ON s.hotel_id = a.hotel_id
   AND s.ota = a.ota
   AND s.category = a.category
   AND s.item_key = a.item_key
),
contributions AS (
  SELECT *,
    CASE effective_status
      WHEN 'COMPLETE'       THEN weight
      WHEN 'PARTIAL'        THEN weight * 0.5
      WHEN 'NOT_APPLICABLE' THEN NULL
      ELSE 0
    END AS earned,
    CASE effective_status
      WHEN 'NOT_APPLICABLE' THEN NULL
      ELSE weight
    END AS possible
  FROM scored
)
SELECT
  hotel_id,
  slug AS hotel_slug,
  name AS hotel_name,
  ota,
  wizard_completed_at,
  effective_mountain,
  COALESCE(ROUND(100.0 * SUM(earned) / NULLIF(SUM(possible), 0), 1), 0) AS ota_score,
  CASE
    WHEN SUM(possible) IS NULL OR SUM(possible) = 0 THEN 'CRITICAL'::public.ota_readiness_band
    WHEN 100.0 * SUM(earned) / SUM(possible) >= 80 THEN 'PREMIUM'::public.ota_readiness_band
    WHEN 100.0 * SUM(earned) / SUM(possible) >= 50 THEN 'MODERATE'::public.ota_readiness_band
    ELSE 'CRITICAL'::public.ota_readiness_band
  END AS band,
  MIN(reviewed_at) AS oldest_review_at,
  COUNT(*) FILTER (WHERE effective_status = 'COMPLETE')        AS complete_count,
  COUNT(*) FILTER (WHERE effective_status = 'PARTIAL')         AS partial_count,
  COUNT(*) FILTER (WHERE effective_status = 'MISSING')         AS missing_count,
  COUNT(*) FILTER (WHERE effective_status = 'UNKNOWN')         AS unknown_count,
  COUNT(*) FILTER (WHERE effective_status = 'NOT_APPLICABLE')  AS na_count,
  COUNT(*) FILTER (WHERE is_stale)                              AS stale_count,
  COUNT(*) AS total_count
FROM contributions
GROUP BY hotel_id, slug, name, ota, wizard_completed_at, effective_mountain;
COMMENT ON VIEW public.v_hotel_ota_readiness IS
  'Per-(hotel × active OTA) readiness breakdown. Filters: hotel membership (defense-in-depth via WHERE clause), active OTAs from settings (or all 8 default), mountain-only items per hotel mountain flag, OTA-specific N/A items. Staleness: items >120d are treated as UNKNOWN for scoring; >90d but ≤120d marked is_stale for UI badge.';

-- ─── View: v_hotel_ota_readiness_summary (hotel-overall) ────────────────────

DROP VIEW IF EXISTS public.v_hotel_ota_readiness_summary CASCADE;
CREATE VIEW public.v_hotel_ota_readiness_summary WITH (security_invoker = on) AS
SELECT
  hotel_id,
  hotel_slug,
  hotel_name,
  wizard_completed_at,
  effective_mountain,
  COUNT(*) AS active_ota_count,
  ROUND(AVG(ota_score), 1) AS overall_score,
  CASE
    WHEN AVG(ota_score) >= 80 THEN 'PREMIUM'::public.ota_readiness_band
    WHEN AVG(ota_score) >= 50 THEN 'MODERATE'::public.ota_readiness_band
    ELSE                           'CRITICAL'::public.ota_readiness_band
  END AS overall_band,
  MIN(oldest_review_at) AS oldest_review_at,
  SUM(missing_count + unknown_count) AS total_gap_count,
  SUM(stale_count) AS total_stale_count
FROM public.v_hotel_ota_readiness
GROUP BY hotel_id, hotel_slug, hotel_name, wizard_completed_at, effective_mountain;
COMMENT ON VIEW public.v_hotel_ota_readiness_summary IS
  'Hotel-overall OTA readiness summary. Overall score = average of per-OTA scores across active OTAs. Drives dashboard card hero number + band badge.';

-- ─── Helper: Visibility Score bridge ────────────────────────────────────────
-- Called by _compute_visibility_score (in the next migration). Returns
-- true when the hotel's overall OTA readiness is MODERATE or PREMIUM AND
-- the oldest review is within the 120d expiry window.

CREATE OR REPLACE FUNCTION public._ota_signal_for_visibility(p_hotel_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  -- SECURITY DEFINER because _compute_visibility_score is called with
  -- the caller's RLS context; we need to reach the view independent of
  -- that. The function itself only reads the summary for the given hotel,
  -- no cross-tenant exposure.
  SELECT EXISTS (
    SELECT 1
    FROM (
      WITH member_hotels AS (
        SELECT h.id AS hotel_id, h.state
        FROM public.hotels h
        WHERE h.id = p_hotel_id  -- explicit single-hotel filter; bypasses view's vaiyu_is_hotel_member
      ),
      hotel_settings AS (
        SELECT mh.hotel_id, mh.state,
               COALESCE(s.active_otas, ARRAY[
                 'MMT','GOIBIBO','BOOKING_COM','AGODA','AIRBNB','EXPEDIA','YATRA','TRIPADVISOR'
               ]::public.ota_platform[]) AS active_otas,
               COALESCE(s.show_mountain_checks_override, mh.state = ANY(public._ota_mountain_states())) AS eff_mtn
        FROM member_hotels mh
        LEFT JOIN public.hotel_ota_optimizer_settings s ON s.hotel_id = mh.hotel_id
      ),
      active_grid AS (
        SELECT hs.hotel_id, unnest(hs.active_otas) AS ota, hs.eff_mtn,
               c.category, c.item_key, c.weight, c.is_mountain_only, c.not_applicable_otas
        FROM hotel_settings hs CROSS JOIN public._ota_catalog() c
      ),
      applicable AS (
        SELECT * FROM active_grid ag
        WHERE (NOT ag.is_mountain_only OR ag.eff_mtn = true)
          AND NOT (ag.ota = ANY(ag.not_applicable_otas))
      ),
      scored AS (
        SELECT a.hotel_id, a.ota, a.weight,
          CASE
            WHEN s.id IS NULL THEN 'UNKNOWN'::public.ota_readiness_status
            WHEN s.status = 'NOT_APPLICABLE' THEN 'NOT_APPLICABLE'::public.ota_readiness_status
            WHEN s.reviewed_at < now() - INTERVAL '120 days' THEN 'UNKNOWN'::public.ota_readiness_status
            ELSE s.status
          END AS eff_status,
          s.reviewed_at
        FROM applicable a
        LEFT JOIN public.hotel_ota_readiness_state s
          ON s.hotel_id = a.hotel_id AND s.ota = a.ota
         AND s.category = a.category AND s.item_key = a.item_key
      ),
      per_ota AS (
        SELECT hotel_id, ota,
          SUM(CASE eff_status WHEN 'COMPLETE' THEN weight WHEN 'PARTIAL' THEN weight * 0.5
                              WHEN 'NOT_APPLICABLE' THEN NULL ELSE 0 END) AS earned,
          SUM(CASE eff_status WHEN 'NOT_APPLICABLE' THEN NULL ELSE weight END) AS possible
        FROM scored GROUP BY hotel_id, ota
      ),
      hotel_overall AS (
        SELECT hotel_id, AVG(100.0 * earned / NULLIF(possible, 0)) AS score
        FROM per_ota GROUP BY hotel_id
      )
      SELECT hotel_id FROM hotel_overall WHERE score >= 50
    ) eligible
    WHERE eligible.hotel_id = p_hotel_id
  );
$$;
COMMENT ON FUNCTION public._ota_signal_for_visibility(uuid) IS
  'Bridge for Visibility Score signal ota_listing_ready. Returns true when the hotel''s OTA Readiness Score is ≥ 50 (Moderate or Premium band) considering 120d staleness. SECURITY DEFINER because called from _compute_visibility_score with caller''s RLS context — does not cross-tenant leak (filter is by p_hotel_id only).';

-- ─── RPC: set_ota_active_otas (any member) ──────────────────────────────────
-- Owner toggles which OTAs they actively list on. Upserts the settings row
-- if it doesn't exist. Empty array rejected by table-level CHECK.

CREATE OR REPLACE FUNCTION public.set_ota_active_otas(
  p_hotel_id uuid,
  p_otas     public.ota_platform[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_old_otas public.ota_platform[];
BEGIN
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  IF p_otas IS NULL OR array_length(p_otas, 1) IS NULL OR array_length(p_otas, 1) < 1 THEN
    RAISE EXCEPTION 'OTAS_REQUIRED';
  END IF;

  SELECT active_otas INTO v_old_otas
    FROM public.hotel_ota_optimizer_settings
   WHERE hotel_id = p_hotel_id
   FOR UPDATE;

  INSERT INTO public.hotel_ota_optimizer_settings(hotel_id, active_otas)
  VALUES (p_hotel_id, p_otas)
  ON CONFLICT (hotel_id) DO UPDATE SET active_otas = EXCLUDED.active_otas;

  INSERT INTO public.va_audit_logs(action, actor, hotel_id, entity, meta)
  VALUES (
    'ota_active_otas_set',
    COALESCE(auth.uid()::text, 'system'),
    p_hotel_id,
    'ota_optimizer_settings',
    jsonb_build_object(
      'previous', COALESCE(to_jsonb(v_old_otas), 'null'::jsonb),
      'new',      to_jsonb(p_otas)
    )
  );

  RETURN jsonb_build_object('active_otas', to_jsonb(p_otas));
END;
$$;
COMMENT ON FUNCTION public.set_ota_active_otas(uuid, public.ota_platform[]) IS
  'Owner-callable. Sets which OTAs the hotel actively lists on. Upserts settings row. Empty array rejected. Audits to va_audit_logs.';

-- ─── RPC: set_ota_mountain_override (any member) ────────────────────────────
-- Owner overrides the state-derived mountain-checks default. Pass null to
-- clear the override and return to auto-derive from hotels.state.

CREATE OR REPLACE FUNCTION public.set_ota_mountain_override(
  p_hotel_id uuid,
  p_override boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_old boolean;
  v_effective boolean;
BEGIN
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  SELECT show_mountain_checks_override INTO v_old
    FROM public.hotel_ota_optimizer_settings
   WHERE hotel_id = p_hotel_id
   FOR UPDATE;

  INSERT INTO public.hotel_ota_optimizer_settings(hotel_id, show_mountain_checks_override)
  VALUES (p_hotel_id, p_override)
  ON CONFLICT (hotel_id) DO UPDATE SET show_mountain_checks_override = EXCLUDED.show_mountain_checks_override;

  v_effective := public._ota_effective_mountain(p_hotel_id);

  INSERT INTO public.va_audit_logs(action, actor, hotel_id, entity, meta)
  VALUES (
    'ota_mountain_override_set',
    COALESCE(auth.uid()::text, 'system'),
    p_hotel_id,
    'ota_optimizer_settings',
    jsonb_build_object(
      'previous_override', v_old,
      'new_override',      p_override,
      'effective_mountain', v_effective
    )
  );

  RETURN jsonb_build_object(
    'override', p_override,
    'effective_mountain', v_effective
  );
END;
$$;
COMMENT ON FUNCTION public.set_ota_mountain_override(uuid, boolean) IS
  'Owner-callable. Overrides the state-derived mountain-checks default. Pass true/false to set explicit; pass null (via parameter elision) to clear override. Audits to va_audit_logs.';

-- ─── RPC: set_ota_readiness_status (any member) ─────────────────────────────
-- Single-item status mutation. Validates (category, item_key) against
-- _ota_catalog() and validates OTA applicability before insert.

CREATE OR REPLACE FUNCTION public.set_ota_readiness_status(
  p_hotel_id uuid,
  p_ota      public.ota_platform,
  p_category public.ota_readiness_category,
  p_item_key text,
  p_status   public.ota_readiness_status,
  p_note     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_existing  public.hotel_ota_readiness_state;
  v_catalog   record;
  v_id        uuid;
  v_old_status public.ota_readiness_status;
BEGIN
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  -- Validate item exists in catalog
  IF NOT public._ota_catalog_has_item(p_category, p_item_key) THEN
    RAISE EXCEPTION 'ITEM_KEY_NOT_IN_CATALOG';
  END IF;

  -- Fetch catalog row for applicability checks
  SELECT * INTO v_catalog
    FROM public._ota_catalog() c
   WHERE c.category = p_category AND c.item_key = p_item_key;

  -- Reject NA-OTA writes (e.g., room_naming on AIRBNB)
  IF p_ota = ANY(v_catalog.not_applicable_otas) THEN
    RAISE EXCEPTION 'OTA_NOT_APPLICABLE_FOR_ITEM';
  END IF;

  -- Reject mountain-only writes for non-mountain hotels
  IF v_catalog.is_mountain_only AND NOT COALESCE(public._ota_effective_mountain(p_hotel_id), false) THEN
    RAISE EXCEPTION 'MOUNTAIN_ITEM_NOT_APPLICABLE';
  END IF;

  -- Validate note length (defensive — also enforced by CHECK constraint)
  IF p_note IS NOT NULL AND length(p_note) > 2000 THEN
    RAISE EXCEPTION 'NOTE_TOO_LONG';
  END IF;

  SELECT * INTO v_existing
    FROM public.hotel_ota_readiness_state
   WHERE hotel_id = p_hotel_id AND ota = p_ota
     AND category = p_category AND item_key = p_item_key
   FOR UPDATE;

  v_old_status := v_existing.status;

  INSERT INTO public.hotel_ota_readiness_state(
    hotel_id, ota, category, item_key, status, reviewed_at, reviewed_by, note
  ) VALUES (
    p_hotel_id, p_ota, p_category, p_item_key, p_status, now(), auth.uid(), p_note
  )
  ON CONFLICT (hotel_id, ota, category, item_key) DO UPDATE SET
    status      = EXCLUDED.status,
    reviewed_at = now(),
    reviewed_by = auth.uid(),
    note        = EXCLUDED.note
  RETURNING id INTO v_id;

  INSERT INTO public.va_audit_logs(action, actor, hotel_id, entity, entity_id, meta)
  VALUES (
    'ota_status_set',
    COALESCE(auth.uid()::text, 'system'),
    p_hotel_id,
    'ota_readiness_state',
    v_id,
    jsonb_build_object(
      'ota', p_ota,
      'category', p_category,
      'item_key', p_item_key,
      'old_status', v_old_status,
      'new_status', p_status,
      'note_present', p_note IS NOT NULL AND length(p_note) > 0
    )
  );

  RETURN jsonb_build_object(
    'state_id', v_id,
    'status', p_status::text,
    'reviewed_at', now()
  );
END;
$$;
COMMENT ON FUNCTION public.set_ota_readiness_status(uuid, public.ota_platform, public.ota_readiness_category, text, public.ota_readiness_status, text) IS
  'Owner-callable. Sets the readiness status for one (OTA, category, item_key) cell. Validates catalog membership, OTA applicability, mountain-only gating. Stamps reviewed_at = now(). Audits to va_audit_logs.';

-- ─── RPC: bulk_set_ota_readiness (any member; wizard path) ──────────────────
-- Accepts a jsonb array of {ota, category, item_key, status, note}. Used by
-- the cold-start wizard for fewer round-trips. Validates every row before
-- any insert (transactional).

CREATE OR REPLACE FUNCTION public.bulk_set_ota_readiness(
  p_hotel_id uuid,
  p_items    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_item      jsonb;
  v_ota       public.ota_platform;
  v_category  public.ota_readiness_category;
  v_item_key  text;
  v_status    public.ota_readiness_status;
  v_note      text;
  v_mountain  boolean;
  v_count     int := 0;
  v_inserted  int := 0;
  v_updated   int := 0;
  v_existing  public.hotel_ota_readiness_state;
  v_catalog   record;
BEGIN
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'ITEMS_MUST_BE_ARRAY';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'ITEMS_EMPTY';
  END IF;

  IF jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'ITEMS_TOO_MANY';
  END IF;

  v_mountain := COALESCE(public._ota_effective_mountain(p_hotel_id), false);

  -- Validate every row first (transactional safety)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_ota      := (v_item->>'ota')::public.ota_platform;
      v_category := (v_item->>'category')::public.ota_readiness_category;
      v_item_key := v_item->>'item_key';
      v_status   := (v_item->>'status')::public.ota_readiness_status;
      v_note     := v_item->>'note';
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'ITEM_PARSE_ERROR';
    END;

    IF v_item_key IS NULL OR length(v_item_key) = 0 OR length(v_item_key) > 64 THEN
      RAISE EXCEPTION 'INVALID_ITEM_KEY';
    END IF;

    IF v_note IS NOT NULL AND length(v_note) > 2000 THEN
      RAISE EXCEPTION 'NOTE_TOO_LONG';
    END IF;

    SELECT * INTO v_catalog
      FROM public._ota_catalog() c
     WHERE c.category = v_category AND c.item_key = v_item_key;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_KEY_NOT_IN_CATALOG';
    END IF;

    IF v_ota = ANY(v_catalog.not_applicable_otas) THEN
      RAISE EXCEPTION 'OTA_NOT_APPLICABLE_FOR_ITEM';
    END IF;

    IF v_catalog.is_mountain_only AND NOT v_mountain THEN
      RAISE EXCEPTION 'MOUNTAIN_ITEM_NOT_APPLICABLE';
    END IF;

    v_count := v_count + 1;
  END LOOP;

  -- All validated — now upsert
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_ota      := (v_item->>'ota')::public.ota_platform;
    v_category := (v_item->>'category')::public.ota_readiness_category;
    v_item_key := v_item->>'item_key';
    v_status   := (v_item->>'status')::public.ota_readiness_status;
    v_note     := v_item->>'note';

    SELECT * INTO v_existing
      FROM public.hotel_ota_readiness_state
     WHERE hotel_id = p_hotel_id AND ota = v_ota
       AND category = v_category AND item_key = v_item_key;

    IF v_existing.id IS NULL THEN
      v_inserted := v_inserted + 1;
    ELSE
      v_updated := v_updated + 1;
    END IF;

    INSERT INTO public.hotel_ota_readiness_state(
      hotel_id, ota, category, item_key, status, reviewed_at, reviewed_by, note
    ) VALUES (
      p_hotel_id, v_ota, v_category, v_item_key, v_status, now(), auth.uid(), v_note
    )
    ON CONFLICT (hotel_id, ota, category, item_key) DO UPDATE SET
      status      = EXCLUDED.status,
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      note        = EXCLUDED.note;
  END LOOP;

  INSERT INTO public.va_audit_logs(action, actor, hotel_id, entity, meta)
  VALUES (
    'ota_bulk_set',
    COALESCE(auth.uid()::text, 'system'),
    p_hotel_id,
    'ota_readiness_state',
    jsonb_build_object(
      'count',    v_count,
      'inserted', v_inserted,
      'updated',  v_updated
    )
  );

  RETURN jsonb_build_object(
    'count',    v_count,
    'inserted', v_inserted,
    'updated',  v_updated
  );
END;
$$;
COMMENT ON FUNCTION public.bulk_set_ota_readiness(uuid, jsonb) IS
  'Wizard-friendly bulk upsert. Validates every item first then upserts. Max 200 items per call. Audits to va_audit_logs with summary counts (per-item events would flood the log; the per-row state is the audit surface).';

-- ─── RPC: mark_ota_review_complete (any member) ─────────────────────────────
-- "I reviewed all items for this OTA, status is still correct" — bumps
-- reviewed_at on every existing state row for the OTA without changing
-- statuses. Resets staleness without re-clicking each cell.

CREATE OR REPLACE FUNCTION public.mark_ota_review_complete(
  p_hotel_id uuid,
  p_ota      public.ota_platform
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  UPDATE public.hotel_ota_readiness_state
     SET reviewed_at = now(),
         reviewed_by = auth.uid()
   WHERE hotel_id = p_hotel_id AND ota = p_ota;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'NO_STATES_FOR_OTA';
  END IF;

  INSERT INTO public.va_audit_logs(action, actor, hotel_id, entity, meta)
  VALUES (
    'ota_review_completed',
    COALESCE(auth.uid()::text, 'system'),
    p_hotel_id,
    'ota_readiness_state',
    jsonb_build_object('ota', p_ota, 'items_refreshed', v_count)
  );

  RETURN jsonb_build_object('ota', p_ota, 'items_refreshed', v_count);
END;
$$;
COMMENT ON FUNCTION public.mark_ota_review_complete(uuid, public.ota_platform) IS
  'Refreshes reviewed_at for all existing state rows of one OTA without changing statuses. Use case: "I just looked at MMT and everything is still as marked." Resets 90d/120d staleness clocks.';

-- ─── RPC: complete_ota_wizard (any member) ──────────────────────────────────
-- Stamps wizard_completed_at on settings. Idempotent (doesn't re-stamp if
-- already set; returns existing timestamp).

CREATE OR REPLACE FUNCTION public.complete_ota_wizard(
  p_hotel_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_existing timestamptz;
BEGIN
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  SELECT wizard_completed_at INTO v_existing
    FROM public.hotel_ota_optimizer_settings
   WHERE hotel_id = p_hotel_id
   FOR UPDATE;

  IF v_existing IS NOT NULL THEN
    -- Idempotent — return existing timestamp
    RETURN jsonb_build_object('wizard_completed_at', v_existing, 'changed', false);
  END IF;

  INSERT INTO public.hotel_ota_optimizer_settings(hotel_id, wizard_completed_at)
  VALUES (p_hotel_id, now())
  ON CONFLICT (hotel_id) DO UPDATE SET
    wizard_completed_at = COALESCE(public.hotel_ota_optimizer_settings.wizard_completed_at, now())
  RETURNING wizard_completed_at INTO v_existing;

  INSERT INTO public.va_audit_logs(action, actor, hotel_id, entity, meta)
  VALUES (
    'ota_wizard_completed',
    COALESCE(auth.uid()::text, 'system'),
    p_hotel_id,
    'ota_optimizer_settings',
    jsonb_build_object('wizard_completed_at', v_existing)
  );

  RETURN jsonb_build_object('wizard_completed_at', v_existing, 'changed', true);
END;
$$;
COMMENT ON FUNCTION public.complete_ota_wizard(uuid) IS
  'Stamps wizard_completed_at on the settings row. Idempotent — re-runs return the existing timestamp without re-stamping.';

-- ─── RPC: reset_ota_readiness (any member) ──────────────────────────────────
-- Owner can reset all state for one OTA (or hotel-wide) to "fresh slate"
-- when they have done a major listing overhaul. Audit-trail preserved via
-- va_audit_logs.

CREATE OR REPLACE FUNCTION public.reset_ota_readiness(
  p_hotel_id uuid,
  p_ota      public.ota_platform DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  IF p_ota IS NULL THEN
    DELETE FROM public.hotel_ota_readiness_state
     WHERE hotel_id = p_hotel_id;
  ELSE
    DELETE FROM public.hotel_ota_readiness_state
     WHERE hotel_id = p_hotel_id AND ota = p_ota;
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.va_audit_logs(action, actor, hotel_id, entity, meta)
  VALUES (
    'ota_reset',
    COALESCE(auth.uid()::text, 'system'),
    p_hotel_id,
    'ota_readiness_state',
    jsonb_build_object(
      'ota', p_ota,                              -- null = all OTAs
      'items_deleted', v_count
    )
  );

  RETURN jsonb_build_object('items_deleted', v_count, 'ota', p_ota);
END;
$$;
COMMENT ON FUNCTION public.reset_ota_readiness(uuid, public.ota_platform) IS
  'Owner-callable. Deletes state rows for one OTA (when p_ota is set) or all OTAs (when null). Use case: major listing overhaul where prior status is no longer accurate. Audit-trail preserved via va_audit_logs.';

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.hotel_ota_optimizer_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_ota_readiness_state    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ota_settings_select_members ON public.hotel_ota_optimizer_settings;
CREATE POLICY ota_settings_select_members
  ON public.hotel_ota_optimizer_settings
  FOR SELECT
  TO authenticated
  USING (public.vaiyu_is_hotel_member(hotel_id));

DROP POLICY IF EXISTS ota_state_select_members ON public.hotel_ota_readiness_state;
CREATE POLICY ota_state_select_members
  ON public.hotel_ota_readiness_state
  FOR SELECT
  TO authenticated
  USING (public.vaiyu_is_hotel_member(hotel_id));

-- All writes via SECURITY DEFINER RPCs; revoke direct mutations
REVOKE INSERT, UPDATE, DELETE ON public.hotel_ota_optimizer_settings FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.hotel_ota_readiness_state    FROM authenticated;

-- ─── Grants for RPCs ────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public._ota_catalog()                                    TO authenticated;
GRANT EXECUTE ON FUNCTION public._ota_mountain_states()                            TO authenticated;
GRANT EXECUTE ON FUNCTION public._ota_catalog_has_item(public.ota_readiness_category, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public._ota_effective_mountain(uuid)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public._ota_signal_for_visibility(uuid)                  TO authenticated;

GRANT EXECUTE ON FUNCTION public.set_ota_active_otas(uuid, public.ota_platform[])  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_ota_mountain_override(uuid, boolean)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_ota_readiness_status(uuid, public.ota_platform, public.ota_readiness_category, text, public.ota_readiness_status, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_set_ota_readiness(uuid, jsonb)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_ota_review_complete(uuid, public.ota_platform) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_ota_wizard(uuid)                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_ota_readiness(uuid, public.ota_platform)    TO authenticated;

-- Views inherit SELECT permission from underlying table policies.

GRANT SELECT ON public.v_hotel_ota_readiness         TO authenticated;
GRANT SELECT ON public.v_hotel_ota_readiness_summary TO authenticated;

-- ─── End of OTA Listing Optimizer v0 migration ──────────────────────────────
