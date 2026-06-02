-- Seasonal Demand Calendar v0 — Growth Hub Position 8
--
-- INTERNAL planning + readiness workspace for hospitality operators.
--   • NOT a forecasting engine
--   • NOT a revenue / occupancy / booking prediction system
--   • NOT a publish path; NOT a campaign automation queue
--   • NOT an AI/ML feature
--
-- Architecture mirrors Position 6 (DAM) + Position 7 (Local SEO Planner):
--   • Three-layer schema: catalog (system) + per-hotel state + append-only events
--   • Deterministic urgency math (IMMUTABLE SQL); TS mirror exists for instant UX
--   • SECURITY DEFINER RPCs only; direct INSERT/UPDATE/DELETE revoked
--   • RLS via vaiyu_is_hotel_member; manager gates via vaiyu_is_hotel_finance_manager
--   • Audit via per-entity events table (first-class governance UI surface)
--
-- Tables:
--   • seasonal_calendar_windows         — system catalog (~16 seeded rows)
--   • hotel_seasonal_window_states      — per-hotel, per-year state
--   • hotel_seasonal_window_events      — append-only audit timeline
--
-- View:
--   • v_visible_seasonal_windows        — hotels × catalog (region-filtered) with
--                                         computed urgency + checklist progress
--
-- Region filter design (the reviewer caught us not inspecting hotels first):
--   • hotels.state ALREADY exists (baseline migration, line 13902, nullable text)
--   • We do NOT modify hotels here. Catalog owns region_state_codes text[];
--     _seasonal_normalize_state() normalizes hotels.state free-text (e.g.
--     "Uttarakhand" / "UK" / "uttarakhand") to lowercase 2-letter codes.
--   • Fail-open: hotels with NULL/empty state see all windows
--     (is_regional_match = true in view) so we never wrongly suppress.
--
-- Date math:
--   • Windows are (start_month, start_day, end_month, end_day) ranges
--   • CHECK constraints prevent invalid dates (Feb 29-31, Apr 31, etc.)
--   • _seasonal_window_next_occurrence(...) returns a tstzrange for the active
--     OR next-future cycle, handling cross-year windows (Dec→Feb correctly)
--   • is_approximate flag drives UI copy: "Around late April" vs "Apr 25"
--     so we never have to ship date-correction migrations as panchang shifts
--
-- Per CLAUDE.md:
--   • No new audit infra — using per-entity events table consistent with
--     seo_landing_blueprint_events / package_events (first-class UI surface)
--   • No custom-fields-per-hotel: prep_checklist_seed comes from catalog only
--   • Helpers reused: vaiyu_is_hotel_member, vaiyu_is_hotel_finance_manager,
--                     set_updated_at, _user_display_name

-- ─── Enums ──────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.seasonal_category AS ENUM (
    'RELIGIOUS_YATRA',
    'METRO_ESCAPE',
    'CLIMATE_PEAK',
    'OFF_PEAK_VALUE',
    'WINTER_SNOW',
    'LONG_WEEKEND',
    'WELLNESS_WORKATION',
    'FAMILY_EVENT'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.seasonal_priority AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.seasonal_review_status AS ENUM ('PLANNING', 'READY', 'DISMISSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Urgency intentionally has 4 bands. DORMANT isn't an urgency, it's a
-- review_status (DISMISSED) handled separately.
DO $$ BEGIN
  CREATE TYPE public.seasonal_window_urgency AS ENUM ('NOW', 'PREPARE', 'WATCH', 'QUIET');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.seasonal_window_event_type AS ENUM (
    'CHECKLIST_TICKED',
    'CHECKLIST_UNTICKED',
    'NOTES_UPDATED',
    'URGENCY_OVERRIDDEN',
    'URGENCY_OVERRIDE_CLEARED',
    'DISMISSED_FOR_YEAR',
    'RESUMED_FROM_DISMISSAL',
    'MARKED_READY',
    'RETURNED_TO_PLANNING',
    'PERMANENTLY_HIDDEN',
    'PERMANENTLY_HIDDEN_CLEARED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Helper: normalize hotels.state free-text to lowercase 2-letter code ────
-- Pure function; safe to call in view & CHECK contexts. Add new mappings here
-- when fresh region codes are needed — never modify hotels schema for this.

CREATE OR REPLACE FUNCTION public._seasonal_normalize_state(p_state text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(btrim(coalesce(p_state, '')))
    WHEN ''                    THEN NULL
    WHEN 'uttarakhand'         THEN 'uk'
    WHEN 'uttaranchal'         THEN 'uk'
    WHEN 'uk'                  THEN 'uk'
    WHEN 'ua'                  THEN 'uk'
    WHEN 'himachal pradesh'    THEN 'hp'
    WHEN 'himachal'            THEN 'hp'
    WHEN 'hp'                  THEN 'hp'
    WHEN 'jammu and kashmir'   THEN 'jk'
    WHEN 'jammu & kashmir'     THEN 'jk'
    WHEN 'j&k'                 THEN 'jk'
    WHEN 'jk'                  THEN 'jk'
    WHEN 'ladakh'              THEN 'la'
    WHEN 'la'                  THEN 'la'
    WHEN 'delhi'               THEN 'dl'
    WHEN 'new delhi'           THEN 'dl'
    WHEN 'nct delhi'           THEN 'dl'
    WHEN 'dl'                  THEN 'dl'
    WHEN 'haryana'             THEN 'hr'
    WHEN 'hr'                  THEN 'hr'
    WHEN 'uttar pradesh'       THEN 'up'
    WHEN 'up'                  THEN 'up'
    WHEN 'punjab'              THEN 'pb'
    WHEN 'pb'                  THEN 'pb'
    WHEN 'rajasthan'           THEN 'rj'
    WHEN 'rj'                  THEN 'rj'
    WHEN 'goa'                 THEN 'goa'
    WHEN 'maharashtra'         THEN 'mh'
    WHEN 'mh'                  THEN 'mh'
    WHEN 'sikkim'              THEN 'sk'
    WHEN 'sk'                  THEN 'sk'
    WHEN 'west bengal'         THEN 'wb'
    WHEN 'wb'                  THEN 'wb'
    WHEN 'karnataka'           THEN 'ka'
    WHEN 'ka'                  THEN 'ka'
    WHEN 'kerala'              THEN 'kl'
    WHEN 'kl'                  THEN 'kl'
    WHEN 'tamil nadu'          THEN 'tn'
    WHEN 'tn'                  THEN 'tn'
    ELSE NULL  -- unknown → treat as no match; view fail-opens on NULL hotel state
  END;
$$;

COMMENT ON FUNCTION public._seasonal_normalize_state(text) IS
  'Normalizes hotels.state free-text to a lowercase 2-letter region code. Returns NULL for unknown strings (view treats as no match unless the hotel state itself was NULL/empty — which fail-opens).';

-- ─── Helper: next occurrence (handles cross-year windows like Dec→Feb) ──────
-- Returns the tstzrange of either the currently active cycle or the next
-- future cycle. IST-anchored (all VAiyu hotels are IST).
-- Pure function of inputs; IMMUTABLE so it can live in CHECKs and views.

CREATE OR REPLACE FUNCTION public._seasonal_window_next_occurrence(
  p_start_month int,
  p_start_day   int,
  p_end_month   int,
  p_end_day     int,
  p_at          timestamptz
)
RETURNS tstzrange
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_at_ist      timestamp;
  v_ref_year    int;
  v_curr_start  timestamp;
  v_curr_end    timestamp;
  v_crosses     boolean;
BEGIN
  v_at_ist   := (p_at AT TIME ZONE 'Asia/Kolkata');
  v_ref_year := extract(year FROM v_at_ist)::int;

  -- Window crosses a year boundary when end (mo, dd) < start (mo, dd)
  v_crosses := (p_end_month < p_start_month)
               OR (p_end_month = p_start_month AND p_end_day < p_start_day);

  -- Candidate current cycle anchored to v_ref_year
  v_curr_start := make_timestamp(v_ref_year, p_start_month, p_start_day, 0, 0, 0);
  IF v_crosses THEN
    v_curr_end := make_timestamp(v_ref_year + 1, p_end_month, p_end_day, 23, 59, 59);
  ELSE
    v_curr_end := make_timestamp(v_ref_year, p_end_month, p_end_day, 23, 59, 59);
  END IF;

  -- If the cycle ended already, we may also need to check the previous
  -- year's cross-year cycle (e.g. on Jan 5 with a Dec-Feb window the
  -- v_ref_year-anchored cycle is Dec-this-year to Feb-next, but we're
  -- actually inside Dec-prev-year to Feb-this-year).
  IF v_crosses THEN
    DECLARE
      v_prev_start timestamp := make_timestamp(v_ref_year - 1, p_start_month, p_start_day, 0, 0, 0);
      v_prev_end   timestamp := make_timestamp(v_ref_year,     p_end_month,   p_end_day,   23, 59, 59);
    BEGIN
      IF v_at_ist BETWEEN v_prev_start AND v_prev_end THEN
        RETURN tstzrange(
          (v_prev_start AT TIME ZONE 'Asia/Kolkata'),
          (v_prev_end   AT TIME ZONE 'Asia/Kolkata'),
          '[]'
        );
      END IF;
    END;
  END IF;

  -- Currently active in v_ref_year-anchored cycle
  IF v_at_ist BETWEEN v_curr_start AND v_curr_end THEN
    RETURN tstzrange(
      (v_curr_start AT TIME ZONE 'Asia/Kolkata'),
      (v_curr_end   AT TIME ZONE 'Asia/Kolkata'),
      '[]'
    );
  END IF;

  -- Cycle is still future this year
  IF v_at_ist < v_curr_start THEN
    RETURN tstzrange(
      (v_curr_start AT TIME ZONE 'Asia/Kolkata'),
      (v_curr_end   AT TIME ZONE 'Asia/Kolkata'),
      '[]'
    );
  END IF;

  -- Past current cycle → next year's cycle
  v_curr_start := make_timestamp(v_ref_year + 1, p_start_month, p_start_day, 0, 0, 0);
  IF v_crosses THEN
    v_curr_end := make_timestamp(v_ref_year + 2, p_end_month, p_end_day, 23, 59, 59);
  ELSE
    v_curr_end := make_timestamp(v_ref_year + 1, p_end_month, p_end_day, 23, 59, 59);
  END IF;

  RETURN tstzrange(
    (v_curr_start AT TIME ZONE 'Asia/Kolkata'),
    (v_curr_end   AT TIME ZONE 'Asia/Kolkata'),
    '[]'
  );
END;
$$;

COMMENT ON FUNCTION public._seasonal_window_next_occurrence IS
  'Returns the active OR next future cycle for a recurring (mo, dd) window. Handles cross-year windows. IST-anchored. IMMUTABLE — safe in views.';

-- ─── Helper: urgency from (start, end, now) ─────────────────────────────────
-- Deterministic. The TS mirror in web/src/config/seasonalCalendar.ts MUST
-- match this exactly; a parity test in the test suite asserts it.

CREATE OR REPLACE FUNCTION public._seasonal_window_urgency(
  p_start_ts timestamptz,
  p_end_ts   timestamptz,
  p_at       timestamptz
)
RETURNS public.seasonal_window_urgency
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_days_until int;
BEGIN
  IF p_at BETWEEN p_start_ts AND p_end_ts THEN
    RETURN 'NOW';
  END IF;
  v_days_until := (EXTRACT(EPOCH FROM (p_start_ts - p_at)) / 86400)::int;
  IF v_days_until <= 7  THEN RETURN 'NOW';
  ELSIF v_days_until <= 30 THEN RETURN 'PREPARE';
  ELSIF v_days_until <= 60 THEN RETURN 'WATCH';
  ELSE                          RETURN 'QUIET';
  END IF;
END;
$$;

COMMENT ON FUNCTION public._seasonal_window_urgency IS
  'Deterministic urgency from window start/end + reference time. The frontend TS mirror must match exactly (parity-tested).';

-- ─── Catalog: seasonal_calendar_windows ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.seasonal_calendar_windows (
  code                       text PRIMARY KEY
                               CHECK (code = upper(code) AND length(code) BETWEEN 3 AND 64),
  category                   public.seasonal_category NOT NULL,

  display_name_en            text NOT NULL CHECK (length(btrim(display_name_en)) > 0 AND length(display_name_en) <= 120),
  display_name_hi            text NOT NULL CHECK (length(btrim(display_name_hi)) > 0 AND length(display_name_hi) <= 120),

  why_it_matters_en          text NOT NULL CHECK (length(why_it_matters_en) <= 600),
  why_it_matters_hi          text NOT NULL CHECK (length(why_it_matters_hi) <= 600),

  recommended_action_en      text NOT NULL CHECK (length(recommended_action_en) <= 400),
  recommended_action_hi      text NOT NULL CHECK (length(recommended_action_hi) <= 400),

  target_guest_segment_en    text CHECK (target_guest_segment_en IS NULL OR length(target_guest_segment_en) <= 240),
  target_guest_segment_hi    text CHECK (target_guest_segment_hi IS NULL OR length(target_guest_segment_hi) <= 240),

  suggested_package_idea_en  text CHECK (suggested_package_idea_en IS NULL OR length(suggested_package_idea_en) <= 400),
  suggested_package_idea_hi  text CHECK (suggested_package_idea_hi IS NULL OR length(suggested_package_idea_hi) <= 400),

  -- Window dates (recurring annually). Capped at safe day-of-month so make_date
  -- never explodes. Feb capped at 28 to dodge leap-year ambiguity.
  start_month                int NOT NULL CHECK (start_month BETWEEN 1 AND 12),
  start_day                  int NOT NULL CHECK (start_day   BETWEEN 1 AND 31),
  end_month                  int NOT NULL CHECK (end_month   BETWEEN 1 AND 12),
  end_day                    int NOT NULL CHECK (end_day     BETWEEN 1 AND 31),
  CONSTRAINT seasonal_windows_valid_start_day CHECK (
    (start_month != 2 OR start_day <= 28)
    AND (start_month NOT IN (4, 6, 9, 11) OR start_day <= 30)
  ),
  CONSTRAINT seasonal_windows_valid_end_day CHECK (
    (end_month != 2 OR end_day <= 28)
    AND (end_month NOT IN (4, 6, 9, 11) OR end_day <= 30)
  ),

  -- Region targeting. Empty array = PAN_INDIA. Codes come from
  -- _seasonal_normalize_state output.
  region_state_codes         text[] NOT NULL DEFAULT '{}'::text[]
                               CHECK (array_position(region_state_codes, NULL) IS NULL),

  priority                   public.seasonal_priority NOT NULL DEFAULT 'MEDIUM',

  -- Prep checklist items live in the catalog so we never need to migrate
  -- per-hotel state when we add/edit items. Per-hotel state stores only
  -- ticked_keys text[].
  -- Shape: [{ key, label_en, label_hi, days_before, link_target? }]
  prep_checklist_seed        jsonb NOT NULL DEFAULT '[]'::jsonb
                               CHECK (jsonb_typeof(prep_checklist_seed) = 'array'),

  connected_module_suggestion text
                               CHECK (connected_module_suggestion IS NULL
                                      OR connected_module_suggestion IN (
                                        'PACKAGE_BUILDER', 'DRIP', 'DAM', 'SEO_PLANNER'
                                      )),

  is_approximate             boolean NOT NULL DEFAULT true,
  date_disclaimer_en         text CHECK (date_disclaimer_en IS NULL OR length(date_disclaimer_en) <= 400),
  date_disclaimer_hi         text CHECK (date_disclaimer_hi IS NULL OR length(date_disclaimer_hi) <= 400),
  -- Approximate windows MUST ship with both EN + Hi date disclaimers so the UI
  -- can surface the "verify exact date" hint. Defense against catalog drift.
  CONSTRAINT seasonal_windows_approx_requires_disclaimer CHECK (
    is_approximate = false
    OR (date_disclaimer_en IS NOT NULL AND length(btrim(date_disclaimer_en)) > 0
        AND date_disclaimer_hi IS NOT NULL AND length(btrim(date_disclaimer_hi)) > 0)
  ),

  display_order              int NOT NULL DEFAULT 100,
  is_active                  boolean NOT NULL DEFAULT true,

  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seasonal_windows_active_order
  ON public.seasonal_calendar_windows (is_active, display_order);

CREATE INDEX IF NOT EXISTS idx_seasonal_windows_category
  ON public.seasonal_calendar_windows (category, display_order)
  WHERE is_active = true;

-- ─── Per-hotel state: hotel_seasonal_window_states ──────────────────────────

CREATE TABLE IF NOT EXISTS public.hotel_seasonal_window_states (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id                    uuid NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  window_code                 text NOT NULL REFERENCES public.seasonal_calendar_windows(code) ON DELETE RESTRICT,
  season_year                 int NOT NULL CHECK (season_year BETWEEN 2020 AND 2100),

  review_status               public.seasonal_review_status NOT NULL DEFAULT 'PLANNING',

  -- Only ticked KEYS. Labels render live from catalog so seed updates roll forward.
  ticked_keys                 text[] NOT NULL DEFAULT '{}'::text[],

  owner_notes                 text CHECK (owner_notes IS NULL OR length(owner_notes) <= 4000),
  internal_notes              text CHECK (internal_notes IS NULL OR length(internal_notes) <= 4000),

  -- Optional override of computed urgency. If set, reason required (audit-logged).
  urgency_override            public.seasonal_window_urgency,
  urgency_override_reason     text,
  CONSTRAINT seasonal_state_override_reason_required CHECK (
    urgency_override IS NULL
    OR (urgency_override_reason IS NOT NULL
        AND length(btrim(urgency_override_reason)) > 0
        AND length(urgency_override_reason) <= 2000)
  ),

  -- "Not this year": annual; reason captured.
  dismissed_reason            text,
  CONSTRAINT seasonal_state_dismissed_reason_required CHECK (
    review_status <> 'DISMISSED'
    OR (dismissed_reason IS NOT NULL
        AND length(btrim(dismissed_reason)) > 0
        AND length(dismissed_reason) <= 2000)
  ),

  -- "Never relevant for this hotel": persists across years.
  is_permanently_hidden       boolean NOT NULL DEFAULT false,
  permanently_hidden_reason   text,
  CONSTRAINT seasonal_state_hidden_reason_required CHECK (
    is_permanently_hidden = false
    OR (permanently_hidden_reason IS NOT NULL
        AND length(btrim(permanently_hidden_reason)) > 0
        AND length(permanently_hidden_reason) <= 2000)
  ),

  -- Owner sign-off (manager+ via RPC)
  marked_ready_at             timestamptz,
  marked_ready_by             uuid REFERENCES auth.users(id),
  CONSTRAINT seasonal_state_ready_pairing CHECK (
    (review_status = 'READY' AND marked_ready_at IS NOT NULL)
    OR (review_status <> 'READY')
  ),

  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid REFERENCES auth.users(id),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid REFERENCES auth.users(id),

  CONSTRAINT uq_hotel_window_year UNIQUE (hotel_id, window_code, season_year)
);

CREATE INDEX IF NOT EXISTS idx_seasonal_states_hotel_year
  ON public.hotel_seasonal_window_states (hotel_id, season_year);

CREATE INDEX IF NOT EXISTS idx_seasonal_states_hotel_review
  ON public.hotel_seasonal_window_states (hotel_id, review_status)
  WHERE is_permanently_hidden = false;

-- ─── Append-only events: hotel_seasonal_window_events ───────────────────────

CREATE TABLE IF NOT EXISTS public.hotel_seasonal_window_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id              uuid NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  window_code           text NOT NULL,
  season_year           int NOT NULL CHECK (season_year BETWEEN 2020 AND 2100),
  event_type            public.seasonal_window_event_type NOT NULL,
  payload               jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id              uuid REFERENCES auth.users(id),
  actor_name_snapshot   text,
  occurred_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  event_schema_version  integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_seasonal_events_window_time
  ON public.hotel_seasonal_window_events (hotel_id, window_code, season_year, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_seasonal_events_hotel_time
  ON public.hotel_seasonal_window_events (hotel_id, occurred_at DESC);

-- ─── Triggers ───────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_seasonal_states_updated_at ON public.hotel_seasonal_window_states;
CREATE TRIGGER trg_seasonal_states_updated_at
  BEFORE UPDATE ON public.hotel_seasonal_window_states
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_seasonal_windows_updated_at ON public.seasonal_calendar_windows;
CREATE TRIGGER trg_seasonal_windows_updated_at
  BEFORE UPDATE ON public.seasonal_calendar_windows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.seasonal_calendar_windows       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_seasonal_window_states    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_seasonal_window_events    ENABLE ROW LEVEL SECURITY;

-- Catalog is world-readable to any authenticated user (it's reference data,
-- not hotel-scoped). No write policy (mutations only via migration).
DROP POLICY IF EXISTS seasonal_windows_select_for_authenticated ON public.seasonal_calendar_windows;
CREATE POLICY seasonal_windows_select_for_authenticated ON public.seasonal_calendar_windows
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS seasonal_states_select_for_members ON public.hotel_seasonal_window_states;
CREATE POLICY seasonal_states_select_for_members ON public.hotel_seasonal_window_states
  FOR SELECT USING (public.vaiyu_is_hotel_member(hotel_id));

DROP POLICY IF EXISTS seasonal_events_select_for_members ON public.hotel_seasonal_window_events;
CREATE POLICY seasonal_events_select_for_members ON public.hotel_seasonal_window_events
  FOR SELECT USING (public.vaiyu_is_hotel_member(hotel_id));

-- No INSERT/UPDATE/DELETE policies — writes go through SECURITY DEFINER RPCs
-- (audit + writes paired). Revoke just in case any historical grant exists.
REVOKE INSERT, UPDATE, DELETE ON public.seasonal_calendar_windows    FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.hotel_seasonal_window_states FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.hotel_seasonal_window_events FROM authenticated;

-- ─── Read-model view: v_visible_seasonal_windows ────────────────────────────
-- Cross-joins hotels × active catalog, LEFT JOINs current-season-year state,
-- computes urgency / days_to_start / checklist progress, and region-matches.
-- security_invoker so hotels RLS scopes the result to the caller's memberships.

CREATE OR REPLACE VIEW public.v_visible_seasonal_windows
WITH (security_invoker = on) AS
WITH active_windows AS (
  SELECT
    w.*,
    public._seasonal_window_next_occurrence(
      w.start_month, w.start_day, w.end_month, w.end_day, now()
    ) AS occurrence
  FROM public.seasonal_calendar_windows w
  WHERE w.is_active = true
),
joined AS (
  SELECT
    h.id     AS hotel_id,
    h.slug   AS hotel_slug,
    h.state  AS hotel_state,
    aw.*,
    extract(year FROM lower(aw.occurrence))::int AS season_year
  FROM public.hotels h
  CROSS JOIN active_windows aw
  -- Defense-in-depth: hotels has permissive public SELECT policies (microsite,
  -- public-jobs, etc.) so security_invoker alone leaks unrelated hotels through
  -- this view. Explicit membership filter is mandatory. Mirrors DAM v_hotel_asset_status.
  WHERE public.vaiyu_is_hotel_member(h.id)
)
SELECT
  j.hotel_id,
  j.hotel_slug,
  j.hotel_state,
  j.code                                        AS window_code,
  j.category,
  j.display_name_en,
  j.display_name_hi,
  j.why_it_matters_en,
  j.why_it_matters_hi,
  j.recommended_action_en,
  j.recommended_action_hi,
  j.target_guest_segment_en,
  j.target_guest_segment_hi,
  j.suggested_package_idea_en,
  j.suggested_package_idea_hi,
  j.start_month,
  j.start_day,
  j.end_month,
  j.end_day,
  j.region_state_codes,
  j.priority,
  j.prep_checklist_seed,
  j.connected_module_suggestion,
  j.is_approximate,
  j.date_disclaimer_en,
  j.date_disclaimer_hi,
  j.display_order,
  j.season_year,
  lower(j.occurrence)                           AS next_start_ts,
  upper(j.occurrence)                           AS next_end_ts,
  GREATEST(0, (EXTRACT(EPOCH FROM lower(j.occurrence) - now()) / 86400)::int) AS days_to_start,
  CASE
    WHEN cardinality(j.region_state_codes) = 0                                        THEN true
    WHEN j.hotel_state IS NULL OR btrim(j.hotel_state) = ''                           THEN true
    WHEN public._seasonal_normalize_state(j.hotel_state) = ANY(j.region_state_codes)  THEN true
    ELSE false
  END AS is_regional_match,
  s.id                                          AS state_id,
  COALESCE(s.review_status, 'PLANNING'::public.seasonal_review_status) AS review_status,
  COALESCE(s.ticked_keys, '{}'::text[])         AS ticked_keys,
  s.owner_notes,
  s.internal_notes,
  s.urgency_override,
  s.urgency_override_reason,
  s.dismissed_reason,
  COALESCE(s.is_permanently_hidden, false)      AS is_permanently_hidden,
  s.permanently_hidden_reason,
  s.marked_ready_at,
  s.marked_ready_by,
  COALESCE(
    s.urgency_override,
    public._seasonal_window_urgency(lower(j.occurrence), upper(j.occurrence), now())
  ) AS computed_urgency,
  COALESCE(jsonb_array_length(j.prep_checklist_seed), 0) AS checklist_total,
  COALESCE((
    SELECT count(*)::int
      FROM jsonb_array_elements(j.prep_checklist_seed) item
     WHERE (item->>'key') = ANY(COALESCE(s.ticked_keys, '{}'::text[]))
  ), 0) AS checklist_done,
  s.created_at                                  AS state_created_at,
  s.updated_at                                  AS state_updated_at,
  s.updated_by                                  AS state_updated_by
FROM joined j
LEFT JOIN public.hotel_seasonal_window_states s
       ON s.hotel_id    = j.hotel_id
      AND s.window_code = j.code
      AND s.season_year = j.season_year;

COMMENT ON VIEW public.v_visible_seasonal_windows IS
  'Per-hotel × per-window view. security_invoker — hotels RLS scopes to caller. Computes urgency, days_to_start, checklist progress, and region match. State rows joined for current season_year only; prior years stay queryable directly.';

-- ─── Internal helper: record event (auth.uid actor + display name) ──────────

CREATE OR REPLACE FUNCTION public._record_seasonal_window_event(
  p_hotel_id    uuid,
  p_window_code text,
  p_season_year int,
  p_event_type  public.seasonal_window_event_type,
  p_payload     jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_id    uuid;
  v_actor uuid := auth.uid();
  v_name  text;
BEGIN
  IF v_actor IS NOT NULL THEN
    v_name := public._user_display_name(v_actor);
  END IF;
  INSERT INTO public.hotel_seasonal_window_events (
    hotel_id, window_code, season_year, event_type, payload, actor_id, actor_name_snapshot
  ) VALUES (
    p_hotel_id, p_window_code, p_season_year, p_event_type, COALESCE(p_payload, '{}'::jsonb), v_actor, v_name
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ─── Helper: compute current season_year for a (hotel-time) reference ───────
-- Same computation used by the view, but exposed as a function so RPCs can
-- compute season_year cheaply for state UPSERTs.

CREATE OR REPLACE FUNCTION public._seasonal_window_current_season_year(p_code text, p_at timestamptz)
RETURNS int
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_row public.seasonal_calendar_windows;
  v_occ tstzrange;
BEGIN
  SELECT * INTO v_row FROM public.seasonal_calendar_windows WHERE code = p_code;
  IF v_row.code IS NULL THEN
    RAISE EXCEPTION 'WINDOW_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  v_occ := public._seasonal_window_next_occurrence(
    v_row.start_month, v_row.start_day, v_row.end_month, v_row.end_day, p_at
  );
  RETURN extract(year FROM lower(v_occ))::int;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPCs (8) — SECURITY DEFINER, SET search_path = 'public'
-- All writes go through these. No direct INSERT/UPDATE allowed on state.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. tick_seasonal_checklist ─────────────────────────────────────────────
-- Toggles a single checklist item. UPSERTs state on first write.
-- Idempotent: ticking an already-ticked key is a no-op (no audit event fired).

CREATE OR REPLACE FUNCTION public.tick_seasonal_checklist(
  p_hotel_id    uuid,
  p_window_code text,
  p_item_key    text,
  p_ticked      boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_year       int;
  v_state      public.hotel_seasonal_window_states;
  v_was_ticked boolean;
  v_window     public.seasonal_calendar_windows;
  v_key_valid  boolean;
BEGIN
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF p_item_key IS NULL OR btrim(p_item_key) = '' THEN
    RAISE EXCEPTION 'ITEM_KEY_REQUIRED';
  END IF;

  SELECT * INTO v_window FROM public.seasonal_calendar_windows WHERE code = p_window_code AND is_active = true;
  IF v_window.code IS NULL THEN
    RAISE EXCEPTION 'WINDOW_NOT_FOUND';
  END IF;

  -- Validate that p_item_key exists in this window's checklist seed.
  -- Prevents writing orphan keys that would never render.
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_window.prep_checklist_seed) item
     WHERE item->>'key' = p_item_key
  ) INTO v_key_valid;
  IF NOT v_key_valid THEN
    RAISE EXCEPTION 'ITEM_KEY_NOT_IN_CATALOG';
  END IF;

  v_year := public._seasonal_window_current_season_year(p_window_code, now());

  -- UPSERT state row, then read back. ON CONFLICT DO UPDATE with a trivial
  -- set + FOR UPDATE pattern serializes concurrent ticks safely.
  INSERT INTO public.hotel_seasonal_window_states (hotel_id, window_code, season_year, ticked_keys, created_by, updated_by)
  VALUES (p_hotel_id, p_window_code, v_year, '{}'::text[], auth.uid(), auth.uid())
  ON CONFLICT (hotel_id, window_code, season_year) DO UPDATE
    SET window_code = EXCLUDED.window_code;  -- no-op refresh just to take the lock

  SELECT * INTO v_state
    FROM public.hotel_seasonal_window_states
   WHERE hotel_id = p_hotel_id AND window_code = p_window_code AND season_year = v_year
   FOR UPDATE;

  v_was_ticked := p_item_key = ANY(v_state.ticked_keys);

  IF p_ticked AND v_was_ticked THEN
    -- Already ticked, no-op
    RETURN jsonb_build_object('state_id', v_state.id, 'changed', false,
                              'ticked_keys', to_jsonb(v_state.ticked_keys));
  END IF;
  IF NOT p_ticked AND NOT v_was_ticked THEN
    -- Already unticked, no-op
    RETURN jsonb_build_object('state_id', v_state.id, 'changed', false,
                              'ticked_keys', to_jsonb(v_state.ticked_keys));
  END IF;

  IF p_ticked THEN
    UPDATE public.hotel_seasonal_window_states
       SET ticked_keys = array_append(ticked_keys, p_item_key),
           updated_by  = auth.uid()
     WHERE id = v_state.id;
    PERFORM public._record_seasonal_window_event(
      p_hotel_id, p_window_code, v_year, 'CHECKLIST_TICKED',
      jsonb_build_object('item_key', p_item_key)
    );
  ELSE
    UPDATE public.hotel_seasonal_window_states
       SET ticked_keys = array_remove(ticked_keys, p_item_key),
           updated_by  = auth.uid()
     WHERE id = v_state.id;
    PERFORM public._record_seasonal_window_event(
      p_hotel_id, p_window_code, v_year, 'CHECKLIST_UNTICKED',
      jsonb_build_object('item_key', p_item_key)
    );
  END IF;

  SELECT * INTO v_state FROM public.hotel_seasonal_window_states WHERE id = v_state.id;
  RETURN jsonb_build_object(
    'state_id',     v_state.id,
    'changed',      true,
    'ticked_keys',  to_jsonb(v_state.ticked_keys),
    'season_year',  v_year
  );
END;
$$;

-- ─── 2. update_seasonal_window_notes ────────────────────────────────────────
-- Updates owner_notes and/or internal_notes. Empty string normalized to NULL.
-- Audit event fires only when content actually changes.

CREATE OR REPLACE FUNCTION public.update_seasonal_window_notes(
  p_hotel_id       uuid,
  p_window_code    text,
  p_owner_notes    text DEFAULT NULL,
  p_internal_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_year       int;
  v_state      public.hotel_seasonal_window_states;
  v_new_owner  text := NULLIF(btrim(COALESCE(p_owner_notes, '')), '');
  v_new_int    text := NULLIF(btrim(COALESCE(p_internal_notes, '')), '');
  v_changed    boolean := false;
  v_payload    jsonb := '{}'::jsonb;
BEGIN
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.seasonal_calendar_windows WHERE code = p_window_code AND is_active = true) THEN
    RAISE EXCEPTION 'WINDOW_NOT_FOUND';
  END IF;

  v_year := public._seasonal_window_current_season_year(p_window_code, now());

  INSERT INTO public.hotel_seasonal_window_states (hotel_id, window_code, season_year, created_by, updated_by)
  VALUES (p_hotel_id, p_window_code, v_year, auth.uid(), auth.uid())
  ON CONFLICT (hotel_id, window_code, season_year) DO UPDATE SET window_code = EXCLUDED.window_code;

  SELECT * INTO v_state
    FROM public.hotel_seasonal_window_states
   WHERE hotel_id = p_hotel_id AND window_code = p_window_code AND season_year = v_year
   FOR UPDATE;

  IF p_owner_notes IS NOT NULL AND v_new_owner IS DISTINCT FROM v_state.owner_notes THEN
    v_changed := true;
    v_payload := v_payload || jsonb_build_object(
      'owner_notes_len_before', COALESCE(length(v_state.owner_notes), 0),
      'owner_notes_len_after',  COALESCE(length(v_new_owner), 0)
    );
  END IF;
  IF p_internal_notes IS NOT NULL AND v_new_int IS DISTINCT FROM v_state.internal_notes THEN
    v_changed := true;
    v_payload := v_payload || jsonb_build_object(
      'internal_notes_len_before', COALESCE(length(v_state.internal_notes), 0),
      'internal_notes_len_after',  COALESCE(length(v_new_int), 0)
    );
  END IF;

  IF v_changed THEN
    UPDATE public.hotel_seasonal_window_states SET
      owner_notes    = CASE WHEN p_owner_notes    IS NULL THEN owner_notes    ELSE v_new_owner END,
      internal_notes = CASE WHEN p_internal_notes IS NULL THEN internal_notes ELSE v_new_int   END,
      updated_by     = auth.uid()
    WHERE id = v_state.id;

    PERFORM public._record_seasonal_window_event(
      p_hotel_id, p_window_code, v_year, 'NOTES_UPDATED', v_payload
    );
  END IF;

  SELECT * INTO v_state FROM public.hotel_seasonal_window_states WHERE id = v_state.id;
  RETURN jsonb_build_object(
    'state_id',       v_state.id,
    'changed',        v_changed,
    'owner_notes',    v_state.owner_notes,
    'internal_notes', v_state.internal_notes
  );
END;
$$;

-- ─── 3. override_seasonal_window_urgency (manager+) ─────────────────────────
-- Sets or clears urgency_override. Reason required when setting.

CREATE OR REPLACE FUNCTION public.override_seasonal_window_urgency(
  p_hotel_id    uuid,
  p_window_code text,
  p_urgency     public.seasonal_window_urgency,  -- NULL = clear
  p_reason      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_year   int;
  v_state  public.hotel_seasonal_window_states;
  v_prev   public.seasonal_window_urgency;
BEGIN
  IF NOT public.vaiyu_is_hotel_finance_manager(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.seasonal_calendar_windows WHERE code = p_window_code AND is_active = true) THEN
    RAISE EXCEPTION 'WINDOW_NOT_FOUND';
  END IF;
  IF p_urgency IS NOT NULL AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'OVERRIDE_REASON_REQUIRED';
  END IF;

  v_year := public._seasonal_window_current_season_year(p_window_code, now());

  INSERT INTO public.hotel_seasonal_window_states (hotel_id, window_code, season_year, created_by, updated_by)
  VALUES (p_hotel_id, p_window_code, v_year, auth.uid(), auth.uid())
  ON CONFLICT (hotel_id, window_code, season_year) DO UPDATE SET window_code = EXCLUDED.window_code;

  SELECT * INTO v_state
    FROM public.hotel_seasonal_window_states
   WHERE hotel_id = p_hotel_id AND window_code = p_window_code AND season_year = v_year
   FOR UPDATE;

  v_prev := v_state.urgency_override;

  UPDATE public.hotel_seasonal_window_states SET
    urgency_override        = p_urgency,
    urgency_override_reason = CASE WHEN p_urgency IS NULL THEN NULL ELSE btrim(p_reason) END,
    updated_by              = auth.uid()
  WHERE id = v_state.id;

  IF p_urgency IS NOT NULL THEN
    PERFORM public._record_seasonal_window_event(
      p_hotel_id, p_window_code, v_year, 'URGENCY_OVERRIDDEN',
      jsonb_build_object('from', v_prev::text, 'to', p_urgency::text, 'reason', btrim(p_reason))
    );
  ELSE
    PERFORM public._record_seasonal_window_event(
      p_hotel_id, p_window_code, v_year, 'URGENCY_OVERRIDE_CLEARED',
      jsonb_build_object('from', v_prev::text)
    );
  END IF;

  RETURN jsonb_build_object('state_id', v_state.id, 'urgency_override', p_urgency::text);
END;
$$;

-- ─── 4. dismiss_seasonal_window_for_year (manager+) ─────────────────────────

CREATE OR REPLACE FUNCTION public.dismiss_seasonal_window_for_year(
  p_hotel_id    uuid,
  p_window_code text,
  p_reason      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_year   int;
  v_state  public.hotel_seasonal_window_states;
BEGIN
  IF NOT public.vaiyu_is_hotel_finance_manager(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.seasonal_calendar_windows WHERE code = p_window_code AND is_active = true) THEN
    RAISE EXCEPTION 'WINDOW_NOT_FOUND';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'DISMISS_REASON_REQUIRED';
  END IF;

  v_year := public._seasonal_window_current_season_year(p_window_code, now());

  INSERT INTO public.hotel_seasonal_window_states (hotel_id, window_code, season_year, created_by, updated_by)
  VALUES (p_hotel_id, p_window_code, v_year, auth.uid(), auth.uid())
  ON CONFLICT (hotel_id, window_code, season_year) DO UPDATE SET window_code = EXCLUDED.window_code;

  SELECT * INTO v_state
    FROM public.hotel_seasonal_window_states
   WHERE hotel_id = p_hotel_id AND window_code = p_window_code AND season_year = v_year
   FOR UPDATE;

  -- Dropping out of READY when dismissing — must clear marked_ready_* too to
  -- satisfy CHECK that READY pairs with marked_ready_at.
  UPDATE public.hotel_seasonal_window_states SET
    review_status     = 'DISMISSED',
    dismissed_reason  = btrim(p_reason),
    marked_ready_at   = NULL,
    marked_ready_by   = NULL,
    updated_by        = auth.uid()
  WHERE id = v_state.id;

  PERFORM public._record_seasonal_window_event(
    p_hotel_id, p_window_code, v_year, 'DISMISSED_FOR_YEAR',
    jsonb_build_object('reason', btrim(p_reason), 'prev_review_status', v_state.review_status::text)
  );

  RETURN jsonb_build_object('state_id', v_state.id, 'review_status', 'DISMISSED');
END;
$$;

-- ─── 5. resume_seasonal_window (manager+; from DISMISSED → PLANNING) ────────

CREATE OR REPLACE FUNCTION public.resume_seasonal_window(
  p_hotel_id    uuid,
  p_window_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_year  int;
  v_state public.hotel_seasonal_window_states;
BEGIN
  IF NOT public.vaiyu_is_hotel_finance_manager(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  v_year := public._seasonal_window_current_season_year(p_window_code, now());

  SELECT * INTO v_state
    FROM public.hotel_seasonal_window_states
   WHERE hotel_id = p_hotel_id AND window_code = p_window_code AND season_year = v_year
   FOR UPDATE;
  IF v_state.id IS NULL THEN
    RAISE EXCEPTION 'STATE_NOT_FOUND';
  END IF;
  IF v_state.review_status <> 'DISMISSED' THEN
    RAISE EXCEPTION 'INVALID_TRANSITION';
  END IF;

  UPDATE public.hotel_seasonal_window_states SET
    review_status    = 'PLANNING',
    dismissed_reason = NULL,
    updated_by       = auth.uid()
  WHERE id = v_state.id;

  PERFORM public._record_seasonal_window_event(
    p_hotel_id, p_window_code, v_year, 'RESUMED_FROM_DISMISSAL', '{}'::jsonb
  );

  RETURN jsonb_build_object('state_id', v_state.id, 'review_status', 'PLANNING');
END;
$$;

-- ─── 6. mark_seasonal_window_ready (manager+) ───────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_seasonal_window_ready(
  p_hotel_id    uuid,
  p_window_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_year         int;
  v_state        public.hotel_seasonal_window_states;
  v_window       public.seasonal_calendar_windows;
  v_done         int;
  v_total        int;
BEGIN
  IF NOT public.vaiyu_is_hotel_finance_manager(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT * INTO v_window FROM public.seasonal_calendar_windows WHERE code = p_window_code AND is_active = true;
  IF v_window.code IS NULL THEN
    RAISE EXCEPTION 'WINDOW_NOT_FOUND';
  END IF;

  v_year := public._seasonal_window_current_season_year(p_window_code, now());

  INSERT INTO public.hotel_seasonal_window_states (hotel_id, window_code, season_year, created_by, updated_by)
  VALUES (p_hotel_id, p_window_code, v_year, auth.uid(), auth.uid())
  ON CONFLICT (hotel_id, window_code, season_year) DO UPDATE SET window_code = EXCLUDED.window_code;

  SELECT * INTO v_state
    FROM public.hotel_seasonal_window_states
   WHERE hotel_id = p_hotel_id AND window_code = p_window_code AND season_year = v_year
   FOR UPDATE;

  IF v_state.review_status = 'READY' THEN
    RETURN jsonb_build_object('state_id', v_state.id, 'review_status', 'READY', 'changed', false);
  END IF;
  IF v_state.review_status = 'DISMISSED' THEN
    RAISE EXCEPTION 'INVALID_TRANSITION';
  END IF;

  v_total := COALESCE(jsonb_array_length(v_window.prep_checklist_seed), 0);
  SELECT count(*)::int INTO v_done
    FROM jsonb_array_elements(v_window.prep_checklist_seed) item
   WHERE (item->>'key') = ANY(COALESCE(v_state.ticked_keys, '{}'::text[]));

  UPDATE public.hotel_seasonal_window_states SET
    review_status   = 'READY',
    marked_ready_at = now(),
    marked_ready_by = auth.uid(),
    updated_by      = auth.uid()
  WHERE id = v_state.id;

  PERFORM public._record_seasonal_window_event(
    p_hotel_id, p_window_code, v_year, 'MARKED_READY',
    jsonb_build_object('checklist_done', v_done, 'checklist_total', v_total)
  );

  RETURN jsonb_build_object(
    'state_id',         v_state.id,
    'review_status',    'READY',
    'changed',          true,
    'checklist_done',   v_done,
    'checklist_total',  v_total
  );
END;
$$;

-- ─── 7. return_seasonal_window_to_planning (manager+; READY → PLANNING) ─────

CREATE OR REPLACE FUNCTION public.return_seasonal_window_to_planning(
  p_hotel_id    uuid,
  p_window_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_year  int;
  v_state public.hotel_seasonal_window_states;
BEGIN
  IF NOT public.vaiyu_is_hotel_finance_manager(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  v_year := public._seasonal_window_current_season_year(p_window_code, now());

  SELECT * INTO v_state
    FROM public.hotel_seasonal_window_states
   WHERE hotel_id = p_hotel_id AND window_code = p_window_code AND season_year = v_year
   FOR UPDATE;
  IF v_state.id IS NULL THEN
    RAISE EXCEPTION 'STATE_NOT_FOUND';
  END IF;
  IF v_state.review_status <> 'READY' THEN
    RAISE EXCEPTION 'INVALID_TRANSITION';
  END IF;

  UPDATE public.hotel_seasonal_window_states SET
    review_status    = 'PLANNING',
    marked_ready_at  = NULL,
    marked_ready_by  = NULL,
    updated_by       = auth.uid()
  WHERE id = v_state.id;

  PERFORM public._record_seasonal_window_event(
    p_hotel_id, p_window_code, v_year, 'RETURNED_TO_PLANNING', '{}'::jsonb
  );

  RETURN jsonb_build_object('state_id', v_state.id, 'review_status', 'PLANNING');
END;
$$;

-- ─── 8. set_seasonal_window_permanently_hidden (manager+) ───────────────────
-- Year-independent "never relevant for this hotel" toggle.
-- Setting requires reason; clearing does not.

CREATE OR REPLACE FUNCTION public.set_seasonal_window_permanently_hidden(
  p_hotel_id    uuid,
  p_window_code text,
  p_hidden      boolean,
  p_reason      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_year  int;
  v_state public.hotel_seasonal_window_states;
BEGIN
  IF NOT public.vaiyu_is_hotel_finance_manager(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.seasonal_calendar_windows WHERE code = p_window_code AND is_active = true) THEN
    RAISE EXCEPTION 'WINDOW_NOT_FOUND';
  END IF;
  IF p_hidden AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'HIDE_REASON_REQUIRED';
  END IF;

  v_year := public._seasonal_window_current_season_year(p_window_code, now());

  INSERT INTO public.hotel_seasonal_window_states (hotel_id, window_code, season_year, created_by, updated_by)
  VALUES (p_hotel_id, p_window_code, v_year, auth.uid(), auth.uid())
  ON CONFLICT (hotel_id, window_code, season_year) DO UPDATE SET window_code = EXCLUDED.window_code;

  SELECT * INTO v_state
    FROM public.hotel_seasonal_window_states
   WHERE hotel_id = p_hotel_id AND window_code = p_window_code AND season_year = v_year
   FOR UPDATE;

  UPDATE public.hotel_seasonal_window_states SET
    is_permanently_hidden     = p_hidden,
    permanently_hidden_reason = CASE WHEN p_hidden THEN btrim(p_reason) ELSE NULL END,
    updated_by                = auth.uid()
  WHERE id = v_state.id;

  PERFORM public._record_seasonal_window_event(
    p_hotel_id, p_window_code, v_year,
    CASE WHEN p_hidden THEN 'PERMANENTLY_HIDDEN'::public.seasonal_window_event_type
         ELSE              'PERMANENTLY_HIDDEN_CLEARED'::public.seasonal_window_event_type
    END,
    CASE WHEN p_hidden THEN jsonb_build_object('reason', btrim(p_reason)) ELSE '{}'::jsonb END
  );

  RETURN jsonb_build_object('state_id', v_state.id, 'is_permanently_hidden', p_hidden);
END;
$$;

-- ─── Read RPC: get_seasonal_window_timeline ─────────────────────────────────
-- Returns the most recent N events for an inline "history" surface in the
-- window card. RLS on hotel_seasonal_window_events scopes by membership.

CREATE OR REPLACE FUNCTION public.get_seasonal_window_timeline(
  p_hotel_id    uuid,
  p_window_code text,
  p_season_year int,
  p_limit       int DEFAULT 20
)
RETURNS TABLE (
  id           uuid,
  event_type   public.seasonal_window_event_type,
  payload      jsonb,
  actor_id     uuid,
  actor_name   text,
  occurred_at  timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  RETURN QUERY
    SELECT e.id, e.event_type, e.payload, e.actor_id, e.actor_name_snapshot, e.occurred_at
      FROM public.hotel_seasonal_window_events e
     WHERE e.hotel_id    = p_hotel_id
       AND e.window_code = p_window_code
       AND e.season_year = p_season_year
     ORDER BY e.occurred_at DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 200));
END;
$$;

-- ─── Grants ─────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public._seasonal_normalize_state(text)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public._seasonal_window_next_occurrence(int,int,int,int,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public._seasonal_window_urgency(timestamptz,timestamptz,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public._seasonal_window_current_season_year(text,timestamptz)   TO authenticated;

GRANT EXECUTE ON FUNCTION public.tick_seasonal_checklist                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_seasonal_window_notes             TO authenticated;
GRANT EXECUTE ON FUNCTION public.override_seasonal_window_urgency         TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_seasonal_window_for_year         TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_seasonal_window                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_seasonal_window_ready               TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_seasonal_window_to_planning       TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_seasonal_window_permanently_hidden   TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seasonal_window_timeline             TO authenticated;

GRANT SELECT ON public.v_visible_seasonal_windows TO authenticated;

-- ─── Realtime publication ───────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.hotel_seasonal_window_states;  EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.hotel_seasonal_window_events;  EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Catalog seed (16 windows)
-- Content sign-off received from product owner before commit.
-- Dates intentionally widened for is_approximate=true windows so we never
-- have to ship date-correction migrations as panchang/lunar dates shift.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.seasonal_calendar_windows (
  code, category, display_name_en, display_name_hi,
  why_it_matters_en, why_it_matters_hi,
  recommended_action_en, recommended_action_hi,
  target_guest_segment_en, target_guest_segment_hi,
  suggested_package_idea_en, suggested_package_idea_hi,
  start_month, start_day, end_month, end_day,
  region_state_codes, priority,
  prep_checklist_seed,
  connected_module_suggestion, is_approximate,
  date_disclaimer_en, date_disclaimer_hi,
  display_order
) VALUES

-- 1. Char Dham opening (early peak — rush to set up)
('CHAR_DHAM_OPENING', 'RELIGIOUS_YATRA',
 'Char Dham — Opening Peak',
 'Char Dham — Yatra Shuruaat',
 'Yatra doors open and the first big wave of pilgrims arrives. OTAs and route demand spike fastest in these 3–4 weeks.',
 'Yatra ke darwaze khulte hi pilgrims ki pehli badi wave aati hai. OTA aur road demand iss period mein sabse tezi se badhti hai.',
 'Get pricing, packages, and verification proof live before the doors open. Late updates lose the first wave.',
 'Pricing, packages aur verification proof darwaze khulne se pehle ready rakhein. Late updates pehli wave miss kar dete hain.',
 'Char Dham pilgrims, North Indian families, route-stop travellers',
 'Char Dham pilgrims, North Indian families, route-stop travellers',
 '"Yatra-ready 2-night stop" — early check-in, packed darshan-day breakfast, prayer corner, route map.',
 '"Yatra-ready 2-night stop" — early check-in, darshan-day breakfast, prayer corner, route map.',
 4, 20, 5, 25, '{uk}'::text[], 'CRITICAL',
 '[
   {"key":"verify_packages_live","label_en":"Verify yatra packages are live in Package Builder","label_hi":"Yatra packages Package Builder mein live hain confirm karein","days_before":60,"link_target":"PACKAGE_BUILDER"},
   {"key":"refresh_dam_signboard","label_en":"Refresh signboard + entrance photos in Asset Manager","label_hi":"Signboard + entrance photos Asset Manager mein refresh karein","days_before":45,"link_target":"DAM"},
   {"key":"update_ota_pricing","label_en":"Update OTA pricing for pilgrim peak","label_hi":"Pilgrim peak ke liye OTA pricing update karein","days_before":30,"link_target":null},
   {"key":"brief_front_desk_darshan","label_en":"Brief front desk on darshan timings + Yatra Card","label_hi":"Front desk ko darshan timings + Yatra Card brief karein","days_before":21,"link_target":null},
   {"key":"whatsapp_past_pilgrims","label_en":"Send WhatsApp note to past pilgrim guests","label_hi":"Past pilgrim guests ko WhatsApp note bhejein","days_before":14,"link_target":null},
   {"key":"confirm_parking","label_en":"Confirm parking for yatra vehicles","label_hi":"Yatra vehicles ke liye parking confirm karein","days_before":7,"link_target":null},
   {"key":"verify_cancellation_policy","label_en":"Verify cancellation policy is visible on microsite","label_hi":"Microsite par cancellation policy visible confirm karein","days_before":3,"link_target":null}
 ]'::jsonb,
 'PACKAGE_BUILDER', true,
 'Approximate window. Actual yatra opening varies by panchang each year — refer to the Char Dham Devasthanam Board.',
 'Approximate window hai. Asli yatra opening har saal panchang ke hisaab se badalti hai — Char Dham Devasthanam Board se confirm karein.',
 10),

-- 2. Char Dham peak (sustained demand)
('CHAR_DHAM_PEAK', 'RELIGIOUS_YATRA',
 'Char Dham — Sustained Peak',
 'Char Dham — Peak Season',
 'The long tail of yatra season. Operational excellence and repeat-guest follow-up matter most here.',
 'Yatra season ka lamba peak. Yahan operations + repeat-guest follow-up sabse zyada matter karta hai.',
 'Keep operations steady. Capture testimonials. Watch for monsoon-induced cancellations from late June.',
 'Operations steady rakhein. Testimonials lein. Late June se monsoon ki wajah se cancellations check karein.',
 'Pilgrim families, repeat yatris, group bookings',
 'Pilgrim families, repeat yatris, group bookings',
 '"Group of 6+ yatra package" — bulk meals, prayer space, dedicated check-in counter.',
 '"6+ yatris ka group package" — bulk meals, prayer space, dedicated check-in counter.',
 5, 25, 8, 15, '{uk}'::text[], 'CRITICAL',
 '[
   {"key":"daily_inspect_pilgrim_rooms","label_en":"Daily room inspection — pilgrim-stay essentials","label_hi":"Daily room inspection — pilgrim-stay essentials"},
   {"key":"collect_testimonials","label_en":"Collect testimonials from departing pilgrim guests","label_hi":"Departing pilgrim guests se testimonials lein"},
   {"key":"weekly_review_cancellations","label_en":"Weekly review of monsoon-cancellation pattern","label_hi":"Monsoon-cancellation pattern ka weekly review"},
   {"key":"refresh_meal_menu","label_en":"Confirm pilgrim meal menu (jain/satvik) is current","label_hi":"Pilgrim meal menu (jain/satvik) current hai confirm karein"},
   {"key":"medical_kit_check","label_en":"Verify medical kit + oxygen availability","label_hi":"Medical kit + oxygen availability verify karein"}
 ]'::jsonb,
 NULL, true,
 'Approximate window. Actual peak shifts with monsoon arrival and route conditions.',
 'Approximate window hai. Asli peak monsoon aur road conditions ke hisaab se badalta hai.',
 20),

-- 3. Char Dham closing
('CHAR_DHAM_CLOSING', 'RELIGIOUS_YATRA',
 'Char Dham — Closing Rush',
 'Char Dham — Closing Period',
 'Last-chance pilgrim window before doors close for winter. Higher demand from older travellers.',
 'Doors band hone se pehle ki last-chance pilgrim window. Older travellers ki demand zyada.',
 'Promote "before doors close" messaging. Plan winter package transition.',
 '"Before doors close" messaging chalu karein. Winter package transition plan karein.',
 'Senior pilgrims, last-month travellers, late-season groups',
 'Senior pilgrims, last-month travellers, late-season groups',
 '"Closing-week pilgrim escape" — heated rooms, early-morning warm meals, escort to darshan point.',
 '"Closing-week pilgrim escape" — heated rooms, early-morning warm meals, darshan point tak escort.',
 9, 15, 11, 15, '{uk}'::text[], 'HIGH',
 '[
   {"key":"warm_room_amenities","label_en":"Verify warm-room amenities (blankets, heater)","label_hi":"Warm-room amenities (blankets, heater) verify karein"},
   {"key":"closing_messaging","label_en":"Update OTA + microsite with closing-week messaging","label_hi":"OTA + microsite par closing-week messaging update karein"},
   {"key":"senior_traveller_brief","label_en":"Brief staff on senior-traveller comfort SOPs","label_hi":"Staff ko senior-traveller comfort SOPs brief karein"},
   {"key":"winter_package_setup","label_en":"Begin winter snow-stay package setup in Package Builder","label_hi":"Winter snow-stay package Package Builder mein setup chalu karein","link_target":"PACKAGE_BUILDER"},
   {"key":"document_closing_dates","label_en":"Document the official closing dates from yatra board","label_hi":"Yatra board ki official closing dates document karein"}
 ]'::jsonb,
 'PACKAGE_BUILDER', true,
 'Approximate window. Bhai Dooj-anchored closing date set annually by the yatra board.',
 'Approximate window hai. Bhai Dooj ke aas-paas yatra board ki official closing date.',
 30),

-- 4. Summer hill escape
('SUMMER_HILL_ESCAPE', 'METRO_ESCAPE',
 'Summer Hill Escape',
 'Garmi se Pahad Ki Chhutti',
 'Metro families escape the heat. Highest non-yatra demand window for hill stations.',
 'Metro families garmi se bhagti hain. Hill stations ke liye non-yatra ki sabse badi demand.',
 'Promote family-friendly packages. Highlight cooler weather + activities for kids.',
 'Family-friendly packages chalayein. Thanda mausam + bachhon ke activities highlight karein.',
 'Delhi-NCR families, school-holiday travellers, multi-generation groups',
 'Delhi-NCR families, school-holiday travellers, multi-generation groups',
 '"4-night family escape" — kids activity, bonfire night, mountain-view breakfast, easy hikes.',
 '"4-raat family escape" — kids activity, bonfire night, mountain-view breakfast, asaan hikes.',
 4, 10, 7, 5, '{uk,hp,jk}'::text[], 'CRITICAL',
 '[
   {"key":"family_package_live","label_en":"Verify family-friendly packages live","label_hi":"Family-friendly packages live confirm karein","link_target":"PACKAGE_BUILDER"},
   {"key":"kids_activity_plan","label_en":"Document kids activity plan + safety SOPs","label_hi":"Kids activity plan + safety SOPs document karein"},
   {"key":"refresh_family_photos","label_en":"Refresh family + mountain-view photos in Asset Manager","label_hi":"Family + mountain-view photos Asset Manager mein refresh karein","link_target":"DAM"},
   {"key":"ota_summer_pricing","label_en":"Update OTA pricing for summer peak","label_hi":"Summer peak ke liye OTA pricing update karein"},
   {"key":"book_activity_partners","label_en":"Confirm bookings with activity partners","label_hi":"Activity partners ke saath bookings confirm karein","link_target":null},
   {"key":"whatsapp_past_families","label_en":"WhatsApp note to past summer family guests","label_hi":"Past summer family guests ko WhatsApp note"},
   {"key":"weekend_staff_schedule","label_en":"Weekend staff schedule confirmed (peak load)","label_hi":"Weekend staff schedule confirmed (peak load)"}
 ]'::jsonb,
 'PACKAGE_BUILDER', true,
 'Approximate window. Peak shifts ±2 weeks with school holiday calendars across boards.',
 'Approximate window hai. School holiday calendars ke hisaab se peak ±2 hafte shift hota hai.',
 40),

-- 5. Monsoon value
('MONSOON_VALUE', 'OFF_PEAK_VALUE',
 'Monsoon Value Window',
 'Monsoon Value Window',
 'Lower demand window. Right-priced stays with good monsoon experience can capture meaningful weekend volume.',
 'Demand kam hoti hai. Sahi pricing + accha monsoon experience weekend volume capture kar sakta hai.',
 'Build value packages. Tighten cancellation policy clarity. Be visible on "monsoon stay" search.',
 'Value packages banayein. Cancellation policy clear rakhein. "Monsoon stay" search par visible rahein.',
 'Couples, off-peak value seekers, monsoon photographers',
 'Couples, off-peak value seekers, monsoon photographers',
 '"Monsoon weekend escape" — covered balcony, hot tea on arrival, indoor games, flexible cancellation.',
 '"Monsoon weekend escape" — covered balcony, garam chai, indoor games, flexible cancellation.',
 6, 25, 9, 10, '{uk,hp}'::text[], 'MEDIUM',
 '[
   {"key":"monsoon_package_live","label_en":"Monsoon value package live","label_hi":"Monsoon value package live","link_target":"PACKAGE_BUILDER"},
   {"key":"flexible_cancellation","label_en":"Verify flexible cancellation policy on listings","label_hi":"Listings par flexible cancellation policy verify karein"},
   {"key":"covered_areas_clean","label_en":"Inspect covered balcony / lobby drainage","label_hi":"Covered balcony / lobby drainage inspect karein"},
   {"key":"road_status_brief","label_en":"Front desk briefed on road status sharing protocol","label_hi":"Front desk ko road status sharing protocol brief karein"},
   {"key":"indoor_amenities_check","label_en":"Indoor amenities (board games, books) stocked","label_hi":"Indoor amenities (board games, books) stocked"}
 ]'::jsonb,
 'PACKAGE_BUILDER', true,
 'Approximate window. Monsoon onset/withdrawal varies ±2 weeks year to year.',
 'Approximate window hai. Monsoon onset/withdrawal ±2 hafte vary karta hai.',
 50),

-- 6. Autumn shoulder
('AUTUMN_SHOULDER', 'CLIMATE_PEAK',
 'Autumn Shoulder Season',
 'Sharad Ritu Window',
 'Clear weather, fewer crowds, festival-adjacent travel. Strong for short-getaway and wellness positioning.',
 'Saaf mausam, kam crowd, festival-side travel. Short-getaway + wellness ke liye strong window.',
 'Promote wellness + workation angles. Photo content from this window performs best on social.',
 'Wellness + workation positioning chalayein. Iss window ki photo content social par best perform karti hai.',
 'Wellness travellers, workation seekers, photographers, couples',
 'Wellness travellers, workation seekers, photographers, couples',
 '"5-day wellness reset" — yoga slot, healthy breakfast, valley-view workspace, evening walks.',
 '"5-din wellness reset" — yoga slot, healthy breakfast, valley-view workspace, evening walks.',
 9, 10, 11, 5, '{uk,hp,jk}'::text[], 'MEDIUM',
 '[
   {"key":"wellness_package_live","label_en":"Wellness/workation package live","label_hi":"Wellness/workation package live","link_target":"PACKAGE_BUILDER"},
   {"key":"social_content_plan","label_en":"Schedule autumn photo shoot for social","label_hi":"Autumn photo shoot social ke liye schedule karein"},
   {"key":"wifi_workspace_check","label_en":"Verify WiFi speed + workspace setup in rooms","label_hi":"WiFi speed + workspace setup rooms mein verify karein"},
   {"key":"yoga_partner_confirmed","label_en":"Yoga / wellness partner availability confirmed","label_hi":"Yoga / wellness partner availability confirmed","link_target":null},
   {"key":"breakfast_menu_healthy","label_en":"Healthy breakfast menu options ready","label_hi":"Healthy breakfast menu options ready"}
 ]'::jsonb,
 'PACKAGE_BUILDER', true,
 'Approximate window — clear-weather span shifts with monsoon withdrawal.',
 'Approximate window hai — saaf-mausam span monsoon withdrawal ke hisaab se badalta hai.',
 60),

-- 7. Winter snow stay (cross-year window)
('WINTER_SNOW_STAY', 'WINTER_SNOW',
 'Winter Snow Stay',
 'Snow Stay — Sardiyon Ka Maza',
 'Snow draws families and couples seeking the "first snow" experience. Highly Instagrammable, strong WhatsApp word-of-mouth.',
 'Snow families + couples ko attract karti hai. Instagram + WhatsApp word-of-mouth strong rehta hai.',
 'Set up heated-room messaging, snow activity partners, hot food + bonfire packages.',
 'Heated-room messaging, snow activity partners, garam khana + bonfire packages set karein.',
 'Honeymoon couples, families with kids, north Indian holidaymakers',
 'Honeymoon couples, families with kids, north Indian holidaymakers',
 '"Snow honeymoon 3-night" — heated room, candlelight dinner, snow-walk guide, bonfire night.',
 '"Snow honeymoon 3-night" — heated room, candlelight dinner, snow-walk guide, bonfire night.',
 12, 10, 2, 25, '{uk,hp,jk}'::text[], 'HIGH',
 '[
   {"key":"snow_package_live","label_en":"Snow/winter package live","label_hi":"Snow/winter package live","link_target":"PACKAGE_BUILDER"},
   {"key":"heating_systems_check","label_en":"Room heaters serviced + tested","label_hi":"Room heaters service + test ho gaye"},
   {"key":"winter_food_menu","label_en":"Winter comfort-food menu confirmed","label_hi":"Winter comfort-food menu confirmed"},
   {"key":"snow_activity_partner","label_en":"Snow activity partner agreement signed","label_hi":"Snow activity partner agreement signed","link_target":null},
   {"key":"bonfire_safety","label_en":"Bonfire location + safety SOPs documented","label_hi":"Bonfire location + safety SOPs documented"},
   {"key":"emergency_road_plan","label_en":"Emergency snowfall road plan briefed","label_hi":"Emergency snowfall road plan briefed"}
 ]'::jsonb,
 'PACKAGE_BUILDER', true,
 'Approximate window — first/last snowfall varies ±3 weeks by altitude and season.',
 'Approximate window hai — pehli/aakhri snowfall ±3 hafte vary karti hai.',
 70),

-- 8. Long weekend — Republic Day (exact)
('LONGWKND_REPUBLIC_DAY', 'LONG_WEEKEND',
 'Republic Day Long Weekend',
 'Republic Day Long Weekend',
 'Fixed-date 3-4 day weekend. Reliable Delhi-NCR + North India travel pulse.',
 'Fixed-date 3-4 din ka weekend. Delhi-NCR + North India ki reliable travel pulse.',
 'Run a short-stay package. Confirm OTA inventory and pricing.',
 'Short-stay package chalayein. OTA inventory + pricing confirm karein.',
 'Weekend travellers, Delhi-NCR families, short-trip couples',
 'Weekend travellers, Delhi-NCR families, short-trip couples',
 '"R-Day 3-night escape" — patriotic-themed welcome drink, bonfire, walking trail map.',
 '"R-Day 3-night escape" — patriotic welcome drink, bonfire, walking trail map.',
 1, 23, 1, 28, '{}'::text[], 'HIGH',
 '[
   {"key":"weekend_package_live","label_en":"Long-weekend package live","label_hi":"Long-weekend package live","link_target":"PACKAGE_BUILDER"},
   {"key":"ota_inventory_open","label_en":"OTA inventory open for these dates","label_hi":"OTA inventory in dates ke liye open"},
   {"key":"weekend_staffing","label_en":"Weekend staffing confirmed (peak load)","label_hi":"Weekend staffing confirmed (peak load)"},
   {"key":"whatsapp_past_weekenders","label_en":"WhatsApp blast to past weekend guests","label_hi":"Past weekend guests ko WhatsApp blast"}
 ]'::jsonb,
 'PACKAGE_BUILDER', false,
 NULL, NULL, 110),

-- 9. Long weekend — Holi (lunar, WIDE window to absorb panchang drift across 2026-2030)
('LONGWKND_HOLI', 'LONG_WEEKEND',
 'Holi Long Weekend',
 'Holi Long Weekend',
 'Festival weekend. Strong cross-India demand. Family + group bookings spike.',
 'Festival weekend. Cross-India ki strong demand. Family + group bookings spike karte hain.',
 'Plan Holi-day-after packages. Coordinate with cleaning team for stains.',
 'Holi-ke-din-baad packages plan karein. Cleaning team ke saath stains coordinate karein.',
 'Family groups, college reunion trips, friend gangs',
 'Family groups, college reunion trips, friend gangs',
 '"Holi escape 2-night" — bonfire, snacks platter, music corner, cleanup-friendly room setup.',
 '"Holi escape 2-night" — bonfire, snacks platter, music corner, cleanup-friendly room setup.',
 2, 15, 3, 30, '{}'::text[], 'HIGH',
 '[
   {"key":"holi_package_live","label_en":"Holi package live","label_hi":"Holi package live","link_target":"PACKAGE_BUILDER"},
   {"key":"cleaning_brief","label_en":"Cleaning team briefed on color/stain SOPs","label_hi":"Cleaning team ko color/stain SOPs brief karein"},
   {"key":"safety_messaging","label_en":"Safety messaging (no glass, no alcohol-and-color) shared","label_hi":"Safety messaging (no glass, no alcohol-and-color) share karein"},
   {"key":"music_partner","label_en":"Music/DJ partner booked","label_hi":"Music/DJ partner booked","link_target":null}
 ]'::jsonb,
 'PACKAGE_BUILDER', true,
 'Approximate window — Holi shifts each year per panchang (Feb 19 to Mar 22 across 2026-2030). Verify exact date.',
 'Approximate window hai — Holi har saal panchang ke hisaab se badalti hai (2026-2030 mein Feb 19 se Mar 22 tak). Exact date verify karein.',
 120),

-- 10. Long weekend — Independence Day (exact)
('LONGWKND_INDEPENDENCE', 'LONG_WEEKEND',
 'Independence Day Long Weekend',
 'Swatantra Diwas Weekend',
 'Mid-monsoon long weekend. Demand is real but weather-dependent.',
 'Mid-monsoon ka long weekend. Demand real hai par weather-dependent.',
 'Pair monsoon flexibility with patriotic packaging. Be ready for last-minute bookings.',
 'Monsoon flexibility + patriotic packaging combine karein. Last-minute bookings ke liye ready rahein.',
 'Family travellers, monsoon explorers',
 'Family travellers, monsoon explorers',
 '"Aug-15 monsoon escape" — flexible cancellation, indoor entertainment, tricolour welcome.',
 '"Aug-15 monsoon escape" — flexible cancellation, indoor entertainment, tricolour welcome.',
 8, 12, 8, 18, '{}'::text[], 'HIGH',
 '[
   {"key":"weekend_package_live","label_en":"Long-weekend package live","label_hi":"Long-weekend package live","link_target":"PACKAGE_BUILDER"},
   {"key":"flexible_cancellation_visible","label_en":"Flexible cancellation policy visible on listings","label_hi":"Flexible cancellation policy listings par visible"},
   {"key":"indoor_entertainment_ready","label_en":"Indoor entertainment options ready","label_hi":"Indoor entertainment options ready"},
   {"key":"road_status_protocol","label_en":"Front desk briefed on road status sharing","label_hi":"Front desk ko road status sharing brief karein"}
 ]'::jsonb,
 'PACKAGE_BUILDER', false,
 NULL, NULL, 130),

-- 11. Long weekend — Diwali (lunar, wide window)
('LONGWKND_DIWALI', 'LONG_WEEKEND',
 'Diwali Long Weekend',
 'Diwali Long Weekend',
 'Major holiday window. Family travel + corporate-bonus travel both spike.',
 'Bada holiday window. Family travel + corporate-bonus travel dono spike karte hain.',
 'Run premium family + corporate packages. Stock festive decor for shared spaces.',
 'Premium family + corporate packages chalayein. Shared spaces ke liye festive decor rakhein.',
 'Family groups, corporate bonus travellers, NRI returnees',
 'Family groups, corporate bonus travellers, NRI returnees',
 '"Diwali 3-night family escape" — diya-lighting evening, festive thali, bonfire, professional photographer slot.',
 '"Diwali 3-night family escape" — diya-lighting evening, festive thali, bonfire, professional photographer slot.',
 10, 15, 11, 15, '{}'::text[], 'HIGH',
 '[
   {"key":"diwali_package_live","label_en":"Diwali festive package live","label_hi":"Diwali festive package live","link_target":"PACKAGE_BUILDER"},
   {"key":"festive_decor_inventory","label_en":"Festive decor inventory + safety check","label_hi":"Festive decor inventory + safety check"},
   {"key":"festive_menu_confirmed","label_en":"Festive thali / sweet menu confirmed","label_hi":"Festive thali / sweet menu confirmed"},
   {"key":"fire_safety_briefing","label_en":"Fire safety briefing for diya/cracker zones","label_hi":"Fire safety briefing for diya/cracker zones"},
   {"key":"photographer_partner","label_en":"Photographer partner availability confirmed","label_hi":"Photographer partner availability confirmed","link_target":null}
 ]'::jsonb,
 'PACKAGE_BUILDER', true,
 'Approximate window — Diwali date shifts each year per panchang. Verify exact date.',
 'Approximate window hai — Diwali har saal panchang ke hisaab se badalti hai. Exact date verify karein.',
 100),

-- 12. Long weekend — Christmas / New Year (exact, cross-year)
('LONGWKND_CHRISTMAS', 'FAMILY_EVENT',
 'Christmas & New Year Window',
 'Christmas + New Year Window',
 'Year-end peak. Premium pricing, multi-night stays, advance bookings.',
 'Year-end peak. Premium pricing, multi-night stays, advance bookings.',
 'Lock premium pricing early. Plan NYE event. Block staff leaves.',
 'Premium pricing early lock karein. NYE event plan karein. Staff leaves block karein.',
 'Honeymoon couples, family groups, year-end travellers, NRIs',
 'Honeymoon couples, family groups, year-end travellers, NRIs',
 '"4-night NYE retreat" — bonfire, gala dinner, DJ night, mountain-view countdown.',
 '"4-night NYE retreat" — bonfire, gala dinner, DJ night, mountain-view countdown.',
 12, 22, 1, 2, '{}'::text[], 'HIGH',
 '[
   {"key":"nye_package_live","label_en":"NYE package live with premium pricing","label_hi":"NYE package premium pricing ke saath live","link_target":"PACKAGE_BUILDER"},
   {"key":"staff_leave_block","label_en":"Staff leave block + bonus communicated","label_hi":"Staff leave block + bonus communicated"},
   {"key":"gala_dinner_menu","label_en":"Gala dinner menu + DJ partner confirmed","label_hi":"Gala dinner menu + DJ partner confirmed"},
   {"key":"safety_alcohol_sop","label_en":"Alcohol-serve safety SOP refreshed","label_hi":"Alcohol-serve safety SOP refreshed"},
   {"key":"deposit_collection_policy","label_en":"Advance deposit collection policy on bookings","label_hi":"Bookings par advance deposit collection policy"}
 ]'::jsonb,
 'PACKAGE_BUILDER', false,
 NULL, NULL, 140),

-- 13. Wedding North season (cross-year)
('WEDDING_NORTH_SEASON', 'FAMILY_EVENT',
 'North India Wedding Season',
 'North India Shaadi Season',
 'Multi-room block bookings, group F&B, multi-day stays. Highest revenue-per-stay window.',
 'Multi-room block bookings, group F&B, multi-day stays. Highest revenue-per-stay window.',
 'Build wedding-block package. Train staff on event coordination. Confirm event-partner network.',
 'Wedding-block package banayein. Staff ko event coordination train karein. Event-partner network confirm karein.',
 'Wedding parties, baraat groups, destination wedding planners',
 'Wedding parties, baraat groups, destination wedding planners',
 '"15-room wedding block" — venue, decor, catering, baraat-arrival ceremony, photographer.',
 '"15-room wedding block" — venue, decor, catering, baraat-arrival ceremony, photographer.',
 11, 10, 3, 5, '{up,dl,hr,pb,rj}'::text[], 'MEDIUM',
 '[
   {"key":"wedding_package_live","label_en":"Wedding-block package live","label_hi":"Wedding-block package live","link_target":"PACKAGE_BUILDER"},
   {"key":"event_partner_network","label_en":"Event partner network (decor, catering) confirmed","label_hi":"Event partner network (decor, catering) confirmed","link_target":null},
   {"key":"staff_event_training","label_en":"Staff event-coordination training done","label_hi":"Staff event-coordination training done"},
   {"key":"venue_capacity_doc","label_en":"Venue capacity + permission documented","label_hi":"Venue capacity + permission documented"},
   {"key":"sample_quote_template","label_en":"Sample wedding quote template ready","label_hi":"Sample wedding quote template ready","link_target":null}
 ]'::jsonb,
 'PACKAGE_BUILDER', true,
 'Approximate window — wedding muhurats are panchang-driven and shift annually.',
 'Approximate window hai — wedding muhurats panchang ke hisaab se shift hote hain.',
 80),

-- 14. Workation peak (cross-year)
('WORKATION_PEAK', 'WELLNESS_WORKATION',
 'Workation Peak Window',
 'Workation Peak Window',
 'Remote-work travellers seeking long-stay discounts in hill stations. Stable revenue source for off-peak weeks.',
 'Remote-work travellers long-stay discounts dhundhte hain. Off-peak weeks ka stable revenue.',
 'Build 14+ night discount package. Verify WiFi reliability. Promote on remote-work communities.',
 '14+ raat discount package banayein. WiFi reliability verify karein. Remote-work communities par promote karein.',
 'Remote-work professionals, freelancers, digital nomads',
 'Remote-work professionals, freelancers, digital nomads',
 '"21-night workation" — discounted long stay, dedicated workspace, breakfast included, weekly housekeeping reset.',
 '"21-night workation" — discounted long stay, dedicated workspace, breakfast included, weekly housekeeping reset.',
 9, 25, 4, 5, '{uk,hp,jk,goa}'::text[], 'MEDIUM',
 '[
   {"key":"workation_package_live","label_en":"Workation long-stay package live","label_hi":"Workation long-stay package live","link_target":"PACKAGE_BUILDER"},
   {"key":"wifi_speed_audit","label_en":"WiFi speed audit done (3 rooms minimum)","label_hi":"WiFi speed audit done (3 rooms minimum)"},
   {"key":"workspace_room_inventory","label_en":"Workspace-ready room inventory listed","label_hi":"Workspace-ready room inventory listed"},
   {"key":"backup_power_check","label_en":"Backup power tested (long power cuts in hills)","label_hi":"Backup power tested (long power cuts in hills)"},
   {"key":"community_outreach","label_en":"Outreach to remote-work community channels","label_hi":"Remote-work community channels par outreach"}
 ]'::jsonb,
 'PACKAGE_BUILDER', true,
 'Approximate window — peak shifts with major Indian holiday calendars + winter onset.',
 'Approximate window hai — peak Indian holiday calendars + winter onset ke hisaab se shift hota hai.',
 160),

-- 15. School summer holiday
('SCHOOL_HOLIDAY_SUMMER', 'FAMILY_EVENT',
 'School Summer Holidays',
 'School Summer Chhutti',
 'Schools across India break. Family travel peak across hill stations.',
 'Pure India ke schools chhutti par. Family travel peak across hill stations.',
 'Family-pricing tiers. Kid-friendly amenities + safe activities. Coordinate with summer-camp partners.',
 'Family-pricing tiers. Kid-friendly amenities + safe activities. Summer-camp partners ke saath coordinate karein.',
 'Families with school-age kids, multi-generation groups, grandparent-led trips',
 'Families with school-age kids, multi-generation groups, grandparent-led trips',
 '"Family of 4 summer special" — kids stay-free under 12, kids activity, family-room option, evening hot chocolate.',
 '"Family of 4 summer special" — kids stay-free under 12, kids activity, family-room option, evening hot chocolate.',
 4, 25, 7, 5, '{}'::text[], 'HIGH',
 '[
   {"key":"family_pricing_tiers","label_en":"Family pricing tiers configured","label_hi":"Family pricing tiers configured","link_target":"PACKAGE_BUILDER"},
   {"key":"kids_safety_audit","label_en":"Kids safety audit (pool, balcony, electrical)","label_hi":"Kids safety audit (pool, balcony, electrical)"},
   {"key":"activity_partner_confirmed","label_en":"Summer-camp / activity partner confirmed","label_hi":"Summer-camp / activity partner confirmed","link_target":null},
   {"key":"family_photo_refresh","label_en":"Family-friendly photos refreshed","label_hi":"Family-friendly photos refreshed","link_target":"DAM"},
   {"key":"high_chair_kids_menu","label_en":"High chair + kids menu options ready","label_hi":"High chair + kids menu options ready"}
 ]'::jsonb,
 'PACKAGE_BUILDER', true,
 'Approximate window — varies ±2 weeks across CBSE, ICSE, and State boards.',
 'Approximate window hai — CBSE, ICSE, State boards ke hisaab se ±2 hafte vary karta hai.',
 90),

-- 16. Valentine's Week — stable exact dates, hospitality couples-segment marketing
--
-- DESIGN NOTE: this slot originally held EID_AL_FITR. Dropped during hostile
-- re-verification: Eid al-Fitr drifts ~11 days earlier per Gregorian year via
-- the lunar calendar (2026 Mar 21, 2027 Mar 10, 2028 Feb 26, 2029 Feb 14).
-- A single static window cannot absorb ~40 days of drift without producing a
-- meaninglessly-wide NOW state. Eid will return when per-year overrides ship.
('VALENTINES_WEEK', 'FAMILY_EVENT',
 'Valentine''s Week',
 'Valentine Week',
 'Couples + honeymoon travel spike. Common pre-booked window for premium romantic packages.',
 'Couples + honeymoon travel spike. Premium romantic packages ke liye common pre-booked window.',
 'Build a Valentine''s romantic package. Confirm decor, candlelight dinner, photo session.',
 'Valentine romantic package banayein. Decor, candlelight dinner, photo session confirm karein.',
 'Couples, honeymooners, anniversary travellers',
 'Couples, honeymooners, anniversary travellers',
 '"Valentine''s 2-night romance" — rose-petal turndown, candlelight dinner, in-room massage option, photo session.',
 '"Valentine 2-night romance" — rose-petal turndown, candlelight dinner, in-room massage option, photo session.',
 2, 7, 2, 14, '{}'::text[], 'MEDIUM',
 '[
   {"key":"valentine_package_live","label_en":"Valentine''s romantic package live","label_hi":"Valentine romantic package live","link_target":"PACKAGE_BUILDER"},
   {"key":"decor_inventory","label_en":"Rose petals + candles + decor inventory ready","label_hi":"Rose petals + candles + decor inventory ready"},
   {"key":"dinner_menu_confirmed","label_en":"Candlelight dinner menu + chef briefed","label_hi":"Candlelight dinner menu + chef briefed"},
   {"key":"photographer_partner","label_en":"Photographer partner availability confirmed","label_hi":"Photographer partner availability confirmed","link_target":null},
   {"key":"privacy_room_assignments","label_en":"Quiet/privacy room assignments pre-blocked","label_hi":"Quiet/privacy room assignments pre-blocked"}
 ]'::jsonb,
 'PACKAGE_BUILDER', false,
 NULL, NULL,
 150)

ON CONFLICT (code) DO NOTHING;

-- ─── Comments ───────────────────────────────────────────────────────────────

COMMENT ON TABLE public.seasonal_calendar_windows IS
  'Seasonal Demand Calendar (Position 8) catalog. System-defined; mutations only via migration. Each row is a recurring planning window with EN+Hi copy, region tagging, urgency-relevant date range, and a checklist seed. is_approximate=true rows have intentionally wide date windows so panchang/lunar drift never breaks the urgency math. CHECKLIST KEY SAFETY: never rename a key inside prep_checklist_seed — per-hotel ticked_keys[] reference these keys by string. Add new keys, soft-deprecate with is_active=false on the catalog row; do NOT mutate existing key strings.';

COMMENT ON TABLE public.hotel_seasonal_window_states IS
  'Per-hotel, per-season-year state for a seasonal window. UNIQUE(hotel_id, window_code, season_year). ticked_keys stores ONLY the keys; labels render live from catalog so seed updates roll forward without migration. review_status governance: PLANNING/READY/DISMISSED; permanent hide is a separate cross-year toggle.';

COMMENT ON TABLE public.hotel_seasonal_window_events IS
  'Append-only governance + activity audit for a hotel × window × season_year. Mirrors seo_landing_blueprint_events. Powers the inline timeline surface in the window card.';

COMMENT ON VIEW public.v_visible_seasonal_windows IS
  'Read-model: hotels × active catalog windows × current-season-year state. security_invoker — hotels RLS scopes the result. Computed: next_start_ts/next_end_ts, days_to_start, computed_urgency (override or deterministic), checklist progress, is_regional_match.';
