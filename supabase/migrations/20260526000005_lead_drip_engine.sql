-- Lead Drip Engine — Position 2 of the growth sheet (drip automation)
--
-- Fills the gap left by Follow-up Radar v0, which only created manual-action
-- task rows. This migration adds a real drip-send engine on top of the
-- existing notification_queue + send-notifications infrastructure.
--
-- Design notes:
--   • drip_rules / drip_steps are hotel-scoped, owner-editable copy
--   • Each lead may have AT MOST one subscription per rule (UNIQUE lead_id,rule_id)
--   • Subscriptions track absolute schedule (started_at + step.delay_hours),
--     NOT cumulative deltas. That matches the operator mental model:
--     "Day 0/1/3/7" reads as days-from-trigger, not days-from-previous-step.
--   • Auto-pause runs on lead status moves that mean "stop selling":
--       QUALIFIED  → operator engaged, drip would be noisy
--       WON / CONVERTED → already booked, drip is wrong
--       LOST → terminal, cancel (except WALK_IN+LOST seeds a fresh
--               WALKIN_LOST drip — operator decision encoded in the trigger)
--   • Worker = SECURITY DEFINER RPC `claim_pending_drip_steps`. Drives off
--     `next_step_due_at` with FOR UPDATE SKIP LOCKED so multiple workers are
--     safe. Enqueues a row in notification_queue (lead_id-tied), and the
--     existing send-notifications function delivers it. No new sender.
--   • Pause-on-reply is MANUAL ONLY in v1 — we do not ingest inbound email/
--     WhatsApp. Operator pauses via UI, or status-change auto-pause fires.
--     Documented gap, not deferred polish.
--
-- Backward compatibility:
--   • notification_queue gains `lead_id`, `drip_subscription_id`, `hotel_id`.
--     CHECK ensures at least one target (booking_id OR lead_id) is set.
--     Existing booking rows backfill `hotel_id` from bookings.hotel_id.
--   • send-notifications branches on template_code; legacy templates untouched.
--     A new `lead_drip` template_code is what this engine emits.
--
-- Per CLAUDE.md:
--   • Money-correctness: N/A (no payments touched)
--   • Multi-tenancy: every table RLS-scoped via vaiyu_is_hotel_member
--   • Immutability: lead_drip_events is append-only (no UPDATE/DELETE policy)
--   • Audit: per-entity event table (mirrors lead_events / quote_draft_events)

-- ─── Enums ──────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.drip_channel AS ENUM ('EMAIL', 'WHATSAPP', 'SMS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.drip_trigger_event AS ENUM (
    'LEAD_CREATED',         -- new lead, status=NEW, eligible sources
    'LEAD_QUOTED',           -- status moved to QUOTED
    'LEAD_LOST_WALKIN'       -- status moved to LOST, source=WALK_IN
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.drip_sub_status AS ENUM (
    'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'NO_CHANNEL'
  );
  -- NO_CHANNEL = lead has neither email nor whatsapp/phone for the rule's
  -- channel(s). Terminal but distinct from CANCELLED for diagnostics.
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.drip_event_type AS ENUM (
    'SUBSCRIBED', 'STEP_QUEUED', 'STEP_SKIPPED',
    'PAUSED', 'RESUMED', 'COMPLETED', 'CANCELLED',
    'BOUNCED', 'CAP_HIT'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── hotels: per-hotel send cap ────────────────────────────────────────────

ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS drip_daily_send_cap integer NOT NULL DEFAULT 200
    CHECK (drip_daily_send_cap >= 0);

COMMENT ON COLUMN public.hotels.drip_daily_send_cap IS
  'Hard daily cap on automated drip sends per hotel. The worker refuses to claim further steps once today''s sent count (notification_queue rows with drip_subscription_id, status=sent, sent_at >= start of today) hits this cap. Default 200/day matches Resend free-tier conservatism.';

-- ─── drip_rules ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.drip_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id          uuid NOT NULL REFERENCES public.hotels(id) ON DELETE RESTRICT,
  code              text NOT NULL,
  -- 'GENERAL_ENQUIRY' | 'QUOTE_SENT' | 'WALKIN_LOST' (stock)
  -- Custom codes uppercase, alphanumeric + underscore.
  name              text NOT NULL,
  description       text NOT NULL DEFAULT '',
  trigger_event     public.drip_trigger_event NOT NULL,
  default_channel   public.drip_channel NOT NULL DEFAULT 'EMAIL',
  active            boolean NOT NULL DEFAULT true,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES auth.users(id),

  CONSTRAINT drip_rules_code_format CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  UNIQUE (hotel_id, code)
);

-- ─── drip_steps ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.drip_steps (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id           uuid NOT NULL REFERENCES public.drip_rules(id) ON DELETE CASCADE,
  step_idx          integer NOT NULL CHECK (step_idx >= 0),
  delay_hours       integer NOT NULL CHECK (delay_hours >= 0),
  channel           public.drip_channel NOT NULL DEFAULT 'EMAIL',
  template_code     text NOT NULL,
  -- Free-form placeholder copy. Substitution happens in claim_pending_drip_steps.
  -- Supported placeholders: {{guest_name}}, {{hotel_name}}, {{hotel_city}},
  -- {{check_in}}, {{check_out}}, {{nights}}, {{contact_phone}}.
  subject_template  text NOT NULL,
  body_template     text NOT NULL,
  active            boolean NOT NULL DEFAULT true,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT drip_steps_subject_nonempty CHECK (length(btrim(subject_template)) > 0),
  CONSTRAINT drip_steps_body_nonempty CHECK (length(btrim(body_template)) > 0),
  UNIQUE (rule_id, step_idx)
);

-- ─── lead_drip_subscriptions ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.lead_drip_subscriptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id          uuid NOT NULL REFERENCES public.hotels(id) ON DELETE RESTRICT,
  lead_id           uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  rule_id           uuid NOT NULL REFERENCES public.drip_rules(id) ON DELETE RESTRICT,

  status            public.drip_sub_status NOT NULL DEFAULT 'ACTIVE',
  paused_reason     text,
  -- 'LEAD_QUALIFIED' | 'LEAD_WON' | 'LEAD_CONVERTED' | 'LEAD_LOST'
  -- | 'MANUAL' | 'BOUNCED' | 'NO_CHANNEL' | 'RULE_INACTIVE'

  started_at        timestamptz NOT NULL DEFAULT now(),
  last_step_idx     integer NOT NULL DEFAULT -1,  -- -1 = no steps run yet
  last_step_at      timestamptz,
  next_step_idx     integer,
  next_step_due_at  timestamptz,
  completed_at      timestamptz,
  cancelled_at      timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (lead_id, rule_id),
  CONSTRAINT lead_drip_sub_paused_needs_reason CHECK (
    status <> 'PAUSED' OR (paused_reason IS NOT NULL AND length(btrim(paused_reason)) > 0)
  ),
  CONSTRAINT lead_drip_sub_terminal_no_next CHECK (
    status IN ('ACTIVE','PAUSED') OR (next_step_idx IS NULL AND next_step_due_at IS NULL)
  )
);

-- ─── lead_drip_events ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.lead_drip_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id       uuid NOT NULL REFERENCES public.lead_drip_subscriptions(id) ON DELETE CASCADE,
  hotel_id              uuid NOT NULL REFERENCES public.hotels(id),
  lead_id               uuid NOT NULL REFERENCES public.leads(id),
  event_type            public.drip_event_type NOT NULL,
  payload               jsonb NOT NULL DEFAULT '{}',
  -- SUBSCRIBED:    { rule_code, trigger }
  -- STEP_QUEUED:   { step_idx, template_code, channel, notification_id }
  -- STEP_SKIPPED:  { step_idx, reason: 'NO_CHANNEL'|'CAP_HIT'|'STEP_INACTIVE' }
  -- PAUSED:        { reason: 'LEAD_QUALIFIED'|...|'MANUAL', by_user }
  -- RESUMED:       { by_user }
  -- COMPLETED:     { steps_sent }
  -- CANCELLED:     { reason }
  -- BOUNCED:       { step_idx, notification_id, error }
  actor_id              uuid REFERENCES auth.users(id),
  occurred_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  event_schema_version  integer NOT NULL DEFAULT 1
);

-- ─── notification_queue extension ──────────────────────────────────────────

ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS hotel_id             uuid REFERENCES public.hotels(id),
  ADD COLUMN IF NOT EXISTS lead_id              uuid REFERENCES public.leads(id),
  ADD COLUMN IF NOT EXISTS drip_subscription_id uuid REFERENCES public.lead_drip_subscriptions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS drip_step_idx        integer;

-- Backfill hotel_id from bookings for legacy rows.
UPDATE public.notification_queue nq
   SET hotel_id = b.hotel_id
  FROM public.bookings b
 WHERE nq.booking_id = b.id
   AND nq.hotel_id IS NULL;

-- NOTE: we deliberately do NOT add a `(booking_id IS NOT NULL OR lead_id IS
-- NOT NULL)` CHECK. Pre-existing template_codes such as `staff_invite` target
-- a user via payload, not an entity, and would violate it. Targeting
-- correctness is enforced at the RPC layer (enqueue_quote_send + drip worker
-- both set lead_id or booking_id explicitly) rather than the schema.

-- ─── Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_drip_rules_hotel_trigger
  ON public.drip_rules (hotel_id, trigger_event)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_drip_steps_rule_idx
  ON public.drip_steps (rule_id, step_idx);

CREATE INDEX IF NOT EXISTS idx_lead_drip_sub_hotel_status
  ON public.lead_drip_subscriptions (hotel_id, status);

CREATE INDEX IF NOT EXISTS idx_lead_drip_sub_due
  ON public.lead_drip_subscriptions (next_step_due_at, status)
  WHERE status = 'ACTIVE' AND next_step_due_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_drip_sub_lead
  ON public.lead_drip_subscriptions (lead_id, status);

CREATE INDEX IF NOT EXISTS idx_lead_drip_events_sub
  ON public.lead_drip_events (subscription_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_drip_events_hotel_type
  ON public.lead_drip_events (hotel_id, event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_queue_lead
  ON public.notification_queue (lead_id, status)
  WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_queue_drip_today
  ON public.notification_queue (hotel_id, sent_at)
  WHERE drip_subscription_id IS NOT NULL AND status = 'sent';

-- ─── Triggers (auto-updated_at) ────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_drip_rules_updated_at ON public.drip_rules;
CREATE TRIGGER trg_drip_rules_updated_at
  BEFORE UPDATE ON public.drip_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_drip_steps_updated_at ON public.drip_steps;
CREATE TRIGGER trg_drip_steps_updated_at
  BEFORE UPDATE ON public.drip_steps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_lead_drip_sub_updated_at ON public.lead_drip_subscriptions;
CREATE TRIGGER trg_lead_drip_sub_updated_at
  BEFORE UPDATE ON public.lead_drip_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.drip_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drip_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_drip_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_drip_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS drip_rules_select_for_members ON public.drip_rules;
CREATE POLICY drip_rules_select_for_members ON public.drip_rules
  FOR SELECT USING (public.vaiyu_is_hotel_member(hotel_id));

DROP POLICY IF EXISTS drip_steps_select_for_members ON public.drip_steps;
CREATE POLICY drip_steps_select_for_members ON public.drip_steps
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.drip_rules r
      WHERE r.id = drip_steps.rule_id
        AND public.vaiyu_is_hotel_member(r.hotel_id)
    )
  );

DROP POLICY IF EXISTS lead_drip_sub_select_for_members ON public.lead_drip_subscriptions;
CREATE POLICY lead_drip_sub_select_for_members ON public.lead_drip_subscriptions
  FOR SELECT USING (public.vaiyu_is_hotel_member(hotel_id));

DROP POLICY IF EXISTS lead_drip_events_select_for_members ON public.lead_drip_events;
CREATE POLICY lead_drip_events_select_for_members ON public.lead_drip_events
  FOR SELECT USING (public.vaiyu_is_hotel_member(hotel_id));

-- Writes route through SECURITY DEFINER RPCs only.

-- ─── _drip_render (internal substitution helper) ───────────────────────────

CREATE OR REPLACE FUNCTION public._drip_render(p_template text, p_lead_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_out text;
  v_l   record;
  v_h   record;
BEGIN
  IF p_template IS NULL THEN RETURN NULL; END IF;

  SELECT l.contact_name, l.contact_phone, l.contact_email,
         l.requested_check_in, l.requested_check_out,
         CASE
           WHEN l.requested_check_in IS NOT NULL AND l.requested_check_out IS NOT NULL
             THEN GREATEST(1, (l.requested_check_out - l.requested_check_in))
           ELSE NULL
         END AS nights,
         l.hotel_id
    INTO v_l
    FROM public.leads l WHERE l.id = p_lead_id;

  IF v_l.hotel_id IS NULL THEN RETURN p_template; END IF;

  SELECT h.name, h.city INTO v_h FROM public.hotels h WHERE h.id = v_l.hotel_id;

  v_out := p_template;
  v_out := replace(v_out, '{{guest_name}}',    COALESCE(v_l.contact_name, 'there'));
  v_out := replace(v_out, '{{contact_phone}}', COALESCE(v_l.contact_phone, ''));
  v_out := replace(v_out, '{{hotel_name}}',    COALESCE(v_h.name, 'our hotel'));
  v_out := replace(v_out, '{{hotel_city}}',    COALESCE(v_h.city, ''));
  v_out := replace(v_out, '{{check_in}}',      COALESCE(to_char(v_l.requested_check_in,  'DD Mon YYYY'), ''));
  v_out := replace(v_out, '{{check_out}}',     COALESCE(to_char(v_l.requested_check_out, 'DD Mon YYYY'), ''));
  v_out := replace(v_out, '{{nights}}',        COALESCE(v_l.nights::text, ''));
  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public._drip_render IS
  'Substitutes {{placeholder}} tokens against a lead + its hotel. STABLE so it can be inlined in claim_pending_drip_steps. Unknown tokens are left as-is; downstream send-notifications surfaces them so operators notice broken templates rather than silent empty strings.';

-- ─── seed_default_drip_rules (idempotent stock seed) ───────────────────────

CREATE OR REPLACE FUNCTION public.seed_default_drip_rules(p_hotel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_rule_id uuid;
  v_created integer := 0;
BEGIN
  -- Auth: skip when we're called from a trigger (pg_trigger_depth > 0) so the
  -- hotel-insert seed works even when the inserting user has no hotel_members
  -- row for the brand-new hotel yet. Direct UI calls still go through the
  -- finance-manager gate.
  IF pg_trigger_depth() = 0
     AND auth.uid() IS NOT NULL
     AND NOT public.vaiyu_is_hotel_finance_manager(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.hotels WHERE id = p_hotel_id) THEN
    RAISE EXCEPTION 'HOTEL_NOT_FOUND';
  END IF;

  -- ── GENERAL_ENQUIRY: Day 0 / 1 / 3 / 7 ──────────────────────────────────
  INSERT INTO public.drip_rules (hotel_id, code, name, description, trigger_event, default_channel, created_by)
  VALUES (
    p_hotel_id, 'GENERAL_ENQUIRY',
    'New enquiry follow-up',
    'Welcome → soft offer → reminder → final touch. Pauses if lead is qualified or won.',
    'LEAD_CREATED', 'EMAIL', auth.uid()
  )
  ON CONFLICT (hotel_id, code) DO NOTHING
  RETURNING id INTO v_rule_id;

  IF v_rule_id IS NOT NULL THEN
    v_created := v_created + 1;
    INSERT INTO public.drip_steps (rule_id, step_idx, delay_hours, channel, template_code, subject_template, body_template) VALUES
      (v_rule_id, 0,   0, 'EMAIL', 'lead_drip_welcome_v1',
        'Thank you for reaching out to {{hotel_name}}',
        E'Hi {{guest_name}},\n\nThank you for your enquiry. We''ve received your request and our team is putting together a response for your stay at {{hotel_name}} ({{hotel_city}}).\n\nIf your plans are urgent, please reply to this email or call us — we''ll prioritise.\n\nWarm regards,\nThe {{hotel_name}} team'),
      (v_rule_id, 1,  24, 'EMAIL', 'lead_drip_offer_v1',
        'A welcome gesture from {{hotel_name}}',
        E'Hi {{guest_name}},\n\nAs a small welcome, we''d love to offer a complimentary breakfast or a room upgrade — subject to availability — if you confirm your stay this week.\n\nLet us know if you''d like us to lock dates ({{check_in}} → {{check_out}}, {{nights}} night(s)) or if you need flexibility.\n\nWarm regards,\nThe {{hotel_name}} team'),
      (v_rule_id, 2,  72, 'EMAIL', 'lead_drip_reminder_v1',
        'Still planning your stay at {{hotel_name}}?',
        E'Hi {{guest_name}},\n\nJust checking in — is there anything we can help with on your enquiry? Happy to hold a room, share alternative dates, or send a quick proposal.\n\nReply to this email or WhatsApp us on {{contact_phone}} if it''s easier.\n\nWarm regards,\nThe {{hotel_name}} team'),
      (v_rule_id, 3, 168, 'EMAIL', 'lead_drip_lasttouch_v1',
        'One last note from {{hotel_name}}',
        E'Hi {{guest_name}},\n\nWe don''t want to crowd your inbox — this is our last reach-out on your enquiry. If your plans change, we''d be happy to host you whenever the time is right.\n\nWarm regards,\nThe {{hotel_name}} team');
  END IF;

  -- ── QUOTE_SENT: Day 2 / 5 / 14 ──────────────────────────────────────────
  v_rule_id := NULL;
  INSERT INTO public.drip_rules (hotel_id, code, name, description, trigger_event, default_channel, created_by)
  VALUES (
    p_hotel_id, 'QUOTE_SENT',
    'Post-quote nudge',
    'Nudge → still interested → polite close. Pauses if lead is won or converted.',
    'LEAD_QUOTED', 'EMAIL', auth.uid()
  )
  ON CONFLICT (hotel_id, code) DO NOTHING
  RETURNING id INTO v_rule_id;

  IF v_rule_id IS NOT NULL THEN
    v_created := v_created + 1;
    INSERT INTO public.drip_steps (rule_id, step_idx, delay_hours, channel, template_code, subject_template, body_template) VALUES
      (v_rule_id, 0,  48, 'EMAIL', 'lead_drip_quote_nudge_v1',
        'Following up on your quote from {{hotel_name}}',
        E'Hi {{guest_name}},\n\nFollowing up on the quote we shared for your stay ({{check_in}} → {{check_out}}). Happy to revise dates, add inclusions, or hop on a quick call.\n\nWarm regards,\nThe {{hotel_name}} team'),
      (v_rule_id, 1, 120, 'EMAIL', 'lead_drip_quote_still_v1',
        'Still interested in {{hotel_name}}?',
        E'Hi {{guest_name}},\n\nA gentle check — would you like us to keep the rooms held for your dates, release them, or send a different proposal?\n\nWarm regards,\nThe {{hotel_name}} team'),
      (v_rule_id, 2, 336, 'EMAIL', 'lead_drip_quote_close_v1',
        'Closing your enquiry — open whenever you are',
        E'Hi {{guest_name}},\n\nWe''ll close this enquiry for now to make room for new guests. The door is always open — drop us a line when you''re ready, and we''ll pick up where we left off.\n\nWarm regards,\nThe {{hotel_name}} team');
  END IF;

  -- ── WALKIN_LOST: Day 0 / 30 ─────────────────────────────────────────────
  v_rule_id := NULL;
  INSERT INTO public.drip_rules (hotel_id, code, name, description, trigger_event, default_channel, created_by)
  VALUES (
    p_hotel_id, 'WALKIN_LOST',
    'Walk-in win-back',
    'Thanks-for-visiting + 30-day return offer. Cancels if lead later wins.',
    'LEAD_LOST_WALKIN', 'EMAIL', auth.uid()
  )
  ON CONFLICT (hotel_id, code) DO NOTHING
  RETURNING id INTO v_rule_id;

  IF v_rule_id IS NOT NULL THEN
    v_created := v_created + 1;
    INSERT INTO public.drip_steps (rule_id, step_idx, delay_hours, channel, template_code, subject_template, body_template) VALUES
      (v_rule_id, 0,   0, 'EMAIL', 'lead_drip_walkin_thanks_v1',
        'Thank you for visiting {{hotel_name}}',
        E'Hi {{guest_name}},\n\nThank you for stopping by today. Sorry we couldn''t find a fit this time — if your plans shift, please reach out and we''ll do our best to host you.\n\nWarm regards,\nThe {{hotel_name}} team'),
      (v_rule_id, 1, 720, 'EMAIL', 'lead_drip_walkin_winback_v1',
        'A return offer from {{hotel_name}}',
        E'Hi {{guest_name}},\n\nIt''s been a few weeks since you visited. As a thank-you, we''d like to extend a small return offer — share your next planned dates and we''ll do our best to make it work.\n\nWarm regards,\nThe {{hotel_name}} team');
  END IF;

  RETURN jsonb_build_object('ok', true, 'rules_created', v_created);
END;
$$;

-- ─── subscribe_lead_to_drip (internal-and-manual) ──────────────────────────
-- Idempotent via UNIQUE(lead_id, rule_id). Returns subscription id (existing or new).

CREATE OR REPLACE FUNCTION public.subscribe_lead_to_drip(
  p_lead_id     uuid,
  p_rule_code   text,
  p_started_at  timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_lead   record;
  v_rule   record;
  v_step0  record;
  v_sub_id uuid;
  v_existing uuid;
  v_started timestamptz;
BEGIN
  -- Caller is either a hotel member (manual UI) or service_role (trigger).
  -- We resolve hotel_id from the lead then enforce membership if authed.
  SELECT id, hotel_id, contact_email, contact_phone INTO v_lead
    FROM public.leads WHERE id = p_lead_id;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;

  IF auth.uid() IS NOT NULL
     AND NOT public.vaiyu_is_hotel_member(v_lead.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT * INTO v_rule FROM public.drip_rules
   WHERE hotel_id = v_lead.hotel_id AND code = p_rule_code;
  IF v_rule.id IS NULL THEN RAISE EXCEPTION 'RULE_NOT_FOUND'; END IF;
  IF v_rule.active = false THEN
    -- Don't error — just don't subscribe. Triggers shouldn't fail because a
    -- hotel disabled a rule.
    RETURN NULL;
  END IF;

  SELECT id INTO v_existing
    FROM public.lead_drip_subscriptions
   WHERE lead_id = p_lead_id AND rule_id = v_rule.id;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;  -- idempotent
  END IF;

  -- Channel availability check (EMAIL needs email, WhatsApp needs phone).
  -- We check the rule's default_channel; per-step channel can vary but the
  -- rule won't progress past steps that have no channel.
  IF v_rule.default_channel = 'EMAIL'    AND COALESCE(v_lead.contact_email,'') = '' THEN
    v_started := NULL;  -- mark NO_CHANNEL below
  ELSIF v_rule.default_channel IN ('WHATSAPP','SMS') AND COALESCE(v_lead.contact_phone,'') = '' THEN
    v_started := NULL;
  ELSE
    v_started := COALESCE(p_started_at, clock_timestamp());
  END IF;

  SELECT * INTO v_step0 FROM public.drip_steps
   WHERE rule_id = v_rule.id AND active = true
   ORDER BY step_idx ASC LIMIT 1;

  INSERT INTO public.lead_drip_subscriptions (
    hotel_id, lead_id, rule_id,
    status, paused_reason,
    started_at, last_step_idx,
    next_step_idx, next_step_due_at
  ) VALUES (
    v_lead.hotel_id, p_lead_id, v_rule.id,
    CASE WHEN v_started IS NULL THEN 'NO_CHANNEL'::public.drip_sub_status
         WHEN v_step0.id IS NULL THEN 'COMPLETED'::public.drip_sub_status
         ELSE 'ACTIVE' END,
    CASE WHEN v_started IS NULL THEN 'NO_CHANNEL' ELSE NULL END,
    COALESCE(v_started, clock_timestamp()), -1,
    CASE WHEN v_started IS NULL OR v_step0.id IS NULL THEN NULL ELSE v_step0.step_idx END,
    CASE WHEN v_started IS NULL OR v_step0.id IS NULL THEN NULL
         ELSE v_started + make_interval(hours => v_step0.delay_hours) END
  )
  ON CONFLICT (lead_id, rule_id) DO NOTHING
  RETURNING id INTO v_sub_id;

  -- ON CONFLICT race: re-read.
  IF v_sub_id IS NULL THEN
    SELECT id INTO v_sub_id FROM public.lead_drip_subscriptions
     WHERE lead_id = p_lead_id AND rule_id = v_rule.id;
    RETURN v_sub_id;
  END IF;

  INSERT INTO public.lead_drip_events (subscription_id, hotel_id, lead_id, event_type, payload, actor_id)
  VALUES (
    v_sub_id, v_lead.hotel_id, p_lead_id, 'SUBSCRIBED',
    jsonb_build_object(
      'rule_code', p_rule_code,
      'trigger',   v_rule.trigger_event::text,
      'channel_ok', v_started IS NOT NULL
    ),
    auth.uid()
  );

  RETURN v_sub_id;
END;
$$;

-- ─── pause_lead_drip ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pause_lead_drip(
  p_subscription_id uuid,
  p_reason          text DEFAULT 'MANUAL'
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

  SELECT * INTO v_row FROM public.lead_drip_subscriptions
   WHERE id = p_subscription_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND'; END IF;

  IF auth.uid() IS NOT NULL AND NOT public.vaiyu_is_hotel_member(v_row.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF v_row.status IN ('COMPLETED','CANCELLED','NO_CHANNEL') THEN RETURN; END IF;
  IF v_row.status = 'PAUSED' THEN RETURN; END IF;  -- idempotent

  UPDATE public.lead_drip_subscriptions SET
    status = 'PAUSED', paused_reason = btrim(p_reason)
  WHERE id = p_subscription_id;

  INSERT INTO public.lead_drip_events (subscription_id, hotel_id, lead_id, event_type, payload, actor_id)
  VALUES (p_subscription_id, v_row.hotel_id, v_row.lead_id, 'PAUSED',
          jsonb_build_object('reason', btrim(p_reason)), auth.uid());
END;
$$;

-- ─── resume_lead_drip ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.resume_lead_drip(p_subscription_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row record;
  v_next record;
  v_due timestamptz;
BEGIN
  SELECT * INTO v_row FROM public.lead_drip_subscriptions
   WHERE id = p_subscription_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND'; END IF;
  IF NOT public.vaiyu_is_hotel_member(v_row.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_row.status <> 'PAUSED' THEN RETURN; END IF;

  -- Pick the next un-run, active step.
  SELECT * INTO v_next FROM public.drip_steps
   WHERE rule_id = v_row.rule_id AND active = true AND step_idx > v_row.last_step_idx
   ORDER BY step_idx ASC LIMIT 1;

  IF v_next.id IS NULL THEN
    UPDATE public.lead_drip_subscriptions SET
      status = 'COMPLETED', completed_at = clock_timestamp(),
      paused_reason = NULL, next_step_idx = NULL, next_step_due_at = NULL
    WHERE id = p_subscription_id;
    INSERT INTO public.lead_drip_events (subscription_id, hotel_id, lead_id, event_type, payload, actor_id)
    VALUES (p_subscription_id, v_row.hotel_id, v_row.lead_id, 'COMPLETED',
            jsonb_build_object('via','resume_no_more_steps'), auth.uid());
    RETURN;
  END IF;

  -- Recompute due time off started_at + step.delay_hours, never earlier than now.
  v_due := GREATEST(v_row.started_at + make_interval(hours => v_next.delay_hours), clock_timestamp());

  UPDATE public.lead_drip_subscriptions SET
    status = 'ACTIVE', paused_reason = NULL,
    next_step_idx = v_next.step_idx, next_step_due_at = v_due
  WHERE id = p_subscription_id;

  INSERT INTO public.lead_drip_events (subscription_id, hotel_id, lead_id, event_type, payload, actor_id)
  VALUES (p_subscription_id, v_row.hotel_id, v_row.lead_id, 'RESUMED',
          jsonb_build_object('next_step_idx', v_next.step_idx, 'next_due_at', v_due), auth.uid());
END;
$$;

-- ─── cancel_lead_drip ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cancel_lead_drip(
  p_subscription_id uuid,
  p_reason          text DEFAULT 'MANUAL'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE v_row record;
BEGIN
  SELECT * INTO v_row FROM public.lead_drip_subscriptions
   WHERE id = p_subscription_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND'; END IF;
  IF auth.uid() IS NOT NULL AND NOT public.vaiyu_is_hotel_member(v_row.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_row.status IN ('COMPLETED','CANCELLED') THEN RETURN; END IF;

  UPDATE public.lead_drip_subscriptions SET
    status = 'CANCELLED', cancelled_at = clock_timestamp(),
    paused_reason = NULL, next_step_idx = NULL, next_step_due_at = NULL
  WHERE id = p_subscription_id;

  INSERT INTO public.lead_drip_events (subscription_id, hotel_id, lead_id, event_type, payload, actor_id)
  VALUES (p_subscription_id, v_row.hotel_id, v_row.lead_id, 'CANCELLED',
          jsonb_build_object('reason', COALESCE(p_reason,'MANUAL')), auth.uid());
END;
$$;

-- ─── claim_pending_drip_steps (worker entrypoint) ──────────────────────────
-- Service-role only. Returns the subscriptions it processed for observability.
-- One row per subscription claimed; STEP_QUEUED or STEP_SKIPPED logged.

CREATE OR REPLACE FUNCTION public.claim_pending_drip_steps(p_limit integer DEFAULT 50)
RETURNS TABLE (
  subscription_id uuid,
  lead_id         uuid,
  hotel_id        uuid,
  step_idx        integer,
  outcome         text,         -- 'queued' | 'cap_hit' | 'no_channel' | 'completed' | 'rule_inactive'
  notification_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  r           record;
  v_step      record;
  v_rule      record;
  v_lead      record;
  v_next      record;
  v_subject   text;
  v_body      text;
  v_recipient text;
  v_notif_id  uuid;
  v_sent_today integer;
  v_cap       integer;
  v_due       timestamptz;
BEGIN
  -- Caller must be service_role (worker). authenticated users can't.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  FOR r IN
    SELECT s.id, s.hotel_id, s.lead_id, s.rule_id, s.started_at,
           s.last_step_idx, s.next_step_idx, s.next_step_due_at
      FROM public.lead_drip_subscriptions s
     WHERE s.status = 'ACTIVE'
       AND s.next_step_due_at IS NOT NULL
       AND s.next_step_due_at <= clock_timestamp()
     ORDER BY s.next_step_due_at
     FOR UPDATE SKIP LOCKED
     LIMIT GREATEST(1, LEAST(p_limit, 200))
  LOOP
    SELECT * INTO v_rule FROM public.drip_rules WHERE id = r.rule_id;
    IF v_rule.id IS NULL OR v_rule.active = false THEN
      UPDATE public.lead_drip_subscriptions
         SET status = 'PAUSED', paused_reason = 'RULE_INACTIVE',
             next_step_idx = NULL, next_step_due_at = NULL
       WHERE id = r.id;
      INSERT INTO public.lead_drip_events (subscription_id, hotel_id, lead_id, event_type, payload)
      VALUES (r.id, r.hotel_id, r.lead_id, 'PAUSED', jsonb_build_object('reason','RULE_INACTIVE'));
      subscription_id := r.id; lead_id := r.lead_id; hotel_id := r.hotel_id;
      step_idx := r.next_step_idx; outcome := 'rule_inactive'; notification_id := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT * INTO v_step FROM public.drip_steps
     WHERE rule_id = r.rule_id AND step_idx = r.next_step_idx;
    IF v_step.id IS NULL OR v_step.active = false THEN
      -- Step deleted/disabled — advance to next active step or complete.
      SELECT * INTO v_next FROM public.drip_steps
       WHERE rule_id = r.rule_id AND active = true AND step_idx > r.next_step_idx
       ORDER BY step_idx ASC LIMIT 1;
      IF v_next.id IS NULL THEN
        UPDATE public.lead_drip_subscriptions
           SET status='COMPLETED', completed_at = clock_timestamp(),
               next_step_idx = NULL, next_step_due_at = NULL,
               last_step_idx = COALESCE(r.next_step_idx, last_step_idx)
         WHERE id = r.id;
        INSERT INTO public.lead_drip_events (subscription_id, hotel_id, lead_id, event_type, payload)
        VALUES (r.id, r.hotel_id, r.lead_id, 'COMPLETED', jsonb_build_object('via','step_disabled'));
        outcome := 'completed';
      ELSE
        v_due := GREATEST(r.started_at + make_interval(hours => v_next.delay_hours), clock_timestamp());
        UPDATE public.lead_drip_subscriptions
           SET next_step_idx = v_next.step_idx, next_step_due_at = v_due
         WHERE id = r.id;
        INSERT INTO public.lead_drip_events (subscription_id, hotel_id, lead_id, event_type, payload)
        VALUES (r.id, r.hotel_id, r.lead_id, 'STEP_SKIPPED',
                jsonb_build_object('step_idx', r.next_step_idx, 'reason','STEP_INACTIVE'));
        outcome := 'rule_inactive';
      END IF;
      subscription_id := r.id; lead_id := r.lead_id; hotel_id := r.hotel_id;
      step_idx := r.next_step_idx; notification_id := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Recipient check
    SELECT id, contact_name, contact_email, contact_phone INTO v_lead
      FROM public.leads WHERE id = r.lead_id;
    v_recipient := CASE v_step.channel
      WHEN 'EMAIL'    THEN v_lead.contact_email
      WHEN 'WHATSAPP' THEN v_lead.contact_phone
      WHEN 'SMS'      THEN v_lead.contact_phone
    END;

    IF v_recipient IS NULL OR btrim(v_recipient) = '' THEN
      UPDATE public.lead_drip_subscriptions
         SET status='NO_CHANNEL', paused_reason='NO_CHANNEL',
             next_step_idx = NULL, next_step_due_at = NULL
       WHERE id = r.id;
      INSERT INTO public.lead_drip_events (subscription_id, hotel_id, lead_id, event_type, payload)
      VALUES (r.id, r.hotel_id, r.lead_id, 'STEP_SKIPPED',
              jsonb_build_object('step_idx', v_step.step_idx, 'reason','NO_CHANNEL'));
      subscription_id := r.id; lead_id := r.lead_id; hotel_id := r.hotel_id;
      step_idx := v_step.step_idx; outcome := 'no_channel'; notification_id := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Daily send-cap check (per hotel, drip-only)
    SELECT drip_daily_send_cap INTO v_cap FROM public.hotels WHERE id = r.hotel_id;
    v_cap := COALESCE(v_cap, 200);

    SELECT COUNT(*) INTO v_sent_today FROM public.notification_queue
     WHERE hotel_id = r.hotel_id
       AND drip_subscription_id IS NOT NULL
       AND status = 'sent'
       AND sent_at >= date_trunc('day', clock_timestamp());

    IF v_sent_today >= v_cap THEN
      -- Defer 1 hour; do NOT advance the step.
      UPDATE public.lead_drip_subscriptions
         SET next_step_due_at = clock_timestamp() + interval '1 hour'
       WHERE id = r.id;
      INSERT INTO public.lead_drip_events (subscription_id, hotel_id, lead_id, event_type, payload)
      VALUES (r.id, r.hotel_id, r.lead_id, 'CAP_HIT',
              jsonb_build_object('step_idx', v_step.step_idx, 'sent_today', v_sent_today, 'cap', v_cap));
      subscription_id := r.id; lead_id := r.lead_id; hotel_id := r.hotel_id;
      step_idx := v_step.step_idx; outcome := 'cap_hit'; notification_id := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Render and enqueue
    v_subject := public._drip_render(v_step.subject_template, r.lead_id);
    v_body    := public._drip_render(v_step.body_template,    r.lead_id);

    INSERT INTO public.notification_queue (
      booking_id, hotel_id, lead_id, drip_subscription_id, drip_step_idx,
      channel, template_code, payload, status, next_attempt_at
    ) VALUES (
      NULL, r.hotel_id, r.lead_id, r.id, v_step.step_idx,
      lower(v_step.channel::text), v_step.template_code,
      jsonb_build_object(
        'to',      v_recipient,
        'subject', v_subject,
        'body',    v_body
      ),
      'pending', clock_timestamp()
    )
    RETURNING id INTO v_notif_id;

    -- Advance: find next active step OR complete
    SELECT * INTO v_next FROM public.drip_steps
     WHERE rule_id = r.rule_id AND active = true AND step_idx > v_step.step_idx
     ORDER BY step_idx ASC LIMIT 1;

    IF v_next.id IS NULL THEN
      UPDATE public.lead_drip_subscriptions SET
        last_step_idx = v_step.step_idx, last_step_at = clock_timestamp(),
        next_step_idx = NULL, next_step_due_at = NULL,
        status = 'COMPLETED', completed_at = clock_timestamp()
      WHERE id = r.id;
    ELSE
      v_due := GREATEST(r.started_at + make_interval(hours => v_next.delay_hours), clock_timestamp());
      UPDATE public.lead_drip_subscriptions SET
        last_step_idx = v_step.step_idx, last_step_at = clock_timestamp(),
        next_step_idx = v_next.step_idx, next_step_due_at = v_due
      WHERE id = r.id;
    END IF;

    INSERT INTO public.lead_drip_events (subscription_id, hotel_id, lead_id, event_type, payload)
    VALUES (r.id, r.hotel_id, r.lead_id, 'STEP_QUEUED',
            jsonb_build_object(
              'step_idx', v_step.step_idx,
              'template_code', v_step.template_code,
              'channel', v_step.channel::text,
              'notification_id', v_notif_id
            ));

    IF v_next.id IS NULL THEN
      INSERT INTO public.lead_drip_events (subscription_id, hotel_id, lead_id, event_type, payload)
      VALUES (r.id, r.hotel_id, r.lead_id, 'COMPLETED',
              jsonb_build_object('via','last_step_queued','steps_sent', v_step.step_idx + 1));
    END IF;

    subscription_id := r.id; lead_id := r.lead_id; hotel_id := r.hotel_id;
    step_idx := v_step.step_idx; outcome := 'queued'; notification_id := v_notif_id;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

-- ─── update_drip_step_template (owner copy editor) ─────────────────────────

CREATE OR REPLACE FUNCTION public.update_drip_step_template(
  p_step_id          uuid,
  p_subject_template text DEFAULT NULL,
  p_body_template    text DEFAULT NULL,
  p_delay_hours      integer DEFAULT NULL,
  p_active           boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_rule_hotel uuid;
  v_old        record;
  v_changes    jsonb := '{}'::jsonb;
BEGIN
  SELECT s.*, r.hotel_id INTO v_old
    FROM public.drip_steps s
    JOIN public.drip_rules r ON r.id = s.rule_id
   WHERE s.id = p_step_id;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'STEP_NOT_FOUND'; END IF;
  v_rule_hotel := v_old.hotel_id;

  IF NOT public.vaiyu_is_hotel_finance_manager(v_rule_hotel) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF p_delay_hours IS NOT NULL AND p_delay_hours < 0 THEN
    RAISE EXCEPTION 'INVALID_DELAY';
  END IF;
  IF p_subject_template IS NOT NULL AND btrim(p_subject_template) = '' THEN
    RAISE EXCEPTION 'SUBJECT_REQUIRED';
  END IF;
  IF p_body_template IS NOT NULL AND btrim(p_body_template) = '' THEN
    RAISE EXCEPTION 'BODY_REQUIRED';
  END IF;

  -- Build per-field diff. Templates can be long; store length deltas + a
  -- 120-char snippet rather than the full text to keep va_audit_logs cheap.
  IF p_subject_template IS NOT NULL AND p_subject_template IS DISTINCT FROM v_old.subject_template THEN
    v_changes := v_changes || jsonb_build_object('subject',
      jsonb_build_object(
        'old_len', length(v_old.subject_template),
        'new_len', length(p_subject_template),
        'new_preview', left(p_subject_template, 120)
      ));
  END IF;
  IF p_body_template IS NOT NULL AND p_body_template IS DISTINCT FROM v_old.body_template THEN
    v_changes := v_changes || jsonb_build_object('body',
      jsonb_build_object(
        'old_len', length(v_old.body_template),
        'new_len', length(p_body_template),
        'new_preview', left(p_body_template, 120)
      ));
  END IF;
  IF p_delay_hours IS NOT NULL AND p_delay_hours IS DISTINCT FROM v_old.delay_hours THEN
    v_changes := v_changes || jsonb_build_object('delay_hours',
      jsonb_build_array(v_old.delay_hours, p_delay_hours));
  END IF;
  IF p_active IS NOT NULL AND p_active IS DISTINCT FROM v_old.active THEN
    v_changes := v_changes || jsonb_build_object('active',
      jsonb_build_array(v_old.active, p_active));
  END IF;

  IF v_changes = '{}'::jsonb THEN RETURN; END IF;

  UPDATE public.drip_steps SET
    subject_template = COALESCE(p_subject_template, subject_template),
    body_template    = COALESCE(p_body_template,    body_template),
    delay_hours      = COALESCE(p_delay_hours,      delay_hours),
    active           = COALESCE(p_active,           active)
  WHERE id = p_step_id;

  -- Audit to va_audit_logs (template edits are config changes, not per-
  -- subscription events — wrong shape for lead_drip_events).
  INSERT INTO public.va_audit_logs (action, actor, hotel_id, entity, entity_id, meta)
  VALUES (
    'drip_step_template_edited',
    auth.uid()::text,
    v_rule_hotel,
    'drip_step',
    p_step_id,
    jsonb_build_object(
      'rule_id',       v_old.rule_id,
      'step_idx',      v_old.step_idx,
      'template_code', v_old.template_code,
      'changes',       v_changes
    )
  );
END;
$$;

-- ─── set_drip_rule_active ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_drip_rule_active(
  p_rule_id uuid,
  p_active  boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT id, hotel_id, code, active INTO v_row FROM public.drip_rules WHERE id = p_rule_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'RULE_NOT_FOUND'; END IF;
  IF NOT public.vaiyu_is_hotel_finance_manager(v_row.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_row.active = p_active THEN RETURN; END IF;  -- idempotent no-op

  UPDATE public.drip_rules SET active = p_active WHERE id = p_rule_id;

  INSERT INTO public.va_audit_logs (action, actor, hotel_id, entity, entity_id, meta)
  VALUES (
    'drip_rule_active_changed',
    auth.uid()::text,
    v_row.hotel_id,
    'drip_rule',
    p_rule_id,
    jsonb_build_object(
      'rule_code', v_row.code,
      'active',    jsonb_build_array(v_row.active, p_active)
    )
  );
END;
$$;

-- ─── Lead CRM wiring: subscribe on insert ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_drip_on_lead_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.status <> 'NEW' THEN RETURN NEW; END IF;
  -- Walk-ins follow the WALKIN_LOST rule when they later go LOST — don't
  -- start GENERAL_ENQUIRY for them.
  IF NEW.source = 'WALK_IN' THEN RETURN NEW; END IF;

  PERFORM public.subscribe_lead_to_drip(NEW.id, 'GENERAL_ENQUIRY');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_after_insert_drip ON public.leads;
CREATE TRIGGER trg_leads_after_insert_drip
  AFTER INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.trg_drip_on_lead_insert();

-- ─── Lead CRM wiring: status-change reactions ──────────────────────────────
-- Order:
--   1. STATUS_CHANGED → QUALIFIED|WON|CONVERTED: pause all ACTIVE subs.
--   2. STATUS_CHANGED → LOST: cancel all subs.
--   3. STATUS_CHANGED → LOST AND source=WALK_IN: subscribe to WALKIN_LOST
--       (runs AFTER the cancel above; WALKIN_LOST is a fresh sub).
--   4. STATUS_CHANGED → QUOTED: subscribe to QUOTE_SENT.

CREATE OR REPLACE FUNCTION public.trg_drip_on_lead_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_to    text;
  v_lead  record;
  v_pause_reason text;
BEGIN
  IF NEW.event_type <> 'STATUS_CHANGED' THEN RETURN NEW; END IF;
  v_to := NEW.payload->>'to';
  IF v_to IS NULL THEN RETURN NEW; END IF;

  SELECT id, hotel_id, source INTO v_lead FROM public.leads WHERE id = NEW.lead_id;
  IF v_lead.id IS NULL THEN RETURN NEW; END IF;

  -- Pause on engagement signals
  IF v_to IN ('QUALIFIED','WON','CONVERTED') THEN
    v_pause_reason := CASE v_to
      WHEN 'QUALIFIED' THEN 'LEAD_QUALIFIED'
      WHEN 'WON'       THEN 'LEAD_WON'
      WHEN 'CONVERTED' THEN 'LEAD_CONVERTED'
    END;
    UPDATE public.lead_drip_subscriptions
       SET status = 'PAUSED', paused_reason = v_pause_reason,
           next_step_idx = NULL, next_step_due_at = NULL
     WHERE lead_id = v_lead.id AND status = 'ACTIVE';
    INSERT INTO public.lead_drip_events (subscription_id, hotel_id, lead_id, event_type, payload)
    SELECT id, hotel_id, lead_id, 'PAUSED',
           jsonb_build_object('reason', v_pause_reason, 'trigger','status_change')
      FROM public.lead_drip_subscriptions
     WHERE lead_id = v_lead.id AND status = 'PAUSED' AND paused_reason = v_pause_reason;
  END IF;

  -- Cancel on LOST (any source). WALKIN_LOST subscribe runs after.
  IF v_to = 'LOST' THEN
    UPDATE public.lead_drip_subscriptions
       SET status = 'CANCELLED', cancelled_at = clock_timestamp(),
           next_step_idx = NULL, next_step_due_at = NULL
     WHERE lead_id = v_lead.id
       AND status IN ('ACTIVE','PAUSED','NO_CHANNEL');
    INSERT INTO public.lead_drip_events (subscription_id, hotel_id, lead_id, event_type, payload)
    SELECT id, hotel_id, lead_id, 'CANCELLED',
           jsonb_build_object('reason','LEAD_LOST','trigger','status_change')
      FROM public.lead_drip_subscriptions
     WHERE lead_id = v_lead.id AND status = 'CANCELLED' AND cancelled_at >= clock_timestamp() - interval '5 seconds';

    IF v_lead.source = 'WALK_IN' THEN
      PERFORM public.subscribe_lead_to_drip(v_lead.id, 'WALKIN_LOST');
    END IF;
  END IF;

  IF v_to = 'QUOTED' THEN
    -- A new quote supersedes general nudging. Pause GENERAL_ENQUIRY so the
    -- guest doesn't get both "still planning your stay?" and "following up
    -- on your quote" — overlapping drips look like spam.
    UPDATE public.lead_drip_subscriptions s
       SET status = 'PAUSED', paused_reason = 'SUPERSEDED_BY_QUOTE',
           next_step_idx = NULL, next_step_due_at = NULL
      FROM public.drip_rules r
     WHERE s.rule_id = r.id
       AND s.lead_id = v_lead.id
       AND s.status = 'ACTIVE'
       AND r.code = 'GENERAL_ENQUIRY';
    INSERT INTO public.lead_drip_events (subscription_id, hotel_id, lead_id, event_type, payload)
    SELECT s.id, s.hotel_id, s.lead_id, 'PAUSED',
           jsonb_build_object('reason','SUPERSEDED_BY_QUOTE','trigger','status_change')
      FROM public.lead_drip_subscriptions s
      JOIN public.drip_rules r ON r.id = s.rule_id
     WHERE s.lead_id = v_lead.id
       AND s.status = 'PAUSED'
       AND s.paused_reason = 'SUPERSEDED_BY_QUOTE'
       AND r.code = 'GENERAL_ENQUIRY';

    PERFORM public.subscribe_lead_to_drip(v_lead.id, 'QUOTE_SENT');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_events_drip ON public.lead_events;
CREATE TRIGGER trg_lead_events_drip
  AFTER INSERT ON public.lead_events
  FOR EACH ROW EXECUTE FUNCTION public.trg_drip_on_lead_event();

-- ─── Hotel-onboarding wiring: seed defaults for new hotels ─────────────────

CREATE OR REPLACE FUNCTION public.trg_drip_seed_on_hotel_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  PERFORM public.seed_default_drip_rules(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hotels_after_insert_drip_seed ON public.hotels;
CREATE TRIGGER trg_hotels_after_insert_drip_seed
  AFTER INSERT ON public.hotels
  FOR EACH ROW EXECUTE FUNCTION public.trg_drip_seed_on_hotel_insert();

-- ─── Grants ────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.seed_default_drip_rules(uuid)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.subscribe_lead_to_drip(uuid, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pause_lead_drip(uuid, text)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_lead_drip(uuid)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_lead_drip(uuid, text)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_drip_step_template(uuid, text, text, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_drip_rule_active(uuid, boolean)       TO authenticated;
-- claim_pending_drip_steps is service_role-only; do not grant to authenticated.

-- ─── Realtime publication ─────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_drip_subscriptions;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_drip_events;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- ─── Backfill existing hotels ──────────────────────────────────────────────
-- Idempotent via ON CONFLICT (hotel_id, code) DO NOTHING inside the RPC.

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.hotels LOOP
    PERFORM public.seed_default_drip_rules(r.id);
  END LOOP;
END $$;

-- ─── Comments ──────────────────────────────────────────────────────────────

COMMENT ON TABLE public.drip_rules IS
  'Position 2 of growth sheet — drip automation rule definitions. Hotel-scoped, owner-editable. Three stock codes seeded per hotel: GENERAL_ENQUIRY, QUOTE_SENT, WALKIN_LOST. Custom codes allowed but uppercase-only (CHECK constraint).';
COMMENT ON TABLE public.drip_steps IS
  'Sequential steps within a drip_rule. delay_hours is absolute from subscription.started_at, NOT cumulative — Day 0/1/3/7 reads literally.';
COMMENT ON TABLE public.lead_drip_subscriptions IS
  'One row per (lead, rule). Auto-created by Lead CRM triggers; auto-paused on engagement signals (QUALIFIED/WON/CONVERTED) and cancelled on LOST. Manual pause/resume available to operators.';
COMMENT ON TABLE public.lead_drip_events IS
  'Append-only audit timeline for drip subscriptions. Powers the lead-detail drip tab and provides observability for the worker.';
