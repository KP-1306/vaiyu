-- ============================================================
-- VAiyu: seal v_partner_directory (Phase 1b)
-- ============================================================
-- v_partner_directory was held out of the Phase 1 sweep (20260619000003) as a
-- possible public listing. Review concluded it is NOT public: it's an
-- owner-internal partner-management view (read by partnerService on authenticated
-- owner screens) and exposes partner PII + financials — contact_phone, email,
-- alternate_contact, commission_pct, payout_terms, commission_outstanding_inr,
-- commission_paid_inr. It must not be anon-readable. (It currently returns 0 rows
-- to anon only because no partner rows exist yet — it leaks the moment data does.)
--
-- v_effective_room_price stays anon-readable by design: the public guest
-- check-in/availability kiosk (the /checkin section is intentionally NOT behind
-- AuthGate) reads it, and it exposes only pricing (base/effective price, rate
-- plans) — public-facing, not sensitive.
-- ============================================================

REVOKE ALL ON public.v_partner_directory FROM anon;
REVOKE ALL ON public.v_partner_directory FROM PUBLIC;
GRANT SELECT ON public.v_partner_directory TO authenticated, service_role;
