-- Local SEO Landing Planner v0 — Growth Hub Position 7
--
-- INTERNAL content-planning, governance & readiness workspace.
-- This is NOT a public-page publisher, NOT an SEO auto-generator, NOT a
-- doorway-page generator. It stores *blueprints* (page ideas) and runs a
-- deterministic Policy Shield that flags which ideas are safe vs. spammy/fake
-- before any human ever builds a real page. Nothing here publishes anything.
--
-- Two tables:
--   • seo_landing_blueprints        — per-hotel blueprint records
--   • seo_landing_blueprint_events  — append-only audit timeline (mirrors package_events)
--
-- Three enums:
--   • seo_blueprint_category   — 6 content-blueprint categories (per PO spec)
--   • seo_blueprint_risk       — 6 deterministic risk classifications
--   • seo_blueprint_status     — DRAFT / IN_REVIEW / READY_TO_BUILD / ON_HOLD / ARCHIVED
--   • seo_blueprint_event_type — lifecycle audit events
--
-- Two-axis governance (mirrors Package Builder):
--   status         — planning lifecycle stage
--   review_status  — sign-off (PENDING_REVIEW / APPROVED / CHANGES_REQUESTED)
--   CHECK enforces: status='READY_TO_BUILD' requires review_status='APPROVED'
--
-- Policy Shield: _classify_seo_blueprint() is the authoritative deterministic
-- classifier (no AI). The frontend mirrors it for instant feedback, but the
-- server value always wins. Owners may override the flag only with a reason
-- (governance-logged) — humans, not the system, assert FAKE_LOCAL_CLAIM/ON_HOLD.
--
-- Per CLAUDE.md:
--   • Multi-tenancy: vaiyu_is_hotel_member RLS + RPC-level recheck; manager+ for sign-off
--   • Writes via SECURITY DEFINER RPCs only — keeps audit + writes paired
--   • Audit: append-only events, clock_timestamp() ordering
--   • Helpers: vaiyu_is_hotel_member, vaiyu_is_hotel_finance_manager, set_updated_at
--   • No public/anon grants — internal planning only

-- ─── Enums ──────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.seo_blueprint_category AS ENUM (
    'GEOGRAPHIC_FOCUS',
    'TRAVELER_NICHE',
    'SEASONAL_POSITION',
    'TARGET_MARKET',
    'AMENITY_TRUST',
    'PACKAGE_LED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.seo_blueprint_risk AS ENUM (
    'SAFE_BLUEPRINT',
    'NEEDS_PROOF',
    'RISKY_DOORWAY',
    'FAKE_LOCAL_CLAIM',
    'DUPLICATE_LOW_VALUE',
    'ON_HOLD'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.seo_blueprint_status AS ENUM (
    'DRAFT', 'IN_REVIEW', 'READY_TO_BUILD', 'ON_HOLD', 'ARCHIVED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.seo_blueprint_event_type AS ENUM (
    'CREATED', 'EDITED', 'RECLASSIFIED',
    'SUBMITTED_FOR_REVIEW', 'APPROVED', 'CHANGES_REQUESTED',
    'HELD', 'RESUMED', 'ARCHIVED', 'SOFT_DELETED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Immutable title normaliser (duplicate-low-value guard) ─────────────────

CREATE OR REPLACE FUNCTION public._seo_normalize_title(p_title text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT btrim(regexp_replace(
           regexp_replace(lower(btrim(coalesce(p_title, ''))), '[^a-z0-9]+', ' ', 'g'),
           '\s+', ' ', 'g'));
$$;

-- ─── Deterministic Policy-Shield classifier (authoritative; no AI) ──────────
-- Pure function of its inputs (IMMUTABLE). The frontend mirrors this exactly
-- for instant UX; the server value is authoritative on write.

CREATE OR REPLACE FUNCTION public._classify_seo_blueprint(
  p_title       text,
  p_category    public.seo_blueprint_category,
  p_proof       jsonb,
  p_is_duplicate boolean
)
RETURNS public.seo_blueprint_risk
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_all_proof  boolean;
  v_proof_len  integer;
  v_needs      boolean;
BEGIN
  v_proof_len := jsonb_array_length(COALESCE(p_proof, '[]'::jsonb));
  v_all_proof := NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_proof, '[]'::jsonb)) e
    WHERE COALESCE((e->>'satisfied')::boolean, false) = false
  );
  -- Categories that assert something verifiable about the property/location
  -- always require concrete proof before they can be 'safe'.
  v_needs := p_category IN ('GEOGRAPHIC_FOCUS', 'AMENITY_TRUST', 'TARGET_MARKET');

  IF p_is_duplicate THEN
    RETURN 'DUPLICATE_LOW_VALUE';
  END IF;

  -- Superlative / unprovable-overclaim language → doorway/spam risk.
  -- "#1 ..." is checked separately because POSIX `\m` doesn't anchor against
  -- `#` (a non-word char), so a single combined `\m(...)\M` regex would miss
  -- the most common spam pattern.
  IF lower(coalesce(p_title, '')) ~
     '\m(best|cheapest|cheap|top|number\s*one|no\.?\s*1|lowest|guaranteed|world\s*class|5\s*star|five\s*star)\M'
     OR lower(coalesce(p_title, '')) ~ '#\s*1\M'
  THEN
    RETURN 'RISKY_DOORWAY';
  END IF;

  IF v_needs AND (v_proof_len = 0 OR NOT v_all_proof) THEN
    RETURN 'NEEDS_PROOF';
  END IF;

  IF v_proof_len > 0 AND NOT v_all_proof THEN
    RETURN 'NEEDS_PROOF';
  END IF;

  RETURN 'SAFE_BLUEPRINT';
END;
$$;

-- ─── seo_landing_blueprints ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.seo_landing_blueprints (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id                    uuid NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,

  page_title_concept          text NOT NULL
                                CHECK (length(btrim(page_title_concept)) > 0 AND length(page_title_concept) <= 160),
  target_category             public.seo_blueprint_category NOT NULL,
  risk_classification         public.seo_blueprint_risk NOT NULL DEFAULT 'NEEDS_PROOF',

  -- Governance (two-axis)
  status                      public.seo_blueprint_status NOT NULL DEFAULT 'DRAFT',
  review_status               text NOT NULL DEFAULT 'PENDING_REVIEW'
                                CHECK (review_status IN ('PENDING_REVIEW', 'APPROVED', 'CHANGES_REQUESTED')),

  -- Proof checklist: [{ key, label_en, label_hi, satisfied }]
  required_proof              jsonb NOT NULL DEFAULT '[]'::jsonb
                                CHECK (jsonb_typeof(required_proof) = 'array'),

  -- Guidance / notes
  why_it_matters              text CHECK (why_it_matters IS NULL OR length(why_it_matters) <= 2000),
  hinglish_guidance           text CHECK (hinglish_guidance IS NULL OR length(hinglish_guidance) <= 2000),
  safe_next_action            text CHECK (safe_next_action IS NULL OR length(safe_next_action) <= 1000),
  connected_module_suggestion text CHECK (connected_module_suggestion IS NULL OR length(connected_module_suggestion) <= 60),
  owner_notes                 text CHECK (owner_notes IS NULL OR length(owner_notes) <= 4000),
  internal_notes              text CHECK (internal_notes IS NULL OR length(internal_notes) <= 4000),

  -- Review trail
  review_notes                text CHECK (review_notes IS NULL OR length(review_notes) <= 2000),
  review_actor_id             uuid REFERENCES auth.users(id),
  reviewed_at                 timestamptz,

  -- Lifecycle timestamps
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid REFERENCES auth.users(id),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid REFERENCES auth.users(id),
  deleted_at                  timestamptz,

  -- Two-axis invariant: READY_TO_BUILD requires sign-off. Defense-in-depth
  -- alongside the RPC checks (catches any direct UPDATE).
  CONSTRAINT seo_blueprints_ready_requires_approval CHECK (
    status <> 'READY_TO_BUILD' OR review_status = 'APPROVED'
  )
);

-- Duplicate detection: lookup index (NOT unique) on the normalised title.
-- Hard-unique would contradict the spec — DUPLICATE_LOW_VALUE is meant as a
-- soft governance flag (owner sees the dup, decides to differentiate or
-- merge) rather than a database-level block. The classifier flags duplicates
-- on create/update; this index keeps that check fast.
CREATE INDEX IF NOT EXISTS idx_seo_blueprints_hotel_title
  ON public.seo_landing_blueprints (hotel_id, public._seo_normalize_title(page_title_concept))
  WHERE deleted_at IS NULL AND status <> 'ARCHIVED';

CREATE INDEX IF NOT EXISTS idx_seo_blueprints_hotel_status
  ON public.seo_landing_blueprints (hotel_id, status, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_seo_blueprints_hotel_risk
  ON public.seo_landing_blueprints (hotel_id, risk_classification)
  WHERE deleted_at IS NULL;

-- ─── seo_landing_blueprint_events (append-only audit) ───────────────────────

CREATE TABLE IF NOT EXISTS public.seo_landing_blueprint_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id          uuid NOT NULL REFERENCES public.seo_landing_blueprints(id) ON DELETE CASCADE,
  hotel_id              uuid NOT NULL REFERENCES public.hotels(id),
  event_type            public.seo_blueprint_event_type NOT NULL,
  payload               jsonb NOT NULL DEFAULT '{}',
  actor_id              uuid REFERENCES auth.users(id),
  occurred_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  event_schema_version  integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_seo_blueprint_events_blueprint
  ON public.seo_landing_blueprint_events (blueprint_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_seo_blueprint_events_hotel_type
  ON public.seo_landing_blueprint_events (hotel_id, event_type, occurred_at DESC);

-- ─── Triggers ───────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_seo_blueprints_updated_at ON public.seo_landing_blueprints;
CREATE TRIGGER trg_seo_blueprints_updated_at
  BEFORE UPDATE ON public.seo_landing_blueprints
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE public.seo_landing_blueprints        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_landing_blueprint_events  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seo_blueprints_select_for_members ON public.seo_landing_blueprints;
CREATE POLICY seo_blueprints_select_for_members ON public.seo_landing_blueprints
  FOR SELECT USING (public.vaiyu_is_hotel_member(hotel_id));

-- INSERT/UPDATE only via SECURITY DEFINER RPCs (audit + writes stay paired).

DROP POLICY IF EXISTS seo_blueprint_events_select_for_members ON public.seo_landing_blueprint_events;
CREATE POLICY seo_blueprint_events_select_for_members ON public.seo_landing_blueprint_events
  FOR SELECT USING (public.vaiyu_is_hotel_member(hotel_id));

-- ─── _record_seo_blueprint_event (internal helper) ──────────────────────────

CREATE OR REPLACE FUNCTION public._record_seo_blueprint_event(
  p_blueprint_id uuid,
  p_hotel_id     uuid,
  p_event_type   public.seo_blueprint_event_type,
  p_payload      jsonb DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.seo_landing_blueprint_events (blueprint_id, hotel_id, event_type, payload, actor_id)
  VALUES (p_blueprint_id, p_hotel_id, p_event_type, p_payload, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ─── create_seo_blueprint ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_seo_blueprint(
  p_hotel_id                    uuid,
  p_page_title_concept          text,
  p_target_category             public.seo_blueprint_category,
  p_required_proof              jsonb DEFAULT '[]'::jsonb,
  p_why_it_matters              text DEFAULT NULL,
  p_hinglish_guidance           text DEFAULT NULL,
  p_safe_next_action            text DEFAULT NULL,
  p_connected_module_suggestion text DEFAULT NULL,
  p_owner_notes                 text DEFAULT NULL,
  p_internal_notes              text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_id        uuid;
  v_dup       boolean;
  v_risk      public.seo_blueprint_risk;
  v_norm      text;
BEGIN
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF p_page_title_concept IS NULL OR btrim(p_page_title_concept) = '' THEN
    RAISE EXCEPTION 'TITLE_REQUIRED';
  END IF;

  v_norm := public._seo_normalize_title(p_page_title_concept);
  v_dup := EXISTS (
    SELECT 1 FROM public.seo_landing_blueprints
     WHERE hotel_id = p_hotel_id
       AND deleted_at IS NULL
       AND status <> 'ARCHIVED'
       AND public._seo_normalize_title(page_title_concept) = v_norm
  );

  v_risk := public._classify_seo_blueprint(
    p_page_title_concept, p_target_category, COALESCE(p_required_proof, '[]'::jsonb), v_dup);

  INSERT INTO public.seo_landing_blueprints (
    hotel_id, page_title_concept, target_category, risk_classification,
    status, review_status, required_proof,
    why_it_matters, hinglish_guidance, safe_next_action, connected_module_suggestion,
    owner_notes, internal_notes,
    created_by, updated_by
  ) VALUES (
    p_hotel_id, btrim(p_page_title_concept), p_target_category, v_risk,
    'DRAFT', 'PENDING_REVIEW', COALESCE(p_required_proof, '[]'::jsonb),
    p_why_it_matters, p_hinglish_guidance, p_safe_next_action, p_connected_module_suggestion,
    p_owner_notes, p_internal_notes,
    auth.uid(), auth.uid()
  )
  RETURNING id INTO v_id;

  PERFORM public._record_seo_blueprint_event(v_id, p_hotel_id, 'CREATED',
    jsonb_build_object('category', p_target_category::text, 'risk', v_risk::text,
                       'title', btrim(p_page_title_concept)));

  RETURN jsonb_build_object('id', v_id, 'risk_classification', v_risk::text, 'status', 'DRAFT');
END;
$$;

-- ─── update_seo_blueprint ───────────────────────────────────────────────────
-- Editable in DRAFT / IN_REVIEW / ON_HOLD. Recomputes risk deterministically.
-- An explicit override (with reason) lets a human assert e.g. FAKE_LOCAL_CLAIM
-- or ON_HOLD that the rules can't infer; logged as RECLASSIFIED.

CREATE OR REPLACE FUNCTION public.update_seo_blueprint(
  p_id                          uuid,
  p_page_title_concept          text DEFAULT NULL,
  p_target_category             public.seo_blueprint_category DEFAULT NULL,
  p_required_proof              jsonb DEFAULT NULL,
  p_why_it_matters              text DEFAULT NULL,
  p_hinglish_guidance           text DEFAULT NULL,
  p_safe_next_action            text DEFAULT NULL,
  p_connected_module_suggestion text DEFAULT NULL,
  p_owner_notes                 text DEFAULT NULL,
  p_internal_notes              text DEFAULT NULL,
  p_risk_override               public.seo_blueprint_risk DEFAULT NULL,
  p_override_reason             text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row       public.seo_landing_blueprints;
  v_title     text;
  v_category  public.seo_blueprint_category;
  v_proof     jsonb;
  v_norm      text;
  v_dup       boolean;
  v_computed  public.seo_blueprint_risk;
  v_final     public.seo_blueprint_risk;
BEGIN
  SELECT * INTO v_row FROM public.seo_landing_blueprints WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'BLUEPRINT_NOT_FOUND'; END IF;
  IF v_row.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'BLUEPRINT_DELETED'; END IF;
  IF NOT public.vaiyu_is_hotel_member(v_row.hotel_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF v_row.status NOT IN ('DRAFT', 'IN_REVIEW', 'ON_HOLD') THEN RAISE EXCEPTION 'NOT_EDITABLE'; END IF;

  IF p_risk_override IS NOT NULL AND (p_override_reason IS NULL OR btrim(p_override_reason) = '') THEN
    RAISE EXCEPTION 'OVERRIDE_REASON_REQUIRED';
  END IF;

  v_title    := COALESCE(NULLIF(btrim(COALESCE(p_page_title_concept, '')), ''), v_row.page_title_concept);
  v_category := COALESCE(p_target_category, v_row.target_category);
  v_proof    := COALESCE(p_required_proof, v_row.required_proof);

  v_norm := public._seo_normalize_title(v_title);
  v_dup := EXISTS (
    SELECT 1 FROM public.seo_landing_blueprints
     WHERE hotel_id = v_row.hotel_id
       AND id <> p_id
       AND deleted_at IS NULL
       AND status <> 'ARCHIVED'
       AND public._seo_normalize_title(page_title_concept) = v_norm
  );

  v_computed := public._classify_seo_blueprint(v_title, v_category, v_proof, v_dup);
  v_final := COALESCE(p_risk_override, v_computed);

  UPDATE public.seo_landing_blueprints SET
    page_title_concept          = v_title,
    target_category             = v_category,
    required_proof              = v_proof,
    risk_classification         = v_final,
    why_it_matters              = COALESCE(p_why_it_matters, why_it_matters),
    hinglish_guidance           = COALESCE(p_hinglish_guidance, hinglish_guidance),
    safe_next_action            = COALESCE(p_safe_next_action, safe_next_action),
    connected_module_suggestion = COALESCE(p_connected_module_suggestion, connected_module_suggestion),
    owner_notes                 = COALESCE(p_owner_notes, owner_notes),
    internal_notes              = COALESCE(p_internal_notes, internal_notes),
    updated_by                  = auth.uid()
  WHERE id = p_id;

  PERFORM public._record_seo_blueprint_event(p_id, v_row.hotel_id, 'EDITED', '{}'::jsonb);

  IF v_final <> v_row.risk_classification THEN
    PERFORM public._record_seo_blueprint_event(p_id, v_row.hotel_id, 'RECLASSIFIED',
      jsonb_build_object('from', v_row.risk_classification::text, 'to', v_final::text,
                         'computed', v_computed::text,
                         'overridden', (p_risk_override IS NOT NULL),
                         'reason', NULLIF(btrim(COALESCE(p_override_reason, '')), '')));
  END IF;

  RETURN jsonb_build_object('id', p_id, 'risk_classification', v_final::text,
                            'computed_risk', v_computed::text);
END;
$$;

-- ─── submit_seo_blueprint_for_review ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_seo_blueprint_for_review(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row public.seo_landing_blueprints;
BEGIN
  SELECT * INTO v_row FROM public.seo_landing_blueprints WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'BLUEPRINT_NOT_FOUND'; END IF;
  IF v_row.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'BLUEPRINT_DELETED'; END IF;
  IF NOT public.vaiyu_is_hotel_member(v_row.hotel_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF v_row.status NOT IN ('DRAFT', 'ON_HOLD') THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;

  UPDATE public.seo_landing_blueprints SET
    status        = 'IN_REVIEW',
    review_status = 'PENDING_REVIEW',
    updated_by    = auth.uid()
  WHERE id = p_id;

  PERFORM public._record_seo_blueprint_event(p_id, v_row.hotel_id, 'SUBMITTED_FOR_REVIEW', '{}'::jsonb);
END;
$$;

-- ─── approve_seo_blueprint (manager+; IN_REVIEW → READY_TO_BUILD + APPROVED) ──

CREATE OR REPLACE FUNCTION public.approve_seo_blueprint(p_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row public.seo_landing_blueprints;
BEGIN
  SELECT * INTO v_row FROM public.seo_landing_blueprints WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'BLUEPRINT_NOT_FOUND'; END IF;
  IF v_row.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'BLUEPRINT_DELETED'; END IF;
  IF NOT public.vaiyu_is_hotel_finance_manager(v_row.hotel_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF v_row.status <> 'IN_REVIEW' THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
  -- Refuse to sign off ideas the Policy Shield flagged as unsafe.
  IF v_row.risk_classification IN ('RISKY_DOORWAY', 'FAKE_LOCAL_CLAIM', 'DUPLICATE_LOW_VALUE') THEN
    RAISE EXCEPTION 'RISK_BLOCKS_APPROVAL';
  END IF;

  UPDATE public.seo_landing_blueprints SET
    status          = 'READY_TO_BUILD',
    review_status   = 'APPROVED',
    review_notes    = p_note,
    review_actor_id = auth.uid(),
    reviewed_at     = now(),
    updated_by      = auth.uid()
  WHERE id = p_id;

  PERFORM public._record_seo_blueprint_event(p_id, v_row.hotel_id, 'APPROVED',
    jsonb_build_object('note', p_note));
END;
$$;

-- ─── request_seo_blueprint_changes (manager+; IN_REVIEW → DRAFT) ────────────

CREATE OR REPLACE FUNCTION public.request_seo_blueprint_changes(p_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row public.seo_landing_blueprints;
BEGIN
  IF p_note IS NULL OR btrim(p_note) = '' THEN RAISE EXCEPTION 'NOTE_REQUIRED'; END IF;

  SELECT * INTO v_row FROM public.seo_landing_blueprints WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'BLUEPRINT_NOT_FOUND'; END IF;
  IF v_row.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'BLUEPRINT_DELETED'; END IF;
  IF NOT public.vaiyu_is_hotel_finance_manager(v_row.hotel_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF v_row.status <> 'IN_REVIEW' THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;

  UPDATE public.seo_landing_blueprints SET
    status          = 'DRAFT',
    review_status   = 'CHANGES_REQUESTED',
    review_notes    = btrim(p_note),
    review_actor_id = auth.uid(),
    reviewed_at     = now(),
    updated_by      = auth.uid()
  WHERE id = p_id;

  PERFORM public._record_seo_blueprint_event(p_id, v_row.hotel_id, 'CHANGES_REQUESTED',
    jsonb_build_object('note', btrim(p_note)));
END;
$$;

-- ─── hold_seo_blueprint ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hold_seo_blueprint(p_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row public.seo_landing_blueprints;
BEGIN
  SELECT * INTO v_row FROM public.seo_landing_blueprints WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'BLUEPRINT_NOT_FOUND'; END IF;
  IF v_row.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'BLUEPRINT_DELETED'; END IF;
  IF NOT public.vaiyu_is_hotel_member(v_row.hotel_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF v_row.status NOT IN ('DRAFT', 'IN_REVIEW', 'READY_TO_BUILD') THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;

  UPDATE public.seo_landing_blueprints SET
    status        = 'ON_HOLD',
    -- Dropping out of READY_TO_BUILD must drop approval too (CHECK guards this).
    review_status = CASE WHEN v_row.review_status = 'APPROVED' THEN 'PENDING_REVIEW' ELSE review_status END,
    updated_by    = auth.uid()
  WHERE id = p_id;

  PERFORM public._record_seo_blueprint_event(p_id, v_row.hotel_id, 'HELD',
    jsonb_build_object('reason', p_reason, 'prev_status', v_row.status::text));
END;
$$;

-- ─── resume_seo_blueprint (ON_HOLD → DRAFT) ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.resume_seo_blueprint(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row public.seo_landing_blueprints;
BEGIN
  SELECT * INTO v_row FROM public.seo_landing_blueprints WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'BLUEPRINT_NOT_FOUND'; END IF;
  IF v_row.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'BLUEPRINT_DELETED'; END IF;
  IF NOT public.vaiyu_is_hotel_member(v_row.hotel_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF v_row.status <> 'ON_HOLD' THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;

  UPDATE public.seo_landing_blueprints SET
    status     = 'DRAFT',
    updated_by = auth.uid()
  WHERE id = p_id;

  PERFORM public._record_seo_blueprint_event(p_id, v_row.hotel_id, 'RESUMED', '{}'::jsonb);
END;
$$;

-- ─── archive_seo_blueprint (manager+) ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.archive_seo_blueprint(p_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row public.seo_landing_blueprints;
BEGIN
  SELECT * INTO v_row FROM public.seo_landing_blueprints WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'BLUEPRINT_NOT_FOUND'; END IF;
  IF v_row.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'BLUEPRINT_DELETED'; END IF;
  IF NOT public.vaiyu_is_hotel_finance_manager(v_row.hotel_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF v_row.status = 'ARCHIVED' THEN RETURN; END IF;

  UPDATE public.seo_landing_blueprints SET
    status     = 'ARCHIVED',
    updated_by = auth.uid()
  WHERE id = p_id;

  PERFORM public._record_seo_blueprint_event(p_id, v_row.hotel_id, 'ARCHIVED',
    jsonb_build_object('reason', p_reason, 'prev_status', v_row.status::text));
END;
$$;

-- ─── soft_delete_seo_blueprint (manager+) ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.soft_delete_seo_blueprint(p_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row public.seo_landing_blueprints;
BEGIN
  SELECT * INTO v_row FROM public.seo_landing_blueprints WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'BLUEPRINT_NOT_FOUND'; END IF;
  IF v_row.deleted_at IS NOT NULL THEN RETURN; END IF;
  IF NOT public.vaiyu_is_hotel_finance_manager(v_row.hotel_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  UPDATE public.seo_landing_blueprints SET
    deleted_at = clock_timestamp(),
    updated_by = auth.uid()
  WHERE id = p_id;

  PERFORM public._record_seo_blueprint_event(p_id, v_row.hotel_id, 'SOFT_DELETED',
    jsonb_build_object('reason', p_reason));
END;
$$;

-- ─── get_seo_blueprint_summary (read-model; reusable by future Visibility Score) ─

CREATE OR REPLACE FUNCTION public.get_seo_blueprint_summary(p_hotel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_by_risk    jsonb;
  v_by_status  jsonb;
  v_total      integer;
BEGIN
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT COUNT(*) INTO v_total
    FROM public.seo_landing_blueprints
   WHERE hotel_id = p_hotel_id AND deleted_at IS NULL;

  SELECT COALESCE(jsonb_object_agg(risk_classification, cnt), '{}'::jsonb) INTO v_by_risk
    FROM (
      SELECT risk_classification::text AS risk_classification, COUNT(*) AS cnt
        FROM public.seo_landing_blueprints
       WHERE hotel_id = p_hotel_id AND deleted_at IS NULL
       GROUP BY risk_classification
    ) r;

  SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb) INTO v_by_status
    FROM (
      SELECT status::text AS status, COUNT(*) AS cnt
        FROM public.seo_landing_blueprints
       WHERE hotel_id = p_hotel_id AND deleted_at IS NULL
       GROUP BY status
    ) s;

  RETURN jsonb_build_object('total', v_total, 'by_risk', v_by_risk, 'by_status', v_by_status);
END;
$$;

-- ─── Grants (authenticated only — no anon; internal planning) ───────────────

GRANT EXECUTE ON FUNCTION public.create_seo_blueprint                TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_seo_blueprint                TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_seo_blueprint_for_review     TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_seo_blueprint               TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_seo_blueprint_changes       TO authenticated;
GRANT EXECUTE ON FUNCTION public.hold_seo_blueprint                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_seo_blueprint                TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_seo_blueprint               TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_seo_blueprint           TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seo_blueprint_summary           TO authenticated;

-- ─── Realtime publication ───────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.seo_landing_blueprints;       EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.seo_landing_blueprint_events; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- ─── Comments ───────────────────────────────────────────────────────────────

COMMENT ON TABLE public.seo_landing_blueprints IS
  'Local SEO Landing Planner (Position 7). INTERNAL planning/governance only — publishes nothing. Two-axis governance: status (DRAFT->IN_REVIEW->READY_TO_BUILD->ON_HOLD->ARCHIVED) x review_status (PENDING_REVIEW/APPROVED/CHANGES_REQUESTED). CHECK enforces READY_TO_BUILD requires APPROVED. risk_classification is set by the deterministic _classify_seo_blueprint Policy Shield (no AI); humans may override with a logged reason.';

COMMENT ON FUNCTION public._classify_seo_blueprint IS
  'Deterministic Policy Shield (no AI). Pure function of (title, category, proof, is_duplicate). The frontend mirrors this for instant UX; the server value is authoritative on write.';
