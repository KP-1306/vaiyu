-- Lead CRM schema refinements (post-review)
--
-- Three changes from the Day 1 migration:
--
-- 1. Rename `notes` → `latest_note_preview` to make its semantics explicit:
--    it's a denormalized preview only. The append-only timeline (lead_events
--    NOTE_ADDED entries) is the source of truth for note history.
--
-- 2. Add `contact_phone_normalized` to support international guests
--    (Nepal +977, UAE +971, etc.) without mutating the operator-entered value.
--    Original raw phone stays in contact_phone; normalized form is computed
--    by _normalize_phone() in the RPC layer.
--
-- 3. Add `BASICS_UPDATED` to lead_event_type for the edit RPCs landing in Day 2.
--
-- Also fixes a Day 1 bug: RLS policies missed `hotel_members.is_active = true`.
-- Switching to the canonical `vaiyu_is_hotel_member()` helper closes the gap
-- (an inactive/fired staff member would otherwise still see leads).

-- ─── 1. Rename notes → latest_note_preview ────────────────────────────────

ALTER TABLE public.leads RENAME COLUMN notes TO latest_note_preview;

COMMENT ON COLUMN public.leads.latest_note_preview IS
  'Denormalized preview of the most recent note (truncated to ~200 chars). Updated only by add_lead_note RPC. Full note history lives in lead_events (NOTE_ADDED).';

-- ─── 2. Add contact_phone_normalized ──────────────────────────────────────

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS contact_phone_normalized text;

COMMENT ON COLUMN public.leads.contact_phone IS
  'Phone number as entered by operator. Preserved exactly. Used for display.';

COMMENT ON COLUMN public.leads.contact_phone_normalized IS
  'E.164-style normalized phone (e.g. +919876543210). Computed from contact_phone by _normalize_phone(). Used for duplicate detection and future SMS/WhatsApp dispatch.';

-- Swap dup-check index to use the normalized column
DROP INDEX IF EXISTS public.idx_leads_dupcheck;

CREATE INDEX IF NOT EXISTS idx_leads_dupcheck
  ON public.leads (hotel_id, contact_phone_normalized)
  WHERE deleted_at IS NULL AND contact_phone_normalized IS NOT NULL;

-- ─── 3. Add BASICS_UPDATED event type ─────────────────────────────────────

-- PG 12+: ALTER TYPE ADD VALUE inside a transaction is allowed provided the
-- new value isn't referenced in the same transaction. We only register it
-- here; first use is in the Day 2 RPC migration.
ALTER TYPE public.lead_event_type ADD VALUE IF NOT EXISTS 'BASICS_UPDATED';

-- ─── 4. Fix RLS to use canonical hotel-member helper ──────────────────────
--
-- Day 1 policies checked hotel_members directly and missed the is_active
-- filter — an inactive/fired staff member would still see leads. The
-- existing vaiyu_is_hotel_member() helper bakes in is_active = true plus
-- the platform-admin bypass.

DROP POLICY IF EXISTS leads_select_for_members ON public.leads;
CREATE POLICY leads_select_for_members ON public.leads
  FOR SELECT
  USING (public.vaiyu_is_hotel_member(leads.hotel_id));

DROP POLICY IF EXISTS leads_insert_for_members ON public.leads;
CREATE POLICY leads_insert_for_members ON public.leads
  FOR INSERT
  WITH CHECK (public.vaiyu_is_hotel_member(leads.hotel_id));

DROP POLICY IF EXISTS leads_update_for_members ON public.leads;
CREATE POLICY leads_update_for_members ON public.leads
  FOR UPDATE
  USING (public.vaiyu_is_hotel_member(leads.hotel_id));

DROP POLICY IF EXISTS lead_events_select_for_members ON public.lead_events;
CREATE POLICY lead_events_select_for_members ON public.lead_events
  FOR SELECT
  USING (public.vaiyu_is_hotel_member(lead_events.hotel_id));
