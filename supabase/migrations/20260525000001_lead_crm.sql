-- Lead Generation CRM — v2 schema (Position 1 of the growth sheet)
--
-- Per CLAUDE.md: this is a hospitality conversion orchestration layer,
-- not a generic CRM. Lifecycle is hospitality-specific:
--
--   NEW → QUALIFIED → QUOTED → WON → CONVERTED
--                                ↘ LOST (terminal from any non-terminal state)
--
--   WON       = guest committed (verbal / email / contract). Booking may not exist yet.
--   CONVERTED = booking row created and linked. Lead is closed in the books.
--
-- Audit/timeline lives in `lead_events` (mirrors the `ticket_events` pattern,
-- not the generic `va_audit_logs` table — timeline is a first-class UI surface).
-- Current state is denormalized on `leads.status` for fast queries; events are
-- the append-only history.
--
-- Multi-tenant via RLS on `hotel_members`. Staff collisions handled via an
-- optimistic claim lock (claimed_by / claimed_at, 15-minute auto-expire) rather
-- than a privacy/visibility config.
--
-- Transitions are enforced in RPCs (next migration). CHECK constraints here
-- enforce only per-row invariants (CHECK cannot see OLD row).

-- ─── Enums ──────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.lead_status AS ENUM (
    'NEW', 'QUALIFIED', 'QUOTED', 'WON', 'CONVERTED', 'LOST'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.lead_source AS ENUM (
    'GOOGLE', 'WEBSITE', 'INSTAGRAM', 'FACEBOOK',
    'OTA', 'WALK_IN', 'REFERRAL',
    'AGENT', 'CORPORATE', 'WEDDING', 'GROUP', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.lead_event_type AS ENUM (
    'CREATED', 'STATUS_CHANGED',
    'ASSIGNED', 'UNASSIGNED',
    'CLAIMED', 'CLAIM_RELEASED',
    'NOTE_ADDED', 'TAG_ADDED', 'TAG_REMOVED',
    'CONTACT_UPDATED', 'QUOTE_SENT',
    'CONVERTED_TO_BOOKING',
    'SOFT_DELETED', 'REOPENED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── leads ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.leads (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id              uuid NOT NULL REFERENCES public.hotels(id) ON DELETE RESTRICT,

  -- Source attribution (source enum immutable post-insert; enforced in RPC)
  source                public.lead_source NOT NULL,
  source_detail         text,
  partner_id            uuid,  -- FK added later when partners table exists

  -- Contact
  contact_name          text NOT NULL,
  contact_phone         text,
  contact_email         text,

  -- Stay request
  requested_check_in    date,
  requested_check_out   date,
  party_adults          integer DEFAULT 1 CHECK (party_adults >= 0),
  party_children        integer DEFAULT 0 CHECK (party_children >= 0),
  room_count            integer DEFAULT 1 CHECK (room_count >= 1),
  value_estimate        numeric(10,2),

  -- Lifecycle (denormalized current state; transitions via RPC)
  status                public.lead_status NOT NULL DEFAULT 'NEW',
  status_reason         text,
  assigned_to           uuid REFERENCES auth.users(id),

  -- Optimistic claim lock — "currently being worked by"
  -- A claim is "active" iff claimed_by IS NOT NULL AND claimed_at > now() - interval '15 minutes'
  claimed_by            uuid REFERENCES auth.users(id),
  claimed_at            timestamptz,

  -- Conversion bookkeeping
  converted_booking_id  uuid REFERENCES public.bookings(id),
  won_at                timestamptz,        -- first time the lead hit WON (does NOT clear on later LOST)
  converted_at          timestamptz,

  -- Free-form
  notes                 text,
  tags                  text[] DEFAULT '{}',

  -- Timestamps
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES auth.users(id),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  last_activity_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,

  -- Per-row invariants only
  CONSTRAINT leads_dates_valid CHECK (
    requested_check_in IS NULL OR requested_check_out IS NULL
    OR requested_check_out > requested_check_in
  ),
  CONSTRAINT leads_contact_min CHECK (
    contact_phone IS NOT NULL OR contact_email IS NOT NULL
  ),
  CONSTRAINT leads_lost_needs_reason CHECK (
    status <> 'LOST' OR status_reason IS NOT NULL
  ),
  CONSTRAINT leads_converted_needs_booking CHECK (
    status <> 'CONVERTED' OR converted_booking_id IS NOT NULL
  )
);

-- ─── lead_events (append-only timeline) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.lead_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  hotel_id    uuid NOT NULL REFERENCES public.hotels(id),  -- denormalized so realtime can filter by hotel
  event_type  public.lead_event_type NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}',
  -- payload shape per event_type:
  --   STATUS_CHANGED:        { from: 'NEW', to: 'QUALIFIED', reason: null }
  --   ASSIGNED:              { to_user: <uuid>, by_user: <uuid> }
  --   UNASSIGNED:            { from_user: <uuid>, by_user: <uuid> }
  --   CLAIMED:               { by_user: <uuid>, expires_at: <ts> }
  --   CLAIM_RELEASED:        { by_user: <uuid>, manual: true|false }
  --   NOTE_ADDED:            { text: '...' }
  --   TAG_ADDED/REMOVED:     { tag: '...' }
  --   CONTACT_UPDATED:       { changes: { phone: [old,new], ... } }
  --   QUOTE_SENT:            { quote_id: <uuid>, channel: 'EMAIL'|'WHATSAPP' }
  --   CONVERTED_TO_BOOKING:  { booking_id: <uuid>, booking_code: '...' }
  --   SOFT_DELETED / REOPENED: { reason: '...' }
  actor_id    uuid REFERENCES auth.users(id),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

-- ─── bookings backlink ─────────────────────────────────────────────────────

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.leads(id);

-- ─── Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_leads_hotel_status
  ON public.leads (hotel_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_assigned
  ON public.leads (assigned_to)
  WHERE deleted_at IS NULL AND status NOT IN ('CONVERTED','LOST');

CREATE INDEX IF NOT EXISTS idx_leads_last_activity
  ON public.leads (hotel_id, last_activity_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_dupcheck
  ON public.leads (hotel_id, contact_phone)
  WHERE deleted_at IS NULL AND contact_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_converted
  ON public.leads (converted_booking_id)
  WHERE converted_booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_claimed
  ON public.leads (claimed_by, claimed_at)
  WHERE claimed_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_events_lead
  ON public.lead_events (lead_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_events_hotel_type
  ON public.lead_events (hotel_id, event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_bookings_lead_id
  ON public.bookings (lead_id)
  WHERE lead_id IS NOT NULL;

-- ─── Triggers ──────────────────────────────────────────────────────────────

-- Reuse the existing project-wide set_updated_at() function (also used on hotels, etc.)
DROP TRIGGER IF EXISTS trg_leads_updated_at ON public.leads;
CREATE TRIGGER trg_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Stamp created_by from auth.uid() on insert if the caller didn't provide it.
CREATE OR REPLACE FUNCTION public.stamp_lead_creator()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_creator ON public.leads;
CREATE TRIGGER trg_leads_creator
  BEFORE INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.stamp_lead_creator();

-- ─── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_events ENABLE ROW LEVEL SECURITY;

-- All hotel members can read all hotel leads. Collision prevention lives in
-- the app layer (claim lock), not RLS. If a hotel later needs hard privacy
-- between staff, add hotel_settings.lead_visibility_mode then.
DROP POLICY IF EXISTS leads_select_for_members ON public.leads;
CREATE POLICY leads_select_for_members ON public.leads
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.hotel_members hm
      WHERE hm.hotel_id = leads.hotel_id
        AND hm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS leads_insert_for_members ON public.leads;
CREATE POLICY leads_insert_for_members ON public.leads
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hotel_members hm
      WHERE hm.hotel_id = leads.hotel_id
        AND hm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS leads_update_for_members ON public.leads;
CREATE POLICY leads_update_for_members ON public.leads
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.hotel_members hm
      WHERE hm.hotel_id = leads.hotel_id
        AND hm.user_id = auth.uid()
    )
  );

-- No DELETE policy — hard-delete is blocked. Soft-delete via RPC sets deleted_at.

DROP POLICY IF EXISTS lead_events_select_for_members ON public.lead_events;
CREATE POLICY lead_events_select_for_members ON public.lead_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.hotel_members hm
      WHERE hm.hotel_id = lead_events.hotel_id
        AND hm.user_id = auth.uid()
    )
  );

-- lead_events INSERT only via SECURITY DEFINER RPCs (next migration). No policy.
-- lead_events has no UPDATE/DELETE policies — append-only by design.

-- ─── Realtime publication ─────────────────────────────────────────────────

-- Add lead_events to the supabase_realtime publication so the frontend can
-- subscribe to the timeline. Filtered client-side by hotel_id + event_type.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_events;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- ─── Comments ──────────────────────────────────────────────────────────────

COMMENT ON TABLE public.leads IS
  'Hospitality leads pipeline. Lifecycle: NEW→QUALIFIED→QUOTED→WON→CONVERTED, with LOST reachable from any non-terminal state. WON = verbal commit; CONVERTED = booking exists. State transitions enforced in transition_lead_status RPC, not CHECK constraints.';

COMMENT ON TABLE public.lead_events IS
  'Append-only timeline for leads. Mirrors ticket_events pattern. Every state-mutating lead RPC writes a row here. Drives both the timeline UI and realtime subscriptions.';

COMMENT ON COLUMN public.leads.claimed_at IS
  'Optimistic claim lock. A claim is active iff claimed_at > now() - interval ''15 minutes''. Released by RPC or expires implicitly.';

COMMENT ON COLUMN public.leads.won_at IS
  'First time this lead reached WON status. Preserved even if later moved to LOST — query current state via leads.status, not via won_at IS NOT NULL.';
