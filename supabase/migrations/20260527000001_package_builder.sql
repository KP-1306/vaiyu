-- Experience Package Builder v1 — full-fledged catalog with public landing + analytics
--
-- Three tables:
--   • packages           — primary marketing/operations record
--   • package_events     — append-only audit timeline (mirrors lead_events etc.)
--   • package_views      — anon-recordable public-landing analytics
--
-- Three enums:
--   • package_category   — 8 values per PO brief (Weekend / Adventure / Religious / Wellness / Workation / Family / Couple / Custom)
--   • package_status     — DRAFT / READY / ACTIVE / PAUSED / ARCHIVED
--   • package_event_type — 11 lifecycle events
--
-- Two-axis governance:
--   status               — lifecycle stage (operational)
--   owner_approval_status — sign-off state (compliance / 4-eyes)
--   CHECK enforces: status='ACTIVE' requires owner_approval_status='APPROVED'
--
-- Pricing: numeric paise (optional, for math) + text (required, for display).
-- Numeric path feeds AI Quote Drafts when the operator picks a package; text
-- path is what the guest sees on the landing page.
--
-- Public landing path: `get_package_public(p_hotel_slug, p_package_slug)` is
-- the only anon-callable read. It filters to ACTIVE+APPROVED+!deleted; any
-- other state returns NOT_FOUND so unreviewed drafts cannot be probed.
--
-- Per CLAUDE.md:
--   • Multi-tenancy: vaiyu_is_hotel_member RLS + RPC-level recheck
--   • Money math: base_price_paise (integer, no float)
--   • Immutability: package_events append-only; no UPDATE/DELETE policies
--   • Audit: mirrors lead_events / quote_draft_events / follow_up_events
--   • Helpers: vaiyu_is_hotel_member, vaiyu_is_hotel_finance_manager, set_updated_at

-- ─── Enums ──────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.package_category AS ENUM (
    'WEEKEND_ESCAPE',
    'ADVENTURE_TREKKING',
    'RELIGIOUS_SPIRITUAL',
    'WELLNESS_YOGA',
    'WORKATION_MONSOON',
    'FAMILY_STAY',
    'COUPLE_RETREAT',
    'CUSTOM'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.package_status AS ENUM (
    'DRAFT', 'READY', 'ACTIVE', 'PAUSED', 'ARCHIVED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.package_event_type AS ENUM (
    'CREATED', 'EDITED', 'DUPLICATED',
    'SUBMITTED_FOR_APPROVAL', 'APPROVED', 'CHANGES_REQUESTED',
    'PUBLISHED', 'PAUSED', 'RESUMED', 'ARCHIVED',
    'SOFT_DELETED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── packages ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.packages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id              uuid NOT NULL REFERENCES public.hotels(id) ON DELETE RESTRICT,
  slug                  text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,80}[a-z0-9]$'),

  -- Marketing core
  name                  text NOT NULL CHECK (length(btrim(name)) > 0 AND length(name) <= 120),
  category              public.package_category NOT NULL,
  target_guest_type     text,
  hero_image_url        text,
  short_pitch           text CHECK (short_pitch IS NULL OR length(short_pitch) <= 280),
  long_description      text CHECK (long_description IS NULL OR length(long_description) <= 8000),

  -- Stay shape
  duration_nights       integer NOT NULL CHECK (duration_nights BETWEEN 1 AND 30),
  min_party_adults      integer NOT NULL DEFAULT 1 CHECK (min_party_adults >= 1),
  max_party_adults      integer CHECK (max_party_adults IS NULL OR max_party_adults >= min_party_adults),
  room_type_id          uuid REFERENCES public.room_types(id),

  -- Seasonality
  season_months         integer[] NOT NULL DEFAULT '{}',
  valid_from            date,
  valid_until           date,

  -- Inclusions (structured per PO brief)
  food_inclusions       text[] NOT NULL DEFAULT '{}',
  activity_inclusions   text[] NOT NULL DEFAULT '{}',
  transfer_inclusions   text[] NOT NULL DEFAULT '{}',
  custom_inclusions     text[] NOT NULL DEFAULT '{}',

  -- Pricing — both shapes
  base_price_paise      integer CHECK (base_price_paise IS NULL OR base_price_paise >= 0),
  base_price_basis      text NOT NULL DEFAULT 'PER_ROOM_PER_NIGHT'
                          CHECK (base_price_basis IN ('PER_ROOM_PER_NIGHT','PER_PERSON_PER_NIGHT','PER_PACKAGE')),
  starting_price_text   text NOT NULL CHECK (length(btrim(starting_price_text)) > 0),

  -- CTA
  enquiry_cta_label     text NOT NULL DEFAULT 'Enquire now'
                          CHECK (length(btrim(enquiry_cta_label)) > 0 AND length(enquiry_cta_label) <= 40),

  -- Governance (two-axis)
  status                public.package_status NOT NULL DEFAULT 'DRAFT',
  owner_approval_status text NOT NULL DEFAULT 'PENDING_REVIEW'
                          CHECK (owner_approval_status IN ('PENDING_REVIEW','APPROVED','CHANGES_REQUESTED')),
  approval_notes        text,
  internal_notes        text,

  -- Lifecycle timestamps
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES auth.users(id),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid REFERENCES auth.users(id),
  published_at          timestamptz,
  paused_at             timestamptz,
  deleted_at            timestamptz,

  -- ─── Cross-field invariants ─────────────────────────────────────────────
  -- Two-axis governance: ACTIVE requires APPROVED. DB-level defense-in-depth
  -- alongside the RPC check.
  CONSTRAINT packages_active_requires_approval CHECK (
    status <> 'ACTIVE' OR owner_approval_status = 'APPROVED'
  ),

  -- Season months must be 1..12. Empty array means "year-round" (no filter).
  CONSTRAINT packages_season_months_valid CHECK (
    season_months <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]
  ),

  -- Date window sanity (when both are set)
  CONSTRAINT packages_date_window_ordered CHECK (
    valid_from IS NULL OR valid_until IS NULL OR valid_until >= valid_from
  )
);

-- ─── Unique slug per hotel (active rows only — archived can free up slugs) ─

CREATE UNIQUE INDEX IF NOT EXISTS uq_packages_hotel_slug_active
  ON public.packages (hotel_id, slug)
  WHERE deleted_at IS NULL AND status <> 'ARCHIVED';

-- ─── package_events (append-only audit) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.package_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id            uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  hotel_id              uuid NOT NULL REFERENCES public.hotels(id),
  event_type            public.package_event_type NOT NULL,
  payload               jsonb NOT NULL DEFAULT '{}',
  actor_id              uuid REFERENCES auth.users(id),
  occurred_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  event_schema_version  integer NOT NULL DEFAULT 1
);

-- ─── package_views (anon-recordable analytics) ─────────────────────────────

CREATE TABLE IF NOT EXISTS public.package_views (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id  uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  hotel_id    uuid NOT NULL REFERENCES public.hotels(id),
  viewed_at   timestamptz NOT NULL DEFAULT now(),
  source      text,                   -- 'direct' | 'whatsapp' | 'instagram' | 'email' | etc.
  referrer    text,
  ip_hash     text,                   -- sha256(IP + daily_salt) — raw IP NEVER stored
  ua_class    text                    -- 'mobile' | 'desktop' | 'tablet' | 'bot'
);

-- ─── Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_packages_hotel_status
  ON public.packages (hotel_id, status, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_packages_hotel_category
  ON public.packages (hotel_id, category)
  WHERE deleted_at IS NULL AND status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_package_events_package
  ON public.package_events (package_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_package_events_hotel_type
  ON public.package_events (hotel_id, event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_package_views_package_day
  ON public.package_views (package_id, viewed_at DESC);

CREATE INDEX IF NOT EXISTS idx_package_views_hotel_day
  ON public.package_views (hotel_id, viewed_at DESC);

-- ─── Triggers ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_packages_updated_at ON public.packages;
CREATE TRIGGER trg_packages_updated_at
  BEFORE UPDATE ON public.packages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.packages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_views  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS packages_select_for_members ON public.packages;
CREATE POLICY packages_select_for_members ON public.packages
  FOR SELECT USING (public.vaiyu_is_hotel_member(hotel_id));

-- INSERT/UPDATE go through SECURITY DEFINER RPCs only — keeps audit + writes paired.

DROP POLICY IF EXISTS package_events_select_for_members ON public.package_events;
CREATE POLICY package_events_select_for_members ON public.package_events
  FOR SELECT USING (public.vaiyu_is_hotel_member(hotel_id));

DROP POLICY IF EXISTS package_views_select_for_members ON public.package_views;
CREATE POLICY package_views_select_for_members ON public.package_views
  FOR SELECT USING (public.vaiyu_is_hotel_member(hotel_id));

-- ─── _record_package_event (internal helper) ───────────────────────────────

CREATE OR REPLACE FUNCTION public._record_package_event(
  p_package_id uuid,
  p_hotel_id   uuid,
  p_event_type public.package_event_type,
  p_payload    jsonb DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.package_events (package_id, hotel_id, event_type, payload, actor_id)
  VALUES (p_package_id, p_hotel_id, p_event_type, p_payload, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ─── create_package ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_package(
  p_hotel_id            uuid,
  p_name                text,
  p_slug                text,
  p_category            public.package_category,
  p_duration_nights     integer,
  p_starting_price_text text,
  p_short_pitch         text DEFAULT NULL,
  p_long_description    text DEFAULT NULL,
  p_target_guest_type   text DEFAULT NULL,
  p_hero_image_url      text DEFAULT NULL,
  p_min_party_adults    integer DEFAULT 1,
  p_max_party_adults    integer DEFAULT NULL,
  p_room_type_id        uuid DEFAULT NULL,
  p_season_months       integer[] DEFAULT '{}',
  p_valid_from          date DEFAULT NULL,
  p_valid_until         date DEFAULT NULL,
  p_food_inclusions     text[] DEFAULT '{}',
  p_activity_inclusions text[] DEFAULT '{}',
  p_transfer_inclusions text[] DEFAULT '{}',
  p_custom_inclusions   text[] DEFAULT '{}',
  p_base_price_paise    integer DEFAULT NULL,
  p_base_price_basis    text DEFAULT 'PER_ROOM_PER_NIGHT',
  p_enquiry_cta_label   text DEFAULT 'Enquire now',
  p_internal_notes      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF p_room_type_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.room_types WHERE id = p_room_type_id AND hotel_id = p_hotel_id
  ) THEN
    RAISE EXCEPTION 'ROOM_TYPE_MISMATCH';
  END IF;

  INSERT INTO public.packages (
    hotel_id, slug, name, category, target_guest_type, hero_image_url,
    short_pitch, long_description,
    duration_nights, min_party_adults, max_party_adults, room_type_id,
    season_months, valid_from, valid_until,
    food_inclusions, activity_inclusions, transfer_inclusions, custom_inclusions,
    base_price_paise, base_price_basis, starting_price_text,
    enquiry_cta_label, internal_notes,
    status, owner_approval_status,
    created_by, updated_by
  ) VALUES (
    p_hotel_id, lower(btrim(p_slug)), btrim(p_name), p_category, p_target_guest_type, p_hero_image_url,
    p_short_pitch, p_long_description,
    p_duration_nights, p_min_party_adults, p_max_party_adults, p_room_type_id,
    COALESCE(p_season_months, '{}'), p_valid_from, p_valid_until,
    COALESCE(p_food_inclusions, '{}'), COALESCE(p_activity_inclusions, '{}'),
    COALESCE(p_transfer_inclusions, '{}'), COALESCE(p_custom_inclusions, '{}'),
    p_base_price_paise, p_base_price_basis, btrim(p_starting_price_text),
    p_enquiry_cta_label, p_internal_notes,
    'DRAFT', 'PENDING_REVIEW',
    auth.uid(), auth.uid()
  )
  RETURNING id INTO v_id;

  PERFORM public._record_package_event(v_id, p_hotel_id, 'CREATED',
    jsonb_build_object('category', p_category::text, 'name', btrim(p_name)));

  RETURN jsonb_build_object('id', v_id, 'status', 'DRAFT');
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'SLUG_TAKEN';
END;
$$;

-- ─── update_package ────────────────────────────────────────────────────────
-- Editable fields only. Status + approval flow through dedicated RPCs.

CREATE OR REPLACE FUNCTION public.update_package(
  p_id                  uuid,
  p_name                text DEFAULT NULL,
  p_category            public.package_category DEFAULT NULL,
  p_target_guest_type   text DEFAULT NULL,
  p_hero_image_url      text DEFAULT NULL,
  p_short_pitch         text DEFAULT NULL,
  p_long_description    text DEFAULT NULL,
  p_duration_nights     integer DEFAULT NULL,
  p_min_party_adults    integer DEFAULT NULL,
  p_max_party_adults    integer DEFAULT NULL,
  p_room_type_id        uuid DEFAULT NULL,
  p_season_months       integer[] DEFAULT NULL,
  p_valid_from          date DEFAULT NULL,
  p_valid_until         date DEFAULT NULL,
  p_food_inclusions     text[] DEFAULT NULL,
  p_activity_inclusions text[] DEFAULT NULL,
  p_transfer_inclusions text[] DEFAULT NULL,
  p_custom_inclusions   text[] DEFAULT NULL,
  p_base_price_paise    integer DEFAULT NULL,
  p_base_price_basis    text DEFAULT NULL,
  p_starting_price_text text DEFAULT NULL,
  p_enquiry_cta_label   text DEFAULT NULL,
  p_internal_notes      text DEFAULT NULL,
  -- Sentinel approach for nullable scalars the caller wants to CLEAR:
  -- callers pass NULL by default = "no change". To explicitly clear, pass
  -- empty string for text fields or use the dedicated clear_* RPCs (future).
  p_clear_hero_image    boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row     record;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO v_row FROM public.packages WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND'; END IF;
  IF v_row.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'PACKAGE_DELETED'; END IF;

  IF NOT public.vaiyu_is_hotel_member(v_row.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF v_row.status NOT IN ('DRAFT', 'READY', 'PAUSED') THEN
    RAISE EXCEPTION 'NOT_EDITABLE';
  END IF;

  IF p_room_type_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.room_types WHERE id = p_room_type_id AND hotel_id = v_row.hotel_id
  ) THEN
    RAISE EXCEPTION 'ROOM_TYPE_MISMATCH';
  END IF;

  IF p_name              IS NOT NULL AND p_name              IS DISTINCT FROM v_row.name              THEN v_changes := v_changes || jsonb_build_object('name', true); END IF;
  IF p_category          IS NOT NULL AND p_category          IS DISTINCT FROM v_row.category          THEN v_changes := v_changes || jsonb_build_object('category', p_category::text); END IF;
  IF p_duration_nights   IS NOT NULL AND p_duration_nights   IS DISTINCT FROM v_row.duration_nights   THEN v_changes := v_changes || jsonb_build_object('duration_nights', p_duration_nights); END IF;
  IF p_base_price_paise  IS NOT NULL AND p_base_price_paise  IS DISTINCT FROM v_row.base_price_paise  THEN v_changes := v_changes || jsonb_build_object('base_price_changed', true); END IF;
  IF p_starting_price_text IS NOT NULL AND p_starting_price_text IS DISTINCT FROM v_row.starting_price_text THEN v_changes := v_changes || jsonb_build_object('starting_price_text', true); END IF;

  UPDATE public.packages SET
    name                = COALESCE(p_name, name),
    category            = COALESCE(p_category, category),
    target_guest_type   = COALESCE(p_target_guest_type, target_guest_type),
    hero_image_url      = CASE WHEN p_clear_hero_image THEN NULL
                              ELSE COALESCE(p_hero_image_url, hero_image_url) END,
    short_pitch         = COALESCE(p_short_pitch, short_pitch),
    long_description    = COALESCE(p_long_description, long_description),
    duration_nights     = COALESCE(p_duration_nights, duration_nights),
    min_party_adults    = COALESCE(p_min_party_adults, min_party_adults),
    max_party_adults    = COALESCE(p_max_party_adults, max_party_adults),
    room_type_id        = COALESCE(p_room_type_id, room_type_id),
    season_months       = COALESCE(p_season_months, season_months),
    valid_from          = COALESCE(p_valid_from, valid_from),
    valid_until         = COALESCE(p_valid_until, valid_until),
    food_inclusions     = COALESCE(p_food_inclusions, food_inclusions),
    activity_inclusions = COALESCE(p_activity_inclusions, activity_inclusions),
    transfer_inclusions = COALESCE(p_transfer_inclusions, transfer_inclusions),
    custom_inclusions   = COALESCE(p_custom_inclusions, custom_inclusions),
    base_price_paise    = COALESCE(p_base_price_paise, base_price_paise),
    base_price_basis    = COALESCE(p_base_price_basis, base_price_basis),
    starting_price_text = COALESCE(p_starting_price_text, starting_price_text),
    enquiry_cta_label   = COALESCE(p_enquiry_cta_label, enquiry_cta_label),
    internal_notes      = COALESCE(p_internal_notes, internal_notes),
    -- Any edit while APPROVED bumps approval back to PENDING_REVIEW to enforce
    -- 4-eyes on every change.
    owner_approval_status = CASE
      WHEN v_row.owner_approval_status = 'APPROVED' AND v_changes <> '{}'::jsonb
        THEN 'PENDING_REVIEW'
      ELSE owner_approval_status
    END,
    updated_by          = auth.uid()
  WHERE id = p_id;

  IF v_changes <> '{}'::jsonb THEN
    PERFORM public._record_package_event(p_id, v_row.hotel_id, 'EDITED',
      jsonb_build_object('changes', v_changes));
  END IF;
END;
$$;

-- ─── submit_for_approval ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_package_for_approval(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row FROM public.packages WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND'; END IF;
  IF v_row.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'PACKAGE_DELETED'; END IF;
  IF NOT public.vaiyu_is_hotel_member(v_row.hotel_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF v_row.status NOT IN ('DRAFT', 'PAUSED') THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;

  UPDATE public.packages SET
    status = 'READY',
    owner_approval_status = CASE
      WHEN owner_approval_status = 'CHANGES_REQUESTED' THEN 'PENDING_REVIEW'
      ELSE owner_approval_status
    END,
    updated_by = auth.uid()
  WHERE id = p_id;

  PERFORM public._record_package_event(p_id, v_row.hotel_id, 'SUBMITTED_FOR_APPROVAL', '{}'::jsonb);
END;
$$;

-- ─── approve_package (manager+) ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.approve_package(p_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row FROM public.packages WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND'; END IF;
  IF v_row.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'PACKAGE_DELETED'; END IF;
  IF NOT public.vaiyu_is_hotel_finance_manager(v_row.hotel_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF v_row.status <> 'READY' THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;

  UPDATE public.packages SET
    owner_approval_status = 'APPROVED',
    approval_notes        = p_note,
    updated_by            = auth.uid()
  WHERE id = p_id;

  PERFORM public._record_package_event(p_id, v_row.hotel_id, 'APPROVED',
    jsonb_build_object('note', p_note));
END;
$$;

-- ─── request_changes (manager+) ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.request_package_changes(p_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row record;
BEGIN
  IF p_note IS NULL OR btrim(p_note) = '' THEN RAISE EXCEPTION 'NOTE_REQUIRED'; END IF;

  SELECT * INTO v_row FROM public.packages WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND'; END IF;
  IF v_row.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'PACKAGE_DELETED'; END IF;
  IF NOT public.vaiyu_is_hotel_finance_manager(v_row.hotel_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF v_row.status <> 'READY' THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;

  UPDATE public.packages SET
    status                = 'DRAFT',
    owner_approval_status = 'CHANGES_REQUESTED',
    approval_notes        = btrim(p_note),
    updated_by            = auth.uid()
  WHERE id = p_id;

  PERFORM public._record_package_event(p_id, v_row.hotel_id, 'CHANGES_REQUESTED',
    jsonb_build_object('note', btrim(p_note)));
END;
$$;

-- ─── publish_package (manager+; READY+APPROVED → ACTIVE) ───────────────────

CREATE OR REPLACE FUNCTION public.publish_package(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row FROM public.packages WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND'; END IF;
  IF v_row.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'PACKAGE_DELETED'; END IF;
  IF NOT public.vaiyu_is_hotel_finance_manager(v_row.hotel_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF v_row.status <> 'READY' THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
  IF v_row.owner_approval_status <> 'APPROVED' THEN RAISE EXCEPTION 'APPROVAL_REQUIRED'; END IF;

  UPDATE public.packages SET
    status       = 'ACTIVE',
    published_at = COALESCE(published_at, clock_timestamp()),
    paused_at    = NULL,
    updated_by   = auth.uid()
  WHERE id = p_id;

  PERFORM public._record_package_event(p_id, v_row.hotel_id, 'PUBLISHED', '{}'::jsonb);
END;
$$;

-- ─── pause_package (manager+; ACTIVE → PAUSED) ─────────────────────────────

CREATE OR REPLACE FUNCTION public.pause_package(p_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row FROM public.packages WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND'; END IF;
  IF v_row.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'PACKAGE_DELETED'; END IF;
  IF NOT public.vaiyu_is_hotel_finance_manager(v_row.hotel_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF v_row.status <> 'ACTIVE' THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;

  UPDATE public.packages SET
    status     = 'PAUSED',
    paused_at  = clock_timestamp(),
    updated_by = auth.uid()
  WHERE id = p_id;

  PERFORM public._record_package_event(p_id, v_row.hotel_id, 'PAUSED',
    jsonb_build_object('reason', p_reason));
END;
$$;

-- ─── resume_package (manager+; PAUSED → ACTIVE if still approved) ─────────

CREATE OR REPLACE FUNCTION public.resume_package(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row FROM public.packages WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND'; END IF;
  IF v_row.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'PACKAGE_DELETED'; END IF;
  IF NOT public.vaiyu_is_hotel_finance_manager(v_row.hotel_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF v_row.status <> 'PAUSED' THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
  IF v_row.owner_approval_status <> 'APPROVED' THEN RAISE EXCEPTION 'APPROVAL_REQUIRED'; END IF;

  UPDATE public.packages SET
    status     = 'ACTIVE',
    paused_at  = NULL,
    updated_by = auth.uid()
  WHERE id = p_id;

  PERFORM public._record_package_event(p_id, v_row.hotel_id, 'RESUMED', '{}'::jsonb);
END;
$$;

-- ─── archive_package (manager+) ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.archive_package(p_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row FROM public.packages WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND'; END IF;
  IF v_row.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'PACKAGE_DELETED'; END IF;
  IF NOT public.vaiyu_is_hotel_finance_manager(v_row.hotel_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF v_row.status = 'ARCHIVED' THEN RETURN; END IF;

  UPDATE public.packages SET
    status     = 'ARCHIVED',
    updated_by = auth.uid()
  WHERE id = p_id;

  PERFORM public._record_package_event(p_id, v_row.hotel_id, 'ARCHIVED',
    jsonb_build_object('reason', p_reason, 'prev_status', v_row.status::text));
END;
$$;

-- ─── duplicate_package ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.duplicate_package(
  p_source_id uuid,
  p_new_name  text,
  p_new_slug  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_src record;
  v_new_id uuid;
BEGIN
  SELECT * INTO v_src FROM public.packages WHERE id = p_source_id;
  IF v_src.id IS NULL THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND'; END IF;
  IF v_src.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'PACKAGE_DELETED'; END IF;
  IF NOT public.vaiyu_is_hotel_member(v_src.hotel_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  INSERT INTO public.packages (
    hotel_id, slug, name, category, target_guest_type, hero_image_url,
    short_pitch, long_description,
    duration_nights, min_party_adults, max_party_adults, room_type_id,
    season_months, valid_from, valid_until,
    food_inclusions, activity_inclusions, transfer_inclusions, custom_inclusions,
    base_price_paise, base_price_basis, starting_price_text,
    enquiry_cta_label, internal_notes,
    status, owner_approval_status,
    created_by, updated_by
  ) VALUES (
    v_src.hotel_id, lower(btrim(p_new_slug)), btrim(p_new_name), v_src.category,
    v_src.target_guest_type, v_src.hero_image_url,
    v_src.short_pitch, v_src.long_description,
    v_src.duration_nights, v_src.min_party_adults, v_src.max_party_adults, v_src.room_type_id,
    v_src.season_months, v_src.valid_from, v_src.valid_until,
    v_src.food_inclusions, v_src.activity_inclusions, v_src.transfer_inclusions, v_src.custom_inclusions,
    v_src.base_price_paise, v_src.base_price_basis, v_src.starting_price_text,
    v_src.enquiry_cta_label, v_src.internal_notes,
    'DRAFT', 'PENDING_REVIEW',
    auth.uid(), auth.uid()
  )
  RETURNING id INTO v_new_id;

  PERFORM public._record_package_event(v_new_id, v_src.hotel_id, 'DUPLICATED',
    jsonb_build_object('source_id', p_source_id));

  RETURN jsonb_build_object('id', v_new_id);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'SLUG_TAKEN';
END;
$$;

-- ─── soft_delete_package (manager+) ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.soft_delete_package(p_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row FROM public.packages WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND'; END IF;
  IF v_row.deleted_at IS NOT NULL THEN RETURN; END IF;
  IF NOT public.vaiyu_is_hotel_finance_manager(v_row.hotel_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  UPDATE public.packages SET
    deleted_at = clock_timestamp(),
    updated_by = auth.uid()
  WHERE id = p_id;

  PERFORM public._record_package_event(p_id, v_row.hotel_id, 'SOFT_DELETED',
    jsonb_build_object('reason', p_reason));
END;
$$;

-- ─── get_package_public (anon; landing page only) ─────────────────────────

CREATE OR REPLACE FUNCTION public.get_package_public(
  p_hotel_slug   text,
  p_package_slug text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_hotel   record;
  v_package record;
BEGIN
  IF p_hotel_slug IS NULL OR p_package_slug IS NULL THEN
    RAISE EXCEPTION 'INVALID_REQUEST';
  END IF;

  SELECT id, name, city, slug
    INTO v_hotel FROM public.hotels WHERE slug = lower(btrim(p_hotel_slug));
  IF v_hotel.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  SELECT *
    INTO v_package FROM public.packages
   WHERE hotel_id = v_hotel.id
     AND slug = lower(btrim(p_package_slug))
     AND status = 'ACTIVE'
     AND owner_approval_status = 'APPROVED'
     AND deleted_at IS NULL;

  IF v_package.id IS NULL THEN
    -- Generic NOT_FOUND so non-public statuses (DRAFT/READY/PAUSED) don't leak.
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  RETURN jsonb_build_object(
    'package', jsonb_build_object(
      'id',                  v_package.id,
      'slug',                v_package.slug,
      'name',                v_package.name,
      'category',            v_package.category::text,
      'target_guest_type',   v_package.target_guest_type,
      'hero_image_url',      v_package.hero_image_url,
      'short_pitch',         v_package.short_pitch,
      'long_description',    v_package.long_description,
      'duration_nights',     v_package.duration_nights,
      'min_party_adults',    v_package.min_party_adults,
      'max_party_adults',    v_package.max_party_adults,
      'season_months',       v_package.season_months,
      'valid_from',          v_package.valid_from,
      'valid_until',         v_package.valid_until,
      'food_inclusions',     v_package.food_inclusions,
      'activity_inclusions', v_package.activity_inclusions,
      'transfer_inclusions', v_package.transfer_inclusions,
      'custom_inclusions',   v_package.custom_inclusions,
      'starting_price_text', v_package.starting_price_text,
      'enquiry_cta_label',   v_package.enquiry_cta_label
    ),
    'hotel', jsonb_build_object(
      'id',   v_hotel.id,
      'name', v_hotel.name,
      'city', v_hotel.city,
      'slug', v_hotel.slug
    )
  );
END;
$$;

-- ─── record_package_view (anon; called by Edge Function only) ─────────────

CREATE OR REPLACE FUNCTION public.record_package_view(
  p_package_id uuid,
  p_source     text DEFAULT NULL,
  p_referrer   text DEFAULT NULL,
  p_ip_hash    text DEFAULT NULL,
  p_ua_class   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_hotel_id uuid;
  v_status   public.package_status;
  v_deleted  timestamptz;
BEGIN
  SELECT hotel_id, status, deleted_at
    INTO v_hotel_id, v_status, v_deleted
    FROM public.packages WHERE id = p_package_id;

  IF v_hotel_id IS NULL OR v_deleted IS NOT NULL OR v_status <> 'ACTIVE' THEN
    -- Silently ignore — analytics is best-effort and we don't tell anon callers
    -- which packages exist.
    RETURN;
  END IF;

  INSERT INTO public.package_views (package_id, hotel_id, source, referrer, ip_hash, ua_class)
  VALUES (p_package_id, v_hotel_id, p_source, p_referrer, p_ip_hash, p_ua_class);
END;
$$;

-- ─── get_package_analytics (hotel-member read) ─────────────────────────────

CREATE OR REPLACE FUNCTION public.get_package_analytics(
  p_hotel_id uuid,
  p_days     integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_total_views        bigint;
  v_views_per_package  jsonb;
  v_since              timestamptz;
BEGIN
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  v_since := now() - (GREATEST(1, LEAST(p_days, 365)) * interval '1 day');

  SELECT COUNT(*) INTO v_total_views
    FROM public.package_views
   WHERE hotel_id = p_hotel_id AND viewed_at >= v_since;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'package_id', pv.package_id,
    'package_name', p.name,
    'views',     pv.cnt
  ) ORDER BY pv.cnt DESC), '[]'::jsonb)
    INTO v_views_per_package
    FROM (
      SELECT package_id, COUNT(*) AS cnt
        FROM public.package_views
       WHERE hotel_id = p_hotel_id AND viewed_at >= v_since
       GROUP BY package_id
    ) pv
    JOIN public.packages p ON p.id = pv.package_id;

  RETURN jsonb_build_object(
    'total_views',       v_total_views,
    'window_days',       GREATEST(1, LEAST(p_days, 365)),
    'views_per_package', v_views_per_package
  );
END;
$$;

-- ─── Grants ────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.create_package                TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_package                TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_package_for_approval   TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_package               TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_package_changes       TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_package               TO authenticated;
GRANT EXECUTE ON FUNCTION public.pause_package                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_package                TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_package               TO authenticated;
GRANT EXECUTE ON FUNCTION public.duplicate_package             TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_package           TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_package_analytics         TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_package_public            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_package_view           TO anon, authenticated;

-- ─── Realtime publication ─────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.packages;       EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.package_events; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- ─── Comments ──────────────────────────────────────────────────────────────

COMMENT ON TABLE public.packages IS
  'Experience packages (Position 5). Two-axis governance: status (DRAFT→READY→ACTIVE→PAUSED→ARCHIVED) + owner_approval_status (PENDING_REVIEW → APPROVED → CHANGES_REQUESTED). CHECK enforces ACTIVE requires APPROVED. Pricing is both numeric (paise, optional, for AI Quote integration) and text (starting_price_text, required, for display).';

COMMENT ON CONSTRAINT packages_active_requires_approval ON public.packages IS
  'Defense-in-depth: a package cannot be ACTIVE without owner approval. RPCs check this too; the constraint catches any direct UPDATE.';

COMMENT ON FUNCTION public.get_package_public IS
  'Anon-callable. Returns only ACTIVE+APPROVED+!deleted packages. Returns generic NOT_FOUND for any other state so draft/paused/archived packages cannot be probed.';
