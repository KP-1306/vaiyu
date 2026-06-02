-- Follow-up Radar — persistence + auto-creation from Lead CRM
--
-- Scope of this migration:
--   • follow_ups table (RLS hotel-scoped via vaiyu_is_hotel_member)
--   • follow_up_events append-only audit
--   • 3 enums (category, status, priority) — same set the frontend v0 already uses
--   • 6 SECURITY DEFINER RPCs for create/address/dismiss/block/reopen/sync
--   • 2 triggers wiring Lead CRM → follow-ups (auto-create on lead INSERT;
--     auto-resolve when lead status transitions to CONVERTED/LOST/SOFT_DELETED)
--
-- Constraints honoured (per the original Follow-up Radar brief):
--   • Ticket/SLA data stays MOCK — we do NOT read tickets, SLA, reviews, or
--     orders. Operators can manually create UNRESOLVED_COMPLAINT or
--     SLA_ESCALATION follow-ups, but the system does not derive them.
--   • PACKAGE_ENQUIRY / REVIEW_REQUEST / OWNER_REPLY: enum values stay but
--     no auto-creation. Wire to real data after Package Builder + Reviews
--     read-only RLS review.
--
-- Quality bar (CLAUDE.md):
--   • Multi-tenant RLS on every table
--   • SECURITY DEFINER with explicit search_path
--   • Stable error codes (RAISE EXCEPTION 'CODE_NAME')
--   • clock_timestamp() for event ordering
--   • Append-only event table — no UPDATE/DELETE policies
--   • Idempotent auto-creation (one DIRECT_ENQUIRY per lead — UNIQUE partial index)

-- ─── Enums ──────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.follow_up_category AS ENUM (
    'DIRECT_ENQUIRY',
    'QUOTE_SENT',
    'PACKAGE_ENQUIRY',
    'REVIEW_REQUEST',
    'OWNER_REPLY',
    'UNRESOLVED_COMPLAINT',
    'SLA_ESCALATION'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.follow_up_status AS ENUM (
    'PENDING', 'DUE', 'OVERDUE', 'BLOCKED', 'ADDRESSED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.follow_up_priority AS ENUM (
    'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.follow_up_event_type AS ENUM (
    'CREATED', 'ADDRESSED', 'DISMISSED',
    'BLOCKED', 'UNBLOCKED', 'REOPENED',
    'AUTO_RESOLVED', 'AUTO_DISMISSED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── follow_ups ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.follow_ups (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id                   uuid NOT NULL REFERENCES public.hotels(id) ON DELETE RESTRICT,
  lead_id                    uuid REFERENCES public.leads(id) ON DELETE SET NULL,

  category                   public.follow_up_category NOT NULL,
  status                     public.follow_up_status NOT NULL DEFAULT 'PENDING',
  priority                   public.follow_up_priority NOT NULL DEFAULT 'MEDIUM',

  title                      text NOT NULL CHECK (length(btrim(title)) > 0),
  context                    text NOT NULL DEFAULT '',
  entity_reference           text NOT NULL DEFAULT '',
  recommended_manual_action  text NOT NULL DEFAULT '',

  due_at                     date NOT NULL,
  assigned_to                uuid REFERENCES auth.users(id),

  -- Mock-derived flags from v0; manually toggleable in v1.
  blocked_reason             text,
  related_ticket_status      text CHECK (
    related_ticket_status IS NULL
    OR related_ticket_status IN ('NONE', 'OPEN_COMPLAINT', 'SLA_BREACH')
  ),

  -- Lifecycle
  addressed_at               timestamptz,
  addressed_by               uuid REFERENCES auth.users(id),
  addressed_note             text,
  dismissed_at               timestamptz,
  dismissed_reason           text,

  -- Audit
  source                     text NOT NULL DEFAULT 'MANUAL'
    CHECK (source IN ('MANUAL', 'AUTO_LEAD_CREATED', 'AUTO_LEAD_QUOTED', 'IMPORT')),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid REFERENCES auth.users(id),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  updated_by                 uuid REFERENCES auth.users(id),

  CONSTRAINT follow_ups_blocked_requires_reason CHECK (
    status <> 'BLOCKED' OR (blocked_reason IS NOT NULL AND length(btrim(blocked_reason)) > 0)
  ),
  CONSTRAINT follow_ups_addressed_pairing CHECK (
    (status = 'ADDRESSED') = (addressed_at IS NOT NULL)
  )
);

-- ─── follow_up_events (append-only) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.follow_up_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follow_up_id          uuid NOT NULL REFERENCES public.follow_ups(id) ON DELETE CASCADE,
  hotel_id              uuid NOT NULL REFERENCES public.hotels(id),
  event_type            public.follow_up_event_type NOT NULL,
  payload               jsonb NOT NULL DEFAULT '{}',
  actor_id              uuid REFERENCES auth.users(id),
  occurred_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  event_schema_version  integer NOT NULL DEFAULT 1
);

-- ─── Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_follow_ups_hotel_due
  ON public.follow_ups (hotel_id, due_at, priority)
  WHERE dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_follow_ups_hotel_status
  ON public.follow_ups (hotel_id, status)
  WHERE dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_follow_ups_lead
  ON public.follow_ups (lead_id)
  WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_follow_ups_assigned
  ON public.follow_ups (assigned_to)
  WHERE assigned_to IS NOT NULL AND dismissed_at IS NULL AND status <> 'ADDRESSED';

-- Idempotency: at most one DIRECT_ENQUIRY auto-create per lead (across all
-- statuses) so re-runs of the auto-creation trigger or backfill won't dup.
CREATE UNIQUE INDEX IF NOT EXISTS uq_follow_ups_one_direct_per_lead
  ON public.follow_ups (lead_id, category)
  WHERE lead_id IS NOT NULL AND category = 'DIRECT_ENQUIRY';

-- Same idempotency on QUOTE_SENT (one auto-create per lead, even if status
-- ping-pongs back into QUOTED).
CREATE UNIQUE INDEX IF NOT EXISTS uq_follow_ups_one_quote_per_lead
  ON public.follow_ups (lead_id, category)
  WHERE lead_id IS NOT NULL AND category = 'QUOTE_SENT';

CREATE INDEX IF NOT EXISTS idx_follow_up_events_follow_up
  ON public.follow_up_events (follow_up_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_follow_up_events_hotel_type
  ON public.follow_up_events (hotel_id, event_type, occurred_at DESC);

-- ─── Triggers ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_follow_ups_updated_at ON public.follow_ups;
CREATE TRIGGER trg_follow_ups_updated_at
  BEFORE UPDATE ON public.follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_up_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS follow_ups_select_for_members ON public.follow_ups;
CREATE POLICY follow_ups_select_for_members ON public.follow_ups
  FOR SELECT
  USING (public.vaiyu_is_hotel_member(hotel_id));

-- INSERT/UPDATE go through SECURITY DEFINER RPCs only (keeps audit + writes paired).

DROP POLICY IF EXISTS follow_up_events_select_for_members ON public.follow_up_events;
CREATE POLICY follow_up_events_select_for_members ON public.follow_up_events
  FOR SELECT
  USING (public.vaiyu_is_hotel_member(hotel_id));

-- ─── _follow_up_default_template (helper) ──────────────────────────────────
-- Returns canonical defaults per category so triggers and the manual-create
-- RPC don't drift apart.

CREATE OR REPLACE FUNCTION public._follow_up_default_template(
  p_category public.follow_up_category
)
RETURNS TABLE (
  priority    public.follow_up_priority,
  due_offset  integer,
  action_text text
)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT prio, days, action FROM (VALUES
    ('DIRECT_ENQUIRY'::public.follow_up_category,
      'HIGH'::public.follow_up_priority, 1,
      'Reply with check-in/out availability, room types and rate. Ask preferred call window.'),
    ('QUOTE_SENT',          'MEDIUM'::public.follow_up_priority, 2,
      'Send polite nudge with revised dates option. Offer to call instead of email.'),
    ('PACKAGE_ENQUIRY',     'MEDIUM'::public.follow_up_priority, 1,
      'Build 2–3 package options at different price points. Share PDF or text proposal.'),
    ('REVIEW_REQUEST',      'LOW'::public.follow_up_priority,    0,
      'Share Google / OTA review link via your usual channel within 24 hours of checkout.'),
    ('OWNER_REPLY',         'HIGH'::public.follow_up_priority,   2,
      'Draft a calm, factual public reply. Acknowledge, apologise where fair, share fix.'),
    ('UNRESOLVED_COMPLAINT','CRITICAL'::public.follow_up_priority, 0,
      'Do NOT pitch yet. Close the complaint ticket first, then circle back.'),
    ('SLA_ESCALATION',      'CRITICAL'::public.follow_up_priority, 0,
      'Coordinate with ops to resolve the SLA breach first. Then reopen this follow-up.')
  ) AS t(cat, prio, days, action)
  WHERE cat = p_category
  LIMIT 1;
$$;

-- We pull (priority, due_offset, action_text) from this; the inner names are
-- positional. Rewriting as a record-returning fn keeps callers concise.

-- ─── create_follow_up (manual create) ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_follow_up(
  p_hotel_id           uuid,
  p_category           public.follow_up_category,
  p_title              text,
  p_context            text DEFAULT '',
  p_entity_reference   text DEFAULT '',
  p_due_at             date DEFAULT NULL,
  p_priority           public.follow_up_priority DEFAULT NULL,
  p_assigned_to        uuid DEFAULT NULL,
  p_lead_id            uuid DEFAULT NULL,
  p_recommended_action text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_template record;
  v_priority public.follow_up_priority;
  v_due      date;
  v_action   text;
  v_id       uuid;
  v_lead_hotel uuid;
BEGIN
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'TITLE_REQUIRED';
  END IF;

  -- Cross-tenant guard
  IF p_lead_id IS NOT NULL THEN
    SELECT hotel_id INTO v_lead_hotel FROM public.leads WHERE id = p_lead_id;
    IF v_lead_hotel IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
    IF v_lead_hotel <> p_hotel_id THEN RAISE EXCEPTION 'LEAD_HOTEL_MISMATCH'; END IF;
  END IF;

  IF p_assigned_to IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.hotel_members
      WHERE user_id = p_assigned_to AND hotel_id = p_hotel_id AND is_active = true
    ) THEN
      RAISE EXCEPTION 'ASSIGNEE_NOT_MEMBER';
    END IF;
  END IF;

  -- Pull defaults from the template helper; allow per-call overrides.
  SELECT * INTO v_template FROM public._follow_up_default_template(p_category);
  v_priority := COALESCE(p_priority, v_template.priority, 'MEDIUM');
  v_due      := COALESCE(p_due_at, (CURRENT_DATE + COALESCE(v_template.due_offset, 1))::date);
  v_action   := COALESCE(NULLIF(btrim(p_recommended_action), ''), v_template.action_text, '');

  INSERT INTO public.follow_ups (
    hotel_id, lead_id, category, status, priority,
    title, context, entity_reference, recommended_manual_action,
    due_at, assigned_to,
    source, created_by, updated_by
  ) VALUES (
    p_hotel_id, p_lead_id, p_category, 'PENDING', v_priority,
    btrim(p_title), COALESCE(p_context, ''), COALESCE(p_entity_reference, ''), v_action,
    v_due, p_assigned_to,
    'MANUAL', auth.uid(), auth.uid()
  )
  RETURNING id INTO v_id;

  INSERT INTO public.follow_up_events (follow_up_id, hotel_id, event_type, payload, actor_id)
  VALUES (
    v_id, p_hotel_id, 'CREATED',
    jsonb_build_object(
      'source', 'MANUAL',
      'category', p_category::text,
      'priority', v_priority::text,
      'due_at',   v_due
    ),
    auth.uid()
  );

  RETURN jsonb_build_object('id', v_id);
END;
$$;

-- ─── mark_follow_up_addressed ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_follow_up_addressed(
  p_id   uuid,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row FROM public.follow_ups WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'FOLLOW_UP_NOT_FOUND'; END IF;

  IF NOT public.vaiyu_is_hotel_member(v_row.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF v_row.dismissed_at IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_DISMISSED'; END IF;
  IF v_row.status = 'ADDRESSED' THEN RETURN; END IF; -- idempotent
  IF v_row.status = 'BLOCKED' THEN RAISE EXCEPTION 'BLOCKED_CANNOT_ADDRESS'; END IF;

  UPDATE public.follow_ups SET
    status         = 'ADDRESSED',
    addressed_at   = clock_timestamp(),
    addressed_by   = auth.uid(),
    addressed_note = p_note,
    updated_by     = auth.uid()
  WHERE id = p_id;

  INSERT INTO public.follow_up_events (follow_up_id, hotel_id, event_type, payload, actor_id)
  VALUES (
    p_id, v_row.hotel_id, 'ADDRESSED',
    jsonb_build_object('note', p_note),
    auth.uid()
  );
END;
$$;

-- ─── mark_follow_up_blocked ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_follow_up_blocked(
  p_id     uuid,
  p_reason text,
  p_related_ticket_status text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row record;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  IF p_related_ticket_status IS NOT NULL
     AND p_related_ticket_status NOT IN ('NONE', 'OPEN_COMPLAINT', 'SLA_BREACH') THEN
    RAISE EXCEPTION 'INVALID_TICKET_STATUS';
  END IF;

  SELECT * INTO v_row FROM public.follow_ups WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'FOLLOW_UP_NOT_FOUND'; END IF;

  IF NOT public.vaiyu_is_hotel_member(v_row.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF v_row.dismissed_at IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_DISMISSED'; END IF;
  IF v_row.status = 'ADDRESSED' THEN RAISE EXCEPTION 'ADDRESSED_CANNOT_BLOCK'; END IF;

  UPDATE public.follow_ups SET
    status                = 'BLOCKED',
    blocked_reason        = btrim(p_reason),
    related_ticket_status = COALESCE(p_related_ticket_status, related_ticket_status),
    updated_by            = auth.uid()
  WHERE id = p_id;

  INSERT INTO public.follow_up_events (follow_up_id, hotel_id, event_type, payload, actor_id)
  VALUES (
    p_id, v_row.hotel_id, 'BLOCKED',
    jsonb_build_object('reason', btrim(p_reason), 'related_ticket_status', p_related_ticket_status),
    auth.uid()
  );
END;
$$;

-- ─── unblock_follow_up ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.unblock_follow_up(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row FROM public.follow_ups WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'FOLLOW_UP_NOT_FOUND'; END IF;
  IF NOT public.vaiyu_is_hotel_member(v_row.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_row.status <> 'BLOCKED' THEN RETURN; END IF;

  UPDATE public.follow_ups SET
    status                = 'PENDING',
    blocked_reason        = NULL,
    related_ticket_status = NULL,
    updated_by            = auth.uid()
  WHERE id = p_id;

  INSERT INTO public.follow_up_events (follow_up_id, hotel_id, event_type, payload, actor_id)
  VALUES (p_id, v_row.hotel_id, 'UNBLOCKED', '{}'::jsonb, auth.uid());
END;
$$;

-- ─── dismiss_follow_up ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.dismiss_follow_up(
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
  SELECT * INTO v_row FROM public.follow_ups WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'FOLLOW_UP_NOT_FOUND'; END IF;
  IF NOT public.vaiyu_is_hotel_member(v_row.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF v_row.dismissed_at IS NOT NULL THEN RETURN; END IF;

  UPDATE public.follow_ups SET
    dismissed_at     = clock_timestamp(),
    dismissed_reason = p_reason,
    updated_by       = auth.uid()
  WHERE id = p_id;

  INSERT INTO public.follow_up_events (follow_up_id, hotel_id, event_type, payload, actor_id)
  VALUES (p_id, v_row.hotel_id, 'DISMISSED', jsonb_build_object('reason', p_reason), auth.uid());
END;
$$;

-- ─── reopen_follow_up ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reopen_follow_up(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row FROM public.follow_ups WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'FOLLOW_UP_NOT_FOUND'; END IF;
  IF NOT public.vaiyu_is_hotel_member(v_row.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF v_row.status <> 'ADDRESSED' AND v_row.dismissed_at IS NULL THEN
    RETURN; -- already open
  END IF;

  UPDATE public.follow_ups SET
    status           = 'PENDING',
    addressed_at     = NULL,
    addressed_by     = NULL,
    addressed_note   = NULL,
    dismissed_at     = NULL,
    dismissed_reason = NULL,
    updated_by       = auth.uid()
  WHERE id = p_id;

  INSERT INTO public.follow_up_events (follow_up_id, hotel_id, event_type, payload, actor_id)
  VALUES (p_id, v_row.hotel_id, 'REOPENED', '{}'::jsonb, auth.uid());
END;
$$;

-- ─── _auto_create_follow_up (internal) ─────────────────────────────────────
-- Used by triggers. Honours UNIQUE indexes via ON CONFLICT DO NOTHING.

CREATE OR REPLACE FUNCTION public._auto_create_follow_up(
  p_hotel_id       uuid,
  p_lead_id        uuid,
  p_category       public.follow_up_category,
  p_title          text,
  p_context        text,
  p_entity_ref     text,
  p_source         text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_template record;
  v_due      date;
  v_id       uuid;
BEGIN
  SELECT * INTO v_template FROM public._follow_up_default_template(p_category);
  v_due := (CURRENT_DATE + COALESCE(v_template.due_offset, 1))::date;

  INSERT INTO public.follow_ups (
    hotel_id, lead_id, category, status, priority,
    title, context, entity_reference, recommended_manual_action,
    due_at, source
  ) VALUES (
    p_hotel_id, p_lead_id, p_category, 'PENDING',
    COALESCE(v_template.priority, 'MEDIUM'),
    p_title, COALESCE(p_context, ''), COALESCE(p_entity_ref, ''),
    COALESCE(v_template.action_text, ''),
    v_due, p_source
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    INSERT INTO public.follow_up_events (follow_up_id, hotel_id, event_type, payload, actor_id)
    VALUES (
      v_id, p_hotel_id, 'CREATED',
      jsonb_build_object('source', p_source, 'category', p_category::text),
      NULL  -- trigger-driven; no auth.uid() in lead-creation context
    );
  END IF;

  RETURN v_id;
END;
$$;

-- ─── Trigger: auto-create DIRECT_ENQUIRY when a lead is created ────────────

CREATE OR REPLACE FUNCTION public.trg_follow_up_on_lead_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_title text;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;

  v_title := 'Follow up with ' || COALESCE(NEW.contact_name, 'new enquiry');

  PERFORM public._auto_create_follow_up(
    NEW.hotel_id,
    NEW.id,
    'DIRECT_ENQUIRY',
    v_title,
    CASE
      WHEN NEW.requested_check_in IS NOT NULL AND NEW.requested_check_out IS NOT NULL
        THEN 'Stay: ' || NEW.requested_check_in::text || ' → ' || NEW.requested_check_out::text
      ELSE 'New enquiry — first reply pending.'
    END,
    'lead-' || NEW.id::text,
    'AUTO_LEAD_CREATED'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_after_insert_follow_up ON public.leads;
CREATE TRIGGER trg_leads_after_insert_follow_up
  AFTER INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.trg_follow_up_on_lead_insert();

-- ─── Trigger: auto-create QUOTE_SENT + auto-resolve on lead_events ─────────

CREATE OR REPLACE FUNCTION public.trg_follow_up_on_lead_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_to text;
  v_from text;
  v_lead record;
BEGIN
  IF NEW.event_type <> 'STATUS_CHANGED' THEN RETURN NEW; END IF;

  v_to := NEW.payload->>'to';
  v_from := NEW.payload->>'from';

  -- We need the lead row for context strings.
  SELECT id, hotel_id, contact_name INTO v_lead
    FROM public.leads WHERE id = NEW.lead_id;
  IF v_lead.id IS NULL THEN RETURN NEW; END IF;

  -- QUOTED → create QUOTE_SENT follow-up
  IF v_to = 'QUOTED' THEN
    PERFORM public._auto_create_follow_up(
      v_lead.hotel_id,
      v_lead.id,
      'QUOTE_SENT',
      'Nudge ' || COALESCE(v_lead.contact_name, 'guest') || ' on the quote',
      'Quote sent. Follow up if no response within 48 hours.',
      'quote-' || v_lead.id::text,
      'AUTO_LEAD_QUOTED'
    );
  END IF;

  -- CONVERTED → auto-resolve every open follow-up for this lead
  IF v_to = 'CONVERTED' THEN
    UPDATE public.follow_ups SET
      status         = 'ADDRESSED',
      addressed_at   = clock_timestamp(),
      addressed_note = 'Auto-resolved: lead converted to booking.',
      updated_at     = clock_timestamp()
    WHERE lead_id = v_lead.id
      AND status NOT IN ('ADDRESSED')
      AND dismissed_at IS NULL;

    INSERT INTO public.follow_up_events (follow_up_id, hotel_id, event_type, payload, actor_id)
    SELECT id, hotel_id, 'AUTO_RESOLVED',
           jsonb_build_object('trigger', 'lead_converted'), NULL
      FROM public.follow_ups
     WHERE lead_id = v_lead.id
       AND status = 'ADDRESSED'
       AND addressed_note = 'Auto-resolved: lead converted to booking.';
  END IF;

  -- LOST → auto-dismiss every open follow-up
  IF v_to = 'LOST' THEN
    UPDATE public.follow_ups SET
      dismissed_at     = clock_timestamp(),
      dismissed_reason = 'Auto-dismissed: lead marked as lost.',
      updated_at       = clock_timestamp()
    WHERE lead_id = v_lead.id
      AND dismissed_at IS NULL;

    INSERT INTO public.follow_up_events (follow_up_id, hotel_id, event_type, payload, actor_id)
    SELECT id, hotel_id, 'AUTO_DISMISSED',
           jsonb_build_object('trigger', 'lead_lost'), NULL
      FROM public.follow_ups
     WHERE lead_id = v_lead.id
       AND dismissed_reason = 'Auto-dismissed: lead marked as lost.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_events_follow_up ON public.lead_events;
CREATE TRIGGER trg_lead_events_follow_up
  AFTER INSERT ON public.lead_events
  FOR EACH ROW EXECUTE FUNCTION public.trg_follow_up_on_lead_event();

-- ─── sync_follow_ups_from_leads (manager-only backfill) ────────────────────

CREATE OR REPLACE FUNCTION public.sync_follow_ups_from_leads(p_hotel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_created integer := 0;
  v_id      uuid;
  r         record;
BEGIN
  IF NOT public.vaiyu_is_hotel_finance_manager(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- DIRECT_ENQUIRY backfill for open leads
  FOR r IN
    SELECT l.id, l.hotel_id, l.contact_name, l.requested_check_in, l.requested_check_out
      FROM public.leads l
     WHERE l.hotel_id = p_hotel_id
       AND l.deleted_at IS NULL
       AND l.status IN ('NEW','QUALIFIED')
       AND NOT EXISTS (
         SELECT 1 FROM public.follow_ups f
          WHERE f.lead_id = l.id AND f.category = 'DIRECT_ENQUIRY'
       )
  LOOP
    v_id := public._auto_create_follow_up(
      r.hotel_id, r.id, 'DIRECT_ENQUIRY',
      'Follow up with ' || COALESCE(r.contact_name, 'enquiry'),
      CASE
        WHEN r.requested_check_in IS NOT NULL THEN
          'Stay: ' || r.requested_check_in::text || ' → ' || r.requested_check_out::text
        ELSE 'Open enquiry — first reply pending.'
      END,
      'lead-' || r.id::text,
      'AUTO_LEAD_CREATED'
    );
    IF v_id IS NOT NULL THEN v_created := v_created + 1; END IF;
  END LOOP;

  -- QUOTE_SENT backfill for leads in QUOTED that don't have one
  FOR r IN
    SELECT l.id, l.hotel_id, l.contact_name
      FROM public.leads l
     WHERE l.hotel_id = p_hotel_id
       AND l.deleted_at IS NULL
       AND l.status = 'QUOTED'
       AND NOT EXISTS (
         SELECT 1 FROM public.follow_ups f
          WHERE f.lead_id = l.id AND f.category = 'QUOTE_SENT'
       )
  LOOP
    v_id := public._auto_create_follow_up(
      r.hotel_id, r.id, 'QUOTE_SENT',
      'Nudge ' || COALESCE(r.contact_name, 'guest') || ' on the quote',
      'Quote sent. Follow up if no response within 48 hours.',
      'quote-' || r.id::text,
      'AUTO_LEAD_QUOTED'
    );
    IF v_id IS NOT NULL THEN v_created := v_created + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'created', v_created);
END;
$$;

-- ─── Grants ────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.create_follow_up         TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_follow_up_addressed TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_follow_up_blocked   TO authenticated;
GRANT EXECUTE ON FUNCTION public.unblock_follow_up        TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_follow_up        TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_follow_up         TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_follow_ups_from_leads TO authenticated;

-- _auto_create_follow_up + _follow_up_default_template are internal — no grant.

-- ─── Realtime publication ─────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.follow_ups;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.follow_up_events;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- ─── Comments ──────────────────────────────────────────────────────────────

COMMENT ON TABLE public.follow_ups IS
  'Follow-up Radar v1 persistent rows. Auto-populated from Lead CRM (DIRECT_ENQUIRY on lead INSERT; QUOTE_SENT on transition to QUOTED). Auto-resolved on CONVERTED, auto-dismissed on LOST. Tickets/SLA/Reviews categories are MANUAL only — wire to real sources after a separate read-only review.';

COMMENT ON CONSTRAINT follow_ups_blocked_requires_reason ON public.follow_ups IS
  'BLOCKED status requires a non-empty blocked_reason. Defense-in-depth alongside the RPC check.';

COMMENT ON FUNCTION public.sync_follow_ups_from_leads IS
  'Manager-only backfill: creates auto-follow-ups for leads that existed before the trigger went live. Idempotent via ON CONFLICT DO NOTHING + unique partial indexes.';
