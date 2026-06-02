-- AI Quote Drafts — Phase 8B persistence + AI consent + RPC layer
--
-- Adds:
--   • quote_drafts             — persistent draft rows (DRAFT/SENT/ACCEPTED/etc.)
--   • quote_draft_events       — append-only audit timeline
--   • hotels.ai_quote_drafts_consented + consent metadata + daily token cap
--   • 7 SECURITY DEFINER RPCs for the workspace + consent flow
--   • RLS scoped via vaiyu_is_hotel_member (matches Lead CRM convention)
--
-- Reuses existing infrastructure:
--   • log_ai_tokens RPC (writes ai_usage + ai_usage_events)
--   • ai_usage_events table for per-call audit (we read it for the daily cap)
--   • vaiyu_is_hotel_member / vaiyu_is_hotel_finance_manager helpers
--   • set_updated_at trigger function
--
-- Quality bar (CLAUDE.md):
--   • Multi-tenant RLS scoped to hotel_members (always)
--   • SECURITY DEFINER with explicit search_path
--   • Stable error codes (RAISE EXCEPTION 'CODE_NAME') parseable by frontend
--   • clock_timestamp() for event ordering (not now())
--   • Append-only event table — no UPDATE/DELETE policies

-- ─── Enums ──────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.quote_draft_status AS ENUM (
    'DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'WITHDRAWN'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.quote_draft_event_type AS ENUM (
    'CREATED',
    'EDITED',
    'GENERATED_VIA_AI',
    'GENERATED_VIA_TEMPLATE',
    'COPIED',
    'SENT',
    'ACCEPTED',
    'EXPIRED',
    'WITHDRAWN'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.quote_draft_generator AS ENUM ('TEMPLATE', 'AI');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── hotels: AI consent + budget ───────────────────────────────────────────

ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS ai_quote_drafts_consented boolean NOT NULL DEFAULT false;
ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS ai_quote_drafts_consented_at timestamptz;
ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS ai_quote_drafts_consented_by uuid REFERENCES auth.users(id);
ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS ai_quote_daily_token_cap integer NOT NULL DEFAULT 50000
    CHECK (ai_quote_daily_token_cap >= 0);

COMMENT ON COLUMN public.hotels.ai_quote_drafts_consented IS
  'Owner must explicitly opt the hotel in before AI generation can run. Edge Function refuses with 403 CONSENT_REQUIRED when false.';
COMMENT ON COLUMN public.hotels.ai_quote_daily_token_cap IS
  'Hard daily cap on AI tokens for ai-generate-quote. Edge Function refuses with 402 BUDGET_EXCEEDED when day-to-date usage would exceed this.';

-- ─── quote_drafts ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.quote_drafts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id                uuid NOT NULL REFERENCES public.hotels(id) ON DELETE RESTRICT,
  lead_id                 uuid REFERENCES public.leads(id),

  package_code            text,
  room_type_id            uuid REFERENCES public.room_types(id),
  manual_price_text       text NOT NULL DEFAULT '',
  nights                  integer NOT NULL DEFAULT 0 CHECK (nights >= 0),
  inclusions              text[] NOT NULL DEFAULT '{}',
  owner_notes             text NOT NULL DEFAULT '',

  draft_text              text NOT NULL,
  generated_by            public.quote_draft_generator NOT NULL DEFAULT 'TEMPLATE',
  ai_model                text,
  ai_tokens_in            integer,
  ai_tokens_out           integer,

  availability_confirmed  boolean NOT NULL DEFAULT false,
  terms_confirmed         boolean NOT NULL DEFAULT false,

  status                  public.quote_draft_status NOT NULL DEFAULT 'DRAFT',
  status_reason           text,

  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid REFERENCES auth.users(id),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid REFERENCES auth.users(id),
  sent_at                 timestamptz,
  sent_channel            text,
  expires_at              timestamptz,

  CONSTRAINT quote_drafts_ai_meta_paired CHECK (
    (generated_by = 'AI'  AND ai_model IS NOT NULL AND ai_tokens_in IS NOT NULL AND ai_tokens_out IS NOT NULL)
    OR
    (generated_by = 'TEMPLATE' AND ai_model IS NULL AND ai_tokens_in IS NULL AND ai_tokens_out IS NULL)
  ),
  CONSTRAINT quote_drafts_sent_requires_governance CHECK (
    status <> 'SENT' OR (availability_confirmed AND terms_confirmed)
  ),
  CONSTRAINT quote_drafts_draft_text_present CHECK (length(btrim(draft_text)) > 0)
);

-- ─── quote_draft_events ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.quote_draft_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_draft_id        uuid NOT NULL REFERENCES public.quote_drafts(id) ON DELETE CASCADE,
  hotel_id              uuid NOT NULL REFERENCES public.hotels(id),
  event_type            public.quote_draft_event_type NOT NULL,
  payload               jsonb NOT NULL DEFAULT '{}',
  actor_id              uuid REFERENCES auth.users(id),
  occurred_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  event_schema_version  integer NOT NULL DEFAULT 1
);

-- ─── Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_quote_drafts_hotel_updated
  ON public.quote_drafts (hotel_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_quote_drafts_hotel_status
  ON public.quote_drafts (hotel_id, status)
  WHERE status NOT IN ('WITHDRAWN', 'EXPIRED');

CREATE INDEX IF NOT EXISTS idx_quote_drafts_lead
  ON public.quote_drafts (lead_id, updated_at DESC)
  WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quote_draft_events_draft
  ON public.quote_draft_events (quote_draft_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_quote_draft_events_hotel_type
  ON public.quote_draft_events (hotel_id, event_type, occurred_at DESC);

-- Daily-usage hot path index for budget check
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_hotel_func_day
  ON public.ai_usage_events (hotel_id, func, created_at);

-- ─── Triggers ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_quote_drafts_updated_at ON public.quote_drafts;
CREATE TRIGGER trg_quote_drafts_updated_at
  BEFORE UPDATE ON public.quote_drafts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.quote_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_draft_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quote_drafts_select_for_members ON public.quote_drafts;
CREATE POLICY quote_drafts_select_for_members ON public.quote_drafts
  FOR SELECT
  USING (public.vaiyu_is_hotel_member(hotel_id));

-- INSERT/UPDATE happen only via SECURITY DEFINER RPCs below — no member policies
-- granted directly. This keeps the audit trail (events) inseparable from writes.

DROP POLICY IF EXISTS quote_draft_events_select_for_members ON public.quote_draft_events;
CREATE POLICY quote_draft_events_select_for_members ON public.quote_draft_events
  FOR SELECT
  USING (public.vaiyu_is_hotel_member(hotel_id));

-- ─── create_quote_draft ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_quote_draft(
  p_hotel_id                uuid,
  p_draft_text              text,
  p_generated_by            text DEFAULT 'TEMPLATE',
  p_lead_id                 uuid DEFAULT NULL,
  p_package_code            text DEFAULT NULL,
  p_room_type_id            uuid DEFAULT NULL,
  p_manual_price_text       text DEFAULT '',
  p_nights                  integer DEFAULT 0,
  p_inclusions              text[] DEFAULT '{}',
  p_owner_notes             text DEFAULT '',
  p_ai_model                text DEFAULT NULL,
  p_ai_tokens_in            integer DEFAULT NULL,
  p_ai_tokens_out           integer DEFAULT NULL,
  p_availability_confirmed  boolean DEFAULT false,
  p_terms_confirmed         boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_id      uuid;
  v_gen     public.quote_draft_generator;
  v_ev_type public.quote_draft_event_type;
  v_lead_hotel uuid;
BEGIN
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF p_draft_text IS NULL OR btrim(p_draft_text) = '' THEN
    RAISE EXCEPTION 'DRAFT_TEXT_REQUIRED';
  END IF;

  IF p_generated_by NOT IN ('TEMPLATE', 'AI') THEN
    RAISE EXCEPTION 'INVALID_GENERATOR';
  END IF;
  v_gen := p_generated_by::public.quote_draft_generator;

  IF v_gen = 'AI' THEN
    IF p_ai_model IS NULL OR p_ai_tokens_in IS NULL OR p_ai_tokens_out IS NULL THEN
      RAISE EXCEPTION 'AI_META_REQUIRED';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.hotels h
      WHERE h.id = p_hotel_id AND h.ai_quote_drafts_consented = true
    ) THEN
      RAISE EXCEPTION 'CONSENT_REQUIRED';
    END IF;
  END IF;

  -- Cross-tenant guard: lead must belong to same hotel if provided
  IF p_lead_id IS NOT NULL THEN
    SELECT hotel_id INTO v_lead_hotel FROM public.leads WHERE id = p_lead_id;
    IF v_lead_hotel IS NULL THEN
      RAISE EXCEPTION 'LEAD_NOT_FOUND';
    END IF;
    IF v_lead_hotel <> p_hotel_id THEN
      RAISE EXCEPTION 'LEAD_HOTEL_MISMATCH';
    END IF;
  END IF;

  INSERT INTO public.quote_drafts (
    hotel_id, lead_id, package_code, room_type_id,
    manual_price_text, nights, inclusions, owner_notes,
    draft_text, generated_by, ai_model, ai_tokens_in, ai_tokens_out,
    availability_confirmed, terms_confirmed,
    created_by, updated_by
  ) VALUES (
    p_hotel_id, p_lead_id, p_package_code, p_room_type_id,
    COALESCE(p_manual_price_text, ''), GREATEST(0, COALESCE(p_nights, 0)),
    COALESCE(p_inclusions, '{}'), COALESCE(p_owner_notes, ''),
    p_draft_text, v_gen, p_ai_model, p_ai_tokens_in, p_ai_tokens_out,
    COALESCE(p_availability_confirmed, false), COALESCE(p_terms_confirmed, false),
    auth.uid(), auth.uid()
  )
  RETURNING id INTO v_id;

  -- CREATED event
  INSERT INTO public.quote_draft_events (quote_draft_id, hotel_id, event_type, payload, actor_id)
  VALUES (
    v_id, p_hotel_id, 'CREATED',
    jsonb_build_object(
      'generated_by', v_gen::text,
      'has_lead', p_lead_id IS NOT NULL,
      'has_package', p_package_code IS NOT NULL,
      'has_room_type', p_room_type_id IS NOT NULL
    ),
    auth.uid()
  );

  -- Source-of-generation event (mirrors event log convention in lead_events)
  v_ev_type := CASE WHEN v_gen = 'AI' THEN 'GENERATED_VIA_AI' ELSE 'GENERATED_VIA_TEMPLATE' END;
  INSERT INTO public.quote_draft_events (quote_draft_id, hotel_id, event_type, payload, actor_id)
  VALUES (
    v_id, p_hotel_id, v_ev_type,
    jsonb_build_object(
      'model', p_ai_model,
      'tokens_in', p_ai_tokens_in,
      'tokens_out', p_ai_tokens_out
    ),
    auth.uid()
  );

  RETURN jsonb_build_object('id', v_id, 'status', 'DRAFT');
END;
$$;

-- ─── update_quote_draft ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_quote_draft(
  p_id                     uuid,
  p_draft_text             text DEFAULT NULL,
  p_manual_price_text      text DEFAULT NULL,
  p_owner_notes            text DEFAULT NULL,
  p_availability_confirmed boolean DEFAULT NULL,
  p_terms_confirmed        boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row    record;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO v_row FROM public.quote_drafts WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'QUOTE_NOT_FOUND'; END IF;

  IF NOT public.vaiyu_is_hotel_member(v_row.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF v_row.status NOT IN ('DRAFT', 'SENT') THEN
    RAISE EXCEPTION 'NOT_EDITABLE';
  END IF;

  -- Build diff
  IF p_draft_text IS NOT NULL AND p_draft_text IS DISTINCT FROM v_row.draft_text THEN
    IF btrim(p_draft_text) = '' THEN RAISE EXCEPTION 'DRAFT_TEXT_REQUIRED'; END IF;
    v_changes := v_changes || jsonb_build_object('draft_text_length',
      jsonb_build_array(coalesce(length(v_row.draft_text),0), length(p_draft_text)));
  END IF;
  IF p_manual_price_text IS NOT NULL AND p_manual_price_text IS DISTINCT FROM v_row.manual_price_text THEN
    v_changes := v_changes || jsonb_build_object('manual_price_text',
      jsonb_build_array(v_row.manual_price_text, p_manual_price_text));
  END IF;
  IF p_owner_notes IS NOT NULL AND p_owner_notes IS DISTINCT FROM v_row.owner_notes THEN
    v_changes := v_changes || jsonb_build_object('owner_notes_length',
      jsonb_build_array(coalesce(length(v_row.owner_notes),0), length(p_owner_notes)));
  END IF;
  IF p_availability_confirmed IS NOT NULL AND p_availability_confirmed IS DISTINCT FROM v_row.availability_confirmed THEN
    v_changes := v_changes || jsonb_build_object('availability_confirmed',
      jsonb_build_array(v_row.availability_confirmed, p_availability_confirmed));
  END IF;
  IF p_terms_confirmed IS NOT NULL AND p_terms_confirmed IS DISTINCT FROM v_row.terms_confirmed THEN
    v_changes := v_changes || jsonb_build_object('terms_confirmed',
      jsonb_build_array(v_row.terms_confirmed, p_terms_confirmed));
  END IF;

  IF v_changes = '{}'::jsonb THEN RETURN; END IF;

  UPDATE public.quote_drafts SET
    draft_text             = COALESCE(p_draft_text, draft_text),
    manual_price_text      = COALESCE(p_manual_price_text, manual_price_text),
    owner_notes            = COALESCE(p_owner_notes, owner_notes),
    availability_confirmed = COALESCE(p_availability_confirmed, availability_confirmed),
    terms_confirmed        = COALESCE(p_terms_confirmed, terms_confirmed),
    updated_by             = auth.uid()
  WHERE id = p_id;

  INSERT INTO public.quote_draft_events (quote_draft_id, hotel_id, event_type, payload, actor_id)
  VALUES (p_id, v_row.hotel_id, 'EDITED', jsonb_build_object('changes', v_changes), auth.uid());
END;
$$;

-- ─── mark_quote_draft_sent ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_quote_draft_sent(
  p_id       uuid,
  p_channel  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row FROM public.quote_drafts WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'QUOTE_NOT_FOUND'; END IF;

  IF NOT public.vaiyu_is_hotel_member(v_row.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF v_row.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: % -> SENT', v_row.status;
  END IF;

  IF NOT (v_row.availability_confirmed AND v_row.terms_confirmed) THEN
    RAISE EXCEPTION 'GOVERNANCE_INCOMPLETE';
  END IF;

  UPDATE public.quote_drafts SET
    status       = 'SENT',
    sent_at      = clock_timestamp(),
    sent_channel = p_channel,
    updated_by   = auth.uid()
  WHERE id = p_id;

  INSERT INTO public.quote_draft_events (quote_draft_id, hotel_id, event_type, payload, actor_id)
  VALUES (
    p_id, v_row.hotel_id, 'SENT',
    jsonb_build_object('channel', p_channel),
    auth.uid()
  );
END;
$$;

-- ─── withdraw_quote_draft ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.withdraw_quote_draft(
  p_id     uuid,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row FROM public.quote_drafts WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'QUOTE_NOT_FOUND'; END IF;

  IF NOT public.vaiyu_is_hotel_member(v_row.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF v_row.status IN ('WITHDRAWN', 'EXPIRED', 'ACCEPTED') THEN
    RETURN; -- idempotent terminal-state guard
  END IF;

  UPDATE public.quote_drafts SET
    status        = 'WITHDRAWN',
    status_reason = p_reason,
    updated_by    = auth.uid()
  WHERE id = p_id;

  INSERT INTO public.quote_draft_events (quote_draft_id, hotel_id, event_type, payload, actor_id)
  VALUES (
    p_id, v_row.hotel_id, 'WITHDRAWN',
    jsonb_build_object('reason', p_reason, 'prev_status', v_row.status::text),
    auth.uid()
  );
END;
$$;

-- ─── get_ai_quote_daily_usage ──────────────────────────────────────────────
-- Returns total tokens used today by this hotel for the ai-generate-quote
-- function. Used by the Edge Function to enforce the daily budget cap.

CREATE OR REPLACE FUNCTION public.get_ai_quote_daily_usage(p_hotel_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT COALESCE(SUM(tokens), 0)::integer
  FROM public.ai_usage_events
  WHERE hotel_id = p_hotel_id
    AND func = 'ai-generate-quote'
    AND created_at >= date_trunc('day', now());
$$;

-- ─── set_hotel_ai_quote_consent ────────────────────────────────────────────
-- Manager/owner-only flip of the per-hotel AI consent flag. Writes audit row
-- into quote_draft_events with a sentinel quote_draft_id reference? No — we
-- use the hotels table directly and rely on the existing va_audit_logs table
-- for hotel-config changes. For now we keep it simple and stamp consent
-- metadata onto the hotels row.

CREATE OR REPLACE FUNCTION public.set_hotel_ai_quote_consent(
  p_hotel_id  uuid,
  p_consented boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_old boolean;
BEGIN
  IF NOT public.vaiyu_is_hotel_finance_manager(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT ai_quote_drafts_consented INTO v_old FROM public.hotels WHERE id = p_hotel_id;
  IF v_old IS NULL THEN RAISE EXCEPTION 'HOTEL_NOT_FOUND'; END IF;

  UPDATE public.hotels SET
    ai_quote_drafts_consented    = p_consented,
    ai_quote_drafts_consented_at = CASE WHEN p_consented THEN clock_timestamp() ELSE NULL END,
    ai_quote_drafts_consented_by = CASE WHEN p_consented THEN auth.uid() ELSE NULL END
  WHERE id = p_hotel_id;

  RETURN jsonb_build_object(
    'ok', true,
    'consented', p_consented,
    'previous', v_old
  );
END;
$$;

-- ─── Grants ────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.create_quote_draft TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_quote_draft TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_quote_draft_sent TO authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_quote_draft TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ai_quote_daily_usage TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_hotel_ai_quote_consent TO authenticated;

-- ─── Realtime publication ─────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.quote_drafts;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.quote_draft_events;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- ─── Comments ──────────────────────────────────────────────────────────────

COMMENT ON TABLE public.quote_drafts IS
  'Phase 8B: persistent quote proposals. generated_by distinguishes deterministic TEMPLATE (Phase 8A path) from AI-assisted (Phase 8B+). AI rows require valid model + token counts AND hotel-level consent.';

COMMENT ON TABLE public.quote_draft_events IS
  'Append-only audit timeline for quote_drafts. Every state change writes a row. Reused realtime subscription pattern from lead_events.';

COMMENT ON CONSTRAINT quote_drafts_ai_meta_paired ON public.quote_drafts IS
  'AI-generated rows must carry model + token meta; TEMPLATE rows must have all three NULL. Prevents silent gen-source drift.';

COMMENT ON CONSTRAINT quote_drafts_sent_requires_governance ON public.quote_drafts IS
  'Operator must confirm availability and terms before a draft can transition to SENT. Defense-in-depth alongside the RPC check.';
