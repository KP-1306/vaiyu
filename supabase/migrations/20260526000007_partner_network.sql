-- Partner Network — Position 4 of the growth sheet
--
-- Single `partners` table with a kind discriminator (VENDOR | AGENT). This
-- merges the two product visions surfaced by the inputs:
--   • PO brief: verified-local-vendor directory (taxi/trek/temple/wellness/
--     maintenance). UI-led discovery + verification workflow.
--   • Original sequence doc: commissionable agents (travel agents, corporate
--     bookers, wedding planners) that drive 30-50% of Uttarakhand leisure
--     bookings. Lead-source attribution + manual commission ledger.
--
-- A row's kind controls which columns are populated:
--   VENDOR: contact + verification + services_offered + service_area
--   AGENT:  same as VENDOR plus commission_pct + payout_terms; entries in
--           partner_commissions ledger optional
--
-- The same row can also be a VENDOR you preferred-list AND happen to be an
-- AGENT for one-off bookings — operator picks one kind per row; create two
-- rows if a business plays both roles. Simpler than a many-to-many on kind.
--
-- Liability framing (PO brief literal):
--   This is an internal directory. VAiyu makes no claim of vendor
--   certification, insurance, or service quality. Verification means the
--   hotel team has independently checked the partner — never us.
--
-- Per CLAUDE.md:
--   • RLS hotel-scoped via vaiyu_is_hotel_member (read), finance_manager
--     (mark-commission-paid + status changes that affect money)
--   • Audit: partner_events append-only timeline (mirrors lead_events)
--   • No marketplace, no guest-facing booking, no auto-payouts (PO scope)

-- ─── Enums ──────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.partner_kind AS ENUM ('VENDOR', 'AGENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.partner_category AS ENUM (
    -- Agent-flavoured (kind=AGENT)
    'TRAVEL_AGENT', 'CORPORATE_BOOKER', 'WEDDING_PLANNER', 'GROUP_BOOKER',
    -- Vendor-flavoured (kind=VENDOR)
    'TAXI_TRANSPORT', 'TREK_GUIDE', 'TEMPLE_TOUR', 'SAFARI_ADVENTURE',
    'PHOTOGRAPHER', 'EVENT_DECORATION', 'WELLNESS_YOGA', 'FOOD_CATERING',
    'LAUNDRY_OPS', 'MAINTENANCE_VENDOR',
    -- Catch-all
    'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.partner_status AS ENUM (
    'DRAFT', 'VERIFIED', 'PREFERRED', 'BACKUP', 'INACTIVE', 'DO_NOT_USE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.partner_verification_status AS ENUM (
    'UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED'
  );
  -- "STALE" is derived, not stored — see v_partner_directory view below.
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.partner_event_type AS ENUM (
    'CREATED', 'UPDATED',
    'STATUS_CHANGED', 'VERIFICATION_CHANGED',
    'ARCHIVED', 'UNARCHIVED',
    'COMMISSION_RECORDED', 'COMMISSION_PAID', 'COMMISSION_CANCELLED',
    'LINKED_TO_LEAD'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.partner_commission_status AS ENUM (
    'ACCRUED', 'PAID', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── partners ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.partners (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id              uuid NOT NULL REFERENCES public.hotels(id) ON DELETE RESTRICT,

  kind                  public.partner_kind NOT NULL DEFAULT 'VENDOR',
  category              public.partner_category NOT NULL,

  partner_name          text NOT NULL CHECK (length(btrim(partner_name)) > 0),
  -- Operational fields (mostly free-form; structured search via tags)
  service_area          text NOT NULL DEFAULT '',
  services_offered      text[] NOT NULL DEFAULT '{}',
  preferred_use_case    text NOT NULL DEFAULT '',
  price_note_text       text NOT NULL DEFAULT '',
  emergency_availability boolean NOT NULL DEFAULT false,

  -- Status + verification
  status                public.partner_status NOT NULL DEFAULT 'DRAFT',
  verification_status   public.partner_verification_status NOT NULL DEFAULT 'UNVERIFIED',
  verification_notes    text NOT NULL DEFAULT '',
  last_verified_at      timestamptz,
  last_verified_by      uuid REFERENCES auth.users(id),

  -- Contact (PII — RLS-gated; not exposed on dashboard summary cards)
  contact_name          text NOT NULL DEFAULT '',
  contact_phone         text,
  alternate_contact     text,
  email                 text,

  -- AGENT-only commission meta (NULL for VENDOR — CHECK enforces)
  commission_pct        numeric(5,2) CHECK (
    commission_pct IS NULL OR (commission_pct >= 0 AND commission_pct <= 100)
  ),
  payout_terms          text,

  -- Free-form
  notes                 text NOT NULL DEFAULT '',
  tags                  text[] NOT NULL DEFAULT '{}',
  metadata              jsonb NOT NULL DEFAULT '{}',

  -- Lifecycle
  archived_at           timestamptz,
  archived_by           uuid REFERENCES auth.users(id),
  archive_reason        text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES auth.users(id),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid REFERENCES auth.users(id),

  -- Vendor rows cannot carry commission meta (catches accidental mis-typing)
  CONSTRAINT partners_kind_commission_match CHECK (
    (kind = 'AGENT')
    OR (kind = 'VENDOR' AND commission_pct IS NULL AND payout_terms IS NULL)
  ),
  -- Kind ↔ category alignment. AGENT rows must use agent-flavoured
  -- categories; VENDOR rows must use vendor-flavoured ones. OTHER is
  -- allowed for both as the escape hatch. Prevents data drift like
  -- (kind=AGENT, category=MAINTENANCE_VENDOR) which is nonsensical and
  -- breaks the directory's category filter.
  CONSTRAINT partners_kind_category_match CHECK (
    (kind = 'AGENT' AND category IN (
      'TRAVEL_AGENT','CORPORATE_BOOKER','WEDDING_PLANNER','GROUP_BOOKER','OTHER'
    ))
    OR (kind = 'VENDOR' AND category IN (
      'TAXI_TRANSPORT','TREK_GUIDE','TEMPLE_TOUR','SAFARI_ADVENTURE',
      'PHOTOGRAPHER','EVENT_DECORATION','WELLNESS_YOGA','FOOD_CATERING',
      'LAUNDRY_OPS','MAINTENANCE_VENDOR','OTHER'
    ))
  ),
  -- Pragmatic email format guard. Length cap prevents pathological inputs.
  CONSTRAINT partners_email_format CHECK (
    email IS NULL
    OR (length(email) BETWEEN 5 AND 254 AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  ),
  -- At least one contact channel for non-DRAFT rows
  CONSTRAINT partners_nondraft_needs_contact CHECK (
    status = 'DRAFT'
    OR archived_at IS NOT NULL
    OR contact_phone IS NOT NULL
    OR email IS NOT NULL
  ),
  -- DO_NOT_USE rows must carry a reason (in verification_notes for v1; keeps
  -- the schema thin while making the intent explicit)
  CONSTRAINT partners_donotuse_needs_reason CHECK (
    status <> 'DO_NOT_USE' OR length(btrim(verification_notes)) > 0
  ),
  -- VERIFIED status requires a verification stamp
  CONSTRAINT partners_verified_needs_stamp CHECK (
    verification_status <> 'VERIFIED' OR last_verified_at IS NOT NULL
  )
);

-- ─── partner_events (append-only) ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.partner_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id            uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  hotel_id              uuid NOT NULL REFERENCES public.hotels(id),
  event_type            public.partner_event_type NOT NULL,
  payload               jsonb NOT NULL DEFAULT '{}',
  -- STATUS_CHANGED:        { from, to, reason }
  -- VERIFICATION_CHANGED:  { from, to, notes }
  -- UPDATED:               { changes: { field: [old,new], ... } }
  -- COMMISSION_RECORDED:   { commission_id, amount_inr, lead_id, booking_id }
  -- COMMISSION_PAID:       { commission_id, amount_inr, payout_reference }
  -- LINKED_TO_LEAD:        { lead_id }
  actor_id              uuid REFERENCES auth.users(id),
  occurred_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  event_schema_version  integer NOT NULL DEFAULT 1
);

-- ─── partner_commissions (AGENT-only manual ledger) ────────────────────────

CREATE TABLE IF NOT EXISTS public.partner_commissions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id          uuid NOT NULL REFERENCES public.hotels(id) ON DELETE RESTRICT,
  partner_id        uuid NOT NULL REFERENCES public.partners(id) ON DELETE RESTRICT,
  lead_id           uuid REFERENCES public.leads(id),
  booking_id        uuid REFERENCES public.bookings(id),

  amount_inr        numeric(10,2) NOT NULL CHECK (amount_inr >= 0),
  status            public.partner_commission_status NOT NULL DEFAULT 'ACCRUED',
  accrued_at        timestamptz NOT NULL DEFAULT now(),

  marked_paid_at    timestamptz,
  marked_paid_by    uuid REFERENCES auth.users(id),
  payout_reference  text,    -- UPI ref / bank ref / cheque no
  payout_method     text,    -- 'UPI' | 'BANK' | 'CASH' | 'CHEQUE' | free-form

  cancelled_at      timestamptz,
  cancelled_by      uuid REFERENCES auth.users(id),
  cancelled_reason  text,

  notes             text NOT NULL DEFAULT '',
  -- Caller-supplied dedup token. Same key returns the same row instead of
  -- creating a duplicate accrual on double-click / network retry.
  idempotency_key   uuid,
  created_by        uuid REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT partner_commissions_target_min CHECK (
    lead_id IS NOT NULL OR booking_id IS NOT NULL
  ),
  CONSTRAINT partner_commissions_paid_needs_stamp CHECK (
    status <> 'PAID' OR marked_paid_at IS NOT NULL
  ),
  CONSTRAINT partner_commissions_cancelled_needs_stamp CHECK (
    status <> 'CANCELLED' OR cancelled_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_commissions_idempotency
  ON public.partner_commissions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ─── leads.partner_id → FK now that partners exists ────────────────────────

DO $$
DECLARE n integer;
BEGIN
  SELECT COUNT(*) INTO n FROM public.leads WHERE partner_id IS NOT NULL;
  IF n > 0 THEN
    RAISE NOTICE 'leads.partner_id has % non-null values before partners FK; verifying they reference real partner rows', n;
    -- If any orphan, FK creation will fail. Surface clearly rather than silently NULL.
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE public.leads
    ADD CONSTRAINT leads_partner_fk
    FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_partners_hotel_status
  ON public.partners (hotel_id, status)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_partners_hotel_kind_category
  ON public.partners (hotel_id, kind, category)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_partners_hotel_verification
  ON public.partners (hotel_id, verification_status, last_verified_at)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_partners_name_search
  ON public.partners USING gin (to_tsvector('simple', partner_name || ' ' || service_area))
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_partner_events_partner
  ON public.partner_events (partner_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_partner_events_hotel_type
  ON public.partner_events (hotel_id, event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_partner_commissions_hotel_status
  ON public.partner_commissions (hotel_id, status, accrued_at DESC);

CREATE INDEX IF NOT EXISTS idx_partner_commissions_partner
  ON public.partner_commissions (partner_id, status, accrued_at DESC);

CREATE INDEX IF NOT EXISTS idx_partner_commissions_booking
  ON public.partner_commissions (booking_id)
  WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_partner_id
  ON public.leads (partner_id)
  WHERE partner_id IS NOT NULL;

-- ─── Triggers (updated_at) ─────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_partners_updated_at ON public.partners;
CREATE TRIGGER trg_partners_updated_at
  BEFORE UPDATE ON public.partners
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_partner_commissions_updated_at ON public.partner_commissions;
CREATE TRIGGER trg_partner_commissions_updated_at
  BEFORE UPDATE ON public.partner_commissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Derived view: partners + staleness flag ──────────────────────────────
-- 90-day staleness threshold for v1 (hardcoded; per-hotel config deferred
-- per CLAUDE.md deferral rule until a hotel asks).

CREATE OR REPLACE VIEW public.v_partner_directory AS
SELECT
  p.*,
  (p.archived_at IS NOT NULL) AS is_archived,
  (
    p.verification_status = 'VERIFIED'
    AND p.last_verified_at IS NOT NULL
    AND p.last_verified_at < (now() - interval '90 days')
  ) AS is_verification_stale,
  (
    SELECT COUNT(*) FROM public.leads l
    WHERE l.partner_id = p.id AND l.deleted_at IS NULL
  ) AS lead_count,
  (
    SELECT COALESCE(SUM(amount_inr), 0) FROM public.partner_commissions c
    WHERE c.partner_id = p.id AND c.status = 'ACCRUED'
  ) AS commission_outstanding_inr,
  (
    SELECT COALESCE(SUM(amount_inr), 0) FROM public.partner_commissions c
    WHERE c.partner_id = p.id AND c.status = 'PAID'
  ) AS commission_paid_inr
FROM public.partners p;

GRANT SELECT ON public.v_partner_directory TO authenticated;
ALTER VIEW public.v_partner_directory SET (security_invoker = on);
-- security_invoker so the view respects underlying RLS on partners + leads
-- + partner_commissions.

-- ─── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_commissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partners_select_for_members ON public.partners;
CREATE POLICY partners_select_for_members ON public.partners
  FOR SELECT USING (public.vaiyu_is_hotel_member(hotel_id));

DROP POLICY IF EXISTS partner_events_select_for_members ON public.partner_events;
CREATE POLICY partner_events_select_for_members ON public.partner_events
  FOR SELECT USING (public.vaiyu_is_hotel_member(hotel_id));

DROP POLICY IF EXISTS partner_commissions_select_for_members ON public.partner_commissions;
CREATE POLICY partner_commissions_select_for_members ON public.partner_commissions
  FOR SELECT USING (public.vaiyu_is_hotel_member(hotel_id));

-- All writes via SECURITY DEFINER RPCs only.

-- ─── _log_partner_event (internal) ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._log_partner_event(
  p_partner_id uuid,
  p_hotel_id   uuid,
  p_event_type public.partner_event_type,
  p_payload    jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  INSERT INTO public.partner_events (partner_id, hotel_id, event_type, payload, actor_id)
  VALUES (p_partner_id, p_hotel_id, p_event_type, COALESCE(p_payload, '{}'::jsonb), auth.uid());
$$;

-- ─── create_partner ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_partner(
  p_hotel_id           uuid,
  p_partner_name       text,
  p_kind               text,
  p_category           text,
  p_service_area       text DEFAULT '',
  p_services_offered   text[] DEFAULT '{}',
  p_preferred_use_case text DEFAULT '',
  p_price_note_text    text DEFAULT '',
  p_emergency_availability boolean DEFAULT false,
  p_contact_name       text DEFAULT '',
  p_contact_phone      text DEFAULT NULL,
  p_alternate_contact  text DEFAULT NULL,
  p_email              text DEFAULT NULL,
  p_notes              text DEFAULT '',
  p_tags               text[] DEFAULT '{}',
  p_commission_pct     numeric DEFAULT NULL,
  p_payout_terms       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_kind     public.partner_kind;
  v_category public.partner_category;
  v_id       uuid;
BEGIN
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF p_partner_name IS NULL OR btrim(p_partner_name) = '' THEN
    RAISE EXCEPTION 'NAME_REQUIRED';
  END IF;

  BEGIN v_kind := p_kind::public.partner_kind;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_KIND'; END;

  BEGIN v_category := p_category::public.partner_category;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_CATEGORY'; END;

  -- Sanity: VENDOR cannot carry commission_pct/payout_terms.
  IF v_kind = 'VENDOR' AND (p_commission_pct IS NOT NULL OR p_payout_terms IS NOT NULL) THEN
    RAISE EXCEPTION 'VENDOR_NO_COMMISSION';
  END IF;
  IF p_commission_pct IS NOT NULL AND (p_commission_pct < 0 OR p_commission_pct > 100) THEN
    RAISE EXCEPTION 'INVALID_COMMISSION_PCT';
  END IF;

  -- Email format check (matches partners_email_format CHECK; RAISE clearer
  -- error code than letting the constraint trip).
  IF p_email IS NOT NULL AND btrim(p_email) <> '' AND (
    length(p_email) NOT BETWEEN 5 AND 254
    OR p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ) THEN
    RAISE EXCEPTION 'INVALID_EMAIL';
  END IF;

  INSERT INTO public.partners (
    hotel_id, kind, category, partner_name,
    service_area, services_offered, preferred_use_case, price_note_text,
    emergency_availability,
    contact_name, contact_phone, alternate_contact, email,
    notes, tags,
    commission_pct, payout_terms,
    created_by, updated_by
  ) VALUES (
    p_hotel_id, v_kind, v_category, btrim(p_partner_name),
    COALESCE(p_service_area,''), COALESCE(p_services_offered,'{}'),
    COALESCE(p_preferred_use_case,''), COALESCE(p_price_note_text,''),
    COALESCE(p_emergency_availability, false),
    COALESCE(p_contact_name,''),
    public._normalize_phone(p_contact_phone),
    public._normalize_phone(p_alternate_contact),
    NULLIF(lower(btrim(p_email)),''),
    COALESCE(p_notes,''), COALESCE(p_tags,'{}'),
    p_commission_pct, p_payout_terms,
    auth.uid(), auth.uid()
  )
  RETURNING id INTO v_id;

  PERFORM public._log_partner_event(
    v_id, p_hotel_id, 'CREATED',
    jsonb_build_object('kind', v_kind::text, 'category', v_category::text)
  );

  RETURN jsonb_build_object('id', v_id, 'status', 'DRAFT');
END;
$$;

-- ─── update_partner ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_partner(
  p_id                 uuid,
  p_partner_name       text DEFAULT NULL,
  p_category           text DEFAULT NULL,
  p_service_area       text DEFAULT NULL,
  p_services_offered   text[] DEFAULT NULL,
  p_preferred_use_case text DEFAULT NULL,
  p_price_note_text    text DEFAULT NULL,
  p_emergency_availability boolean DEFAULT NULL,
  p_contact_name       text DEFAULT NULL,
  p_contact_phone      text DEFAULT NULL,
  p_alternate_contact  text DEFAULT NULL,
  p_email              text DEFAULT NULL,
  p_notes              text DEFAULT NULL,
  p_tags               text[] DEFAULT NULL,
  p_commission_pct     numeric DEFAULT NULL,
  p_payout_terms       text DEFAULT NULL,
  p_clear_commission   boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row             record;
  v_changes         jsonb := '{}'::jsonb;
  v_category        public.partner_category;
  v_new_name        text;
  v_new_phone       text;
  v_new_alt_phone   text;
  v_new_email       text;
  v_new_commission  numeric;
  v_new_payout_terms text;
BEGIN
  SELECT * INTO v_row FROM public.partners WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'PARTNER_NOT_FOUND'; END IF;
  IF NOT public.vaiyu_is_hotel_member(v_row.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_row.archived_at IS NOT NULL THEN RAISE EXCEPTION 'ARCHIVED_NOT_EDITABLE'; END IF;

  -- Pre-validate + normalize, building per-field diff.

  IF p_category IS NOT NULL THEN
    BEGIN v_category := p_category::public.partner_category;
    EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_CATEGORY'; END;
    IF v_category IS DISTINCT FROM v_row.category THEN
      v_changes := v_changes || jsonb_build_object('category',
        jsonb_build_array(v_row.category::text, v_category::text));
    END IF;
  END IF;

  IF v_row.kind = 'VENDOR' AND (p_commission_pct IS NOT NULL OR p_payout_terms IS NOT NULL) THEN
    RAISE EXCEPTION 'VENDOR_NO_COMMISSION';
  END IF;
  IF p_commission_pct IS NOT NULL AND (p_commission_pct < 0 OR p_commission_pct > 100) THEN
    RAISE EXCEPTION 'INVALID_COMMISSION_PCT';
  END IF;

  -- partner_name
  IF p_partner_name IS NOT NULL THEN
    v_new_name := NULLIF(btrim(p_partner_name), '');
    IF v_new_name IS NOT NULL AND v_new_name IS DISTINCT FROM v_row.partner_name THEN
      v_changes := v_changes || jsonb_build_object('partner_name',
        jsonb_build_array(v_row.partner_name, v_new_name));
    END IF;
  END IF;

  -- service_area / preferred_use_case / price_note_text / notes (text fields)
  IF p_service_area IS NOT NULL AND p_service_area IS DISTINCT FROM v_row.service_area THEN
    v_changes := v_changes || jsonb_build_object('service_area',
      jsonb_build_array(v_row.service_area, p_service_area));
  END IF;
  IF p_preferred_use_case IS NOT NULL AND p_preferred_use_case IS DISTINCT FROM v_row.preferred_use_case THEN
    v_changes := v_changes || jsonb_build_object('preferred_use_case',
      jsonb_build_array(v_row.preferred_use_case, p_preferred_use_case));
  END IF;
  IF p_price_note_text IS NOT NULL AND p_price_note_text IS DISTINCT FROM v_row.price_note_text THEN
    v_changes := v_changes || jsonb_build_object('price_note_text',
      jsonb_build_array(v_row.price_note_text, p_price_note_text));
  END IF;
  IF p_notes IS NOT NULL AND p_notes IS DISTINCT FROM v_row.notes THEN
    -- Notes can be long; record length deltas + 200-char preview, not full text.
    v_changes := v_changes || jsonb_build_object('notes',
      jsonb_build_object(
        'old_len', length(COALESCE(v_row.notes,'')),
        'new_len', length(p_notes),
        'new_preview', left(p_notes, 200)
      ));
  END IF;

  -- emergency_availability (boolean)
  IF p_emergency_availability IS NOT NULL AND p_emergency_availability IS DISTINCT FROM v_row.emergency_availability THEN
    v_changes := v_changes || jsonb_build_object('emergency_availability',
      jsonb_build_array(v_row.emergency_availability, p_emergency_availability));
  END IF;

  -- contact_name
  IF p_contact_name IS NOT NULL AND p_contact_name IS DISTINCT FROM v_row.contact_name THEN
    v_changes := v_changes || jsonb_build_object('contact_name',
      jsonb_build_array(v_row.contact_name, p_contact_name));
  END IF;

  -- contact_phone / alternate_contact (normalize before diff/write)
  IF p_contact_phone IS NOT NULL THEN
    v_new_phone := public._normalize_phone(p_contact_phone);
    IF v_new_phone IS DISTINCT FROM v_row.contact_phone THEN
      v_changes := v_changes || jsonb_build_object('contact_phone',
        jsonb_build_array(v_row.contact_phone, v_new_phone));
    END IF;
  END IF;
  IF p_alternate_contact IS NOT NULL THEN
    v_new_alt_phone := public._normalize_phone(p_alternate_contact);
    IF v_new_alt_phone IS DISTINCT FROM v_row.alternate_contact THEN
      v_changes := v_changes || jsonb_build_object('alternate_contact',
        jsonb_build_array(v_row.alternate_contact, v_new_alt_phone));
    END IF;
  END IF;

  -- email (validate + normalize)
  IF p_email IS NOT NULL THEN
    IF btrim(p_email) = '' THEN
      v_new_email := NULL;
    ELSE
      IF length(p_email) NOT BETWEEN 5 AND 254
         OR p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RAISE EXCEPTION 'INVALID_EMAIL';
      END IF;
      v_new_email := lower(btrim(p_email));
    END IF;
    IF v_new_email IS DISTINCT FROM v_row.email THEN
      v_changes := v_changes || jsonb_build_object('email',
        jsonb_build_array(v_row.email, v_new_email));
    END IF;
  END IF;

  -- services_offered / tags (text arrays — diff as before/after)
  IF p_services_offered IS NOT NULL AND p_services_offered IS DISTINCT FROM v_row.services_offered THEN
    v_changes := v_changes || jsonb_build_object('services_offered',
      jsonb_build_array(to_jsonb(v_row.services_offered), to_jsonb(p_services_offered)));
  END IF;
  IF p_tags IS NOT NULL AND p_tags IS DISTINCT FROM v_row.tags THEN
    v_changes := v_changes || jsonb_build_object('tags',
      jsonb_build_array(to_jsonb(v_row.tags), to_jsonb(p_tags)));
  END IF;

  -- commission_pct + payout_terms
  IF p_clear_commission THEN
    v_new_commission := NULL;
    v_new_payout_terms := NULL;
  ELSE
    v_new_commission   := COALESCE(p_commission_pct, v_row.commission_pct);
    v_new_payout_terms := COALESCE(p_payout_terms,   v_row.payout_terms);
  END IF;
  IF v_new_commission IS DISTINCT FROM v_row.commission_pct THEN
    v_changes := v_changes || jsonb_build_object('commission_pct',
      jsonb_build_array(v_row.commission_pct, v_new_commission));
  END IF;
  IF v_new_payout_terms IS DISTINCT FROM v_row.payout_terms THEN
    v_changes := v_changes || jsonb_build_object('payout_terms',
      jsonb_build_array(v_row.payout_terms, v_new_payout_terms));
  END IF;

  -- No-op short-circuit
  IF v_changes = '{}'::jsonb THEN RETURN; END IF;

  UPDATE public.partners SET
    partner_name           = COALESCE(v_new_name, partner_name),
    category               = COALESCE(v_category, category),
    service_area           = COALESCE(p_service_area, service_area),
    services_offered       = COALESCE(p_services_offered, services_offered),
    preferred_use_case     = COALESCE(p_preferred_use_case, preferred_use_case),
    price_note_text        = COALESCE(p_price_note_text, price_note_text),
    emergency_availability = COALESCE(p_emergency_availability, emergency_availability),
    contact_name           = COALESCE(p_contact_name, contact_name),
    contact_phone          = CASE WHEN p_contact_phone IS NOT NULL THEN v_new_phone ELSE contact_phone END,
    alternate_contact      = CASE WHEN p_alternate_contact IS NOT NULL THEN v_new_alt_phone ELSE alternate_contact END,
    email                  = CASE WHEN p_email IS NOT NULL THEN v_new_email ELSE email END,
    notes                  = COALESCE(p_notes, notes),
    tags                   = COALESCE(p_tags, tags),
    commission_pct         = v_new_commission,
    payout_terms           = v_new_payout_terms,
    updated_by             = auth.uid()
  WHERE id = p_id;

  PERFORM public._log_partner_event(p_id, v_row.hotel_id, 'UPDATED',
    jsonb_build_object('changes', v_changes, 'field_count', (SELECT count(*) FROM jsonb_object_keys(v_changes))));
END;
$$;

-- ─── set_partner_status ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_partner_status(
  p_id     uuid,
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row    record;
  v_status public.partner_status;
BEGIN
  BEGIN v_status := p_status::public.partner_status;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_STATUS'; END;

  SELECT * INTO v_row FROM public.partners WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'PARTNER_NOT_FOUND'; END IF;
  IF NOT public.vaiyu_is_hotel_member(v_row.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_row.archived_at IS NOT NULL THEN RAISE EXCEPTION 'ARCHIVED_NOT_EDITABLE'; END IF;
  IF v_row.status = v_status THEN RETURN; END IF;

  IF v_status = 'DO_NOT_USE' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'REASON_REQUIRED_FOR_DO_NOT_USE';
  END IF;

  UPDATE public.partners SET
    status              = v_status,
    verification_notes  = CASE WHEN v_status = 'DO_NOT_USE' AND p_reason IS NOT NULL
                                 THEN p_reason ELSE verification_notes END,
    updated_by          = auth.uid()
  WHERE id = p_id;

  PERFORM public._log_partner_event(p_id, v_row.hotel_id, 'STATUS_CHANGED',
    jsonb_build_object('from', v_row.status::text, 'to', v_status::text, 'reason', p_reason));
END;
$$;

-- ─── set_partner_verification ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_partner_verification(
  p_id     uuid,
  p_status text,
  p_notes  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row    record;
  v_status public.partner_verification_status;
BEGIN
  BEGIN v_status := p_status::public.partner_verification_status;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_VERIFICATION_STATUS'; END;

  SELECT * INTO v_row FROM public.partners WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'PARTNER_NOT_FOUND'; END IF;
  IF NOT public.vaiyu_is_hotel_member(v_row.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_row.archived_at IS NOT NULL THEN RAISE EXCEPTION 'ARCHIVED_NOT_EDITABLE'; END IF;

  UPDATE public.partners SET
    verification_status = v_status,
    verification_notes  = COALESCE(p_notes, verification_notes),
    last_verified_at    = CASE WHEN v_status = 'VERIFIED' THEN clock_timestamp() ELSE last_verified_at END,
    last_verified_by    = CASE WHEN v_status = 'VERIFIED' THEN auth.uid()        ELSE last_verified_by END,
    updated_by          = auth.uid()
  WHERE id = p_id;

  PERFORM public._log_partner_event(p_id, v_row.hotel_id, 'VERIFICATION_CHANGED',
    jsonb_build_object(
      'status',      jsonb_build_array(v_row.verification_status::text, v_status::text),
      'notes',       jsonb_build_array(v_row.verification_notes, COALESCE(p_notes, v_row.verification_notes)),
      'prev_verified_at', v_row.last_verified_at,
      'stamped_now',  v_status = 'VERIFIED'
    ));
END;
$$;

-- ─── archive_partner / unarchive_partner ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.archive_partner(
  p_id     uuid,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE v_row record;
BEGIN
  SELECT * INTO v_row FROM public.partners WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'PARTNER_NOT_FOUND'; END IF;
  IF NOT public.vaiyu_is_hotel_member(v_row.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_row.archived_at IS NOT NULL THEN RETURN; END IF;

  UPDATE public.partners SET
    archived_at = clock_timestamp(),
    archived_by = auth.uid(),
    archive_reason = p_reason,
    updated_by = auth.uid()
  WHERE id = p_id;

  PERFORM public._log_partner_event(p_id, v_row.hotel_id, 'ARCHIVED',
    jsonb_build_object('reason', p_reason));
END;
$$;

CREATE OR REPLACE FUNCTION public.unarchive_partner(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE v_row record;
BEGIN
  SELECT * INTO v_row FROM public.partners WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'PARTNER_NOT_FOUND'; END IF;
  IF NOT public.vaiyu_is_hotel_member(v_row.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_row.archived_at IS NULL THEN RETURN; END IF;

  UPDATE public.partners SET
    archived_at = NULL,
    archived_by = NULL,
    archive_reason = NULL,
    updated_by = auth.uid()
  WHERE id = p_id;

  PERFORM public._log_partner_event(p_id, v_row.hotel_id, 'UNARCHIVED', '{}'::jsonb);
END;
$$;

-- ─── link_lead_partner (sets leads.partner_id with cross-tenant guard) ─────

CREATE OR REPLACE FUNCTION public.link_lead_partner(
  p_lead_id    uuid,
  p_partner_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_lead    record;
  v_partner record;
BEGIN
  SELECT id, hotel_id INTO v_lead FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
  IF NOT public.vaiyu_is_hotel_member(v_lead.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF p_partner_id IS NOT NULL THEN
    SELECT id, hotel_id INTO v_partner FROM public.partners WHERE id = p_partner_id;
    IF v_partner.id IS NULL THEN RAISE EXCEPTION 'PARTNER_NOT_FOUND'; END IF;
    IF v_partner.hotel_id <> v_lead.hotel_id THEN
      RAISE EXCEPTION 'PARTNER_HOTEL_MISMATCH';
    END IF;
  END IF;

  UPDATE public.leads SET partner_id = p_partner_id, last_activity_at = clock_timestamp()
   WHERE id = p_lead_id;

  IF p_partner_id IS NOT NULL THEN
    PERFORM public._log_partner_event(p_partner_id, v_lead.hotel_id, 'LINKED_TO_LEAD',
      jsonb_build_object('lead_id', p_lead_id));
  END IF;
END;
$$;

-- ─── record_partner_commission ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_partner_commission(
  p_partner_id      uuid,
  p_amount_inr      numeric,
  p_lead_id         uuid DEFAULT NULL,
  p_booking_id      uuid DEFAULT NULL,
  p_notes           text DEFAULT '',
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_partner   record;
  v_id        uuid;
  v_existing  record;
  v_amount    numeric;
BEGIN
  IF p_amount_inr IS NULL OR p_amount_inr < 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;
  IF p_lead_id IS NULL AND p_booking_id IS NULL THEN
    RAISE EXCEPTION 'TARGET_REQUIRED';
  END IF;

  v_amount := round(p_amount_inr::numeric, 2);

  -- Idempotency short-circuit: same key → return the existing row, no
  -- duplicate ledger entry. Strongly recommended on every UI-driven call
  -- (generate a UUID per "Add commission" click and reuse on retry).
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, status, amount_inr, partner_id, hotel_id
      INTO v_existing
      FROM public.partner_commissions
     WHERE idempotency_key = p_idempotency_key;
    IF v_existing.id IS NOT NULL THEN
      IF v_existing.partner_id <> p_partner_id OR v_existing.amount_inr <> v_amount THEN
        -- Same key used for a materially different write — surface loudly
        -- rather than silently return the wrong row.
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_MISMATCH';
      END IF;
      RETURN jsonb_build_object(
        'id', v_existing.id, 'status', v_existing.status::text,
        'idempotent_hit', true
      );
    END IF;
  END IF;

  SELECT id, hotel_id, kind INTO v_partner FROM public.partners WHERE id = p_partner_id;
  IF v_partner.id IS NULL THEN RAISE EXCEPTION 'PARTNER_NOT_FOUND'; END IF;
  IF NOT public.vaiyu_is_hotel_member(v_partner.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_partner.kind <> 'AGENT' THEN
    RAISE EXCEPTION 'COMMISSION_REQUIRES_AGENT_KIND';
  END IF;

  -- Cross-tenant guards
  IF p_lead_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.leads WHERE id = p_lead_id AND hotel_id = v_partner.hotel_id
    ) THEN RAISE EXCEPTION 'LEAD_HOTEL_MISMATCH'; END IF;
  END IF;
  IF p_booking_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.bookings WHERE id = p_booking_id AND hotel_id = v_partner.hotel_id
    ) THEN RAISE EXCEPTION 'BOOKING_HOTEL_MISMATCH'; END IF;
  END IF;

  INSERT INTO public.partner_commissions (
    hotel_id, partner_id, lead_id, booking_id, amount_inr, notes, idempotency_key, created_by
  ) VALUES (
    v_partner.hotel_id, p_partner_id, p_lead_id, p_booking_id,
    v_amount, COALESCE(p_notes,''), p_idempotency_key, auth.uid()
  )
  RETURNING id INTO v_id;

  PERFORM public._log_partner_event(p_partner_id, v_partner.hotel_id, 'COMMISSION_RECORDED',
    jsonb_build_object(
      'commission_id', v_id, 'amount_inr', v_amount,
      'lead_id', p_lead_id, 'booking_id', p_booking_id,
      'idempotency_key', p_idempotency_key
    ));

  RETURN jsonb_build_object('id', v_id, 'status', 'ACCRUED', 'idempotent_hit', false);
END;
$$;

-- ─── mark_commission_paid (finance role) ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_commission_paid(
  p_id              uuid,
  p_payout_reference text,
  p_payout_method   text DEFAULT NULL,
  p_paid_at         timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE v_row record;
BEGIN
  IF p_payout_reference IS NULL OR btrim(p_payout_reference) = '' THEN
    RAISE EXCEPTION 'PAYOUT_REFERENCE_REQUIRED';
  END IF;

  SELECT * INTO v_row FROM public.partner_commissions WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'COMMISSION_NOT_FOUND'; END IF;
  IF NOT public.vaiyu_is_hotel_finance_manager(v_row.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_row.status = 'PAID' THEN RETURN; END IF;
  IF v_row.status = 'CANCELLED' THEN RAISE EXCEPTION 'COMMISSION_CANCELLED'; END IF;

  UPDATE public.partner_commissions SET
    status           = 'PAID',
    marked_paid_at   = COALESCE(p_paid_at, clock_timestamp()),
    marked_paid_by   = auth.uid(),
    payout_reference = btrim(p_payout_reference),
    payout_method    = COALESCE(NULLIF(btrim(p_payout_method),''), payout_method)
  WHERE id = p_id;

  PERFORM public._log_partner_event(v_row.partner_id, v_row.hotel_id, 'COMMISSION_PAID',
    jsonb_build_object(
      'commission_id', p_id,
      'amount_inr',     v_row.amount_inr,
      'payout_reference', btrim(p_payout_reference),
      'payout_method',  p_payout_method
    ));
END;
$$;

-- ─── cancel_commission ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cancel_commission(
  p_id     uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE v_row record;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  SELECT * INTO v_row FROM public.partner_commissions WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'COMMISSION_NOT_FOUND'; END IF;
  IF NOT public.vaiyu_is_hotel_finance_manager(v_row.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_row.status = 'CANCELLED' THEN RETURN; END IF;
  IF v_row.status = 'PAID' THEN RAISE EXCEPTION 'CANNOT_CANCEL_PAID'; END IF;

  UPDATE public.partner_commissions SET
    status           = 'CANCELLED',
    cancelled_at     = clock_timestamp(),
    cancelled_by     = auth.uid(),
    cancelled_reason = btrim(p_reason)
  WHERE id = p_id;

  PERFORM public._log_partner_event(v_row.partner_id, v_row.hotel_id, 'COMMISSION_CANCELLED',
    jsonb_build_object('commission_id', p_id, 'reason', btrim(p_reason)));
END;
$$;

-- ─── Grants ────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.create_partner(uuid, text, text, text, text, text[], text, text, boolean, text, text, text, text, text, text[], numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_partner(uuid, text, text, text, text[], text, text, boolean, text, text, text, text, text, text[], numeric, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_partner_status(uuid, text, text)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_partner_verification(uuid, text, text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_partner(uuid, text)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.unarchive_partner(uuid)                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_lead_partner(uuid, uuid)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_partner_commission(uuid, numeric, uuid, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_commission_paid(uuid, text, text, timestamptz)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_commission(uuid, text)                              TO authenticated;

-- ─── Realtime publication ─────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.partners;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.partner_events;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.partner_commissions;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- ─── Comments ──────────────────────────────────────────────────────────────

COMMENT ON TABLE public.partners IS
  'Position 4 — internal Partner Network directory. Single table with kind=VENDOR|AGENT discriminator. VENDOR rows are operational vendors (taxi/trek/wellness/maintenance); AGENT rows are commissionable lead sources (travel agent/corporate booker/wedding planner). NOT a public marketplace — VAiyu does not warrant vendor quality, certification, or insurance. Hotel team must verify independently.';

COMMENT ON TABLE public.partner_commissions IS
  'Manual ledger for agent commissions. v1 has NO auto-calculation, NO auto-payout. Owner records amount when they decide to pay; finance manager marks as paid with a payout_reference. Only AGENT-kind partners can carry ledger rows.';

COMMENT ON VIEW public.v_partner_directory IS
  'Read-side directory view: partners + is_verification_stale (VERIFIED but >90 days old) + lead_count + commission_outstanding/paid totals. security_invoker so RLS on partners + leads + partner_commissions all apply.';

COMMENT ON CONSTRAINT partners_kind_commission_match ON public.partners IS
  'VENDOR rows must have NULL commission_pct + payout_terms. AGENT rows may carry either or both. Prevents silent mis-categorisation.';

COMMENT ON COLUMN public.partners.verification_status IS
  'Stored states: UNVERIFIED / PENDING / VERIFIED / REJECTED. The "STALE" badge is derived in v_partner_directory (VERIFIED + last_verified_at < now() - 90 days). Storing stale would require a scheduled job; computing on read is exact + free.';
