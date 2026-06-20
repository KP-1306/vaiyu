-- ============================================================
-- VAiyu: seal booking_claim_otps (anon OTP/phone leak)
-- ============================================================
-- The base-table audit (2026-06-20) found booking_claim_otps readable by ANON:
-- policies booking_claim_otps_select_anon / _update_anon (USING true, role anon)
-- + an anon table grant let any anonymous internet caller read every row via
-- /rest/v1/booking_claim_otps. CONFIRMED LIVE on prod: 14 rows
-- (booking_code, phone, otp) — real phone numbers + booking codes.
--
-- Analysis (why this is safe to seal): the "Claim my stay" OTP flow is NOT a
-- functioning feature in production. The deployed frontend calls /claim/init and
-- /claim/verify through req() against VITE_API_URL=http://localhost:4000, which
-- is unreachable in a real browser, so req() falls back to a DEMO STUB
-- (otp_hint:"123456", token:"demo-stay-token", "Demo Guest") that NEVER reads or
-- writes booking_claim_otps. There is no edge function and no server/ backend for
-- it in the repo, and no code anywhere writes this table. Prod data confirms it
-- never worked: consumed=0 across ~7 months, all rows expired. The feature is
-- marked "future build" (revisit when the SMS/WhatsApp OTP delivery channel is
-- live). So no deployed code path reads/writes this table via the anon client —
-- revoking anon breaks nothing. A future real backend will use service_role.
--
-- FIX: drop the legacy anon policies and revoke anon/PUBLIC table privileges;
-- lock access to service_role (which also bypasses RLS). The restrictive
-- "No direct client access" (USING false) policy is left untouched.
-- ============================================================

DROP POLICY IF EXISTS booking_claim_otps_select_anon ON public.booking_claim_otps;
DROP POLICY IF EXISTS booking_claim_otps_insert_anon ON public.booking_claim_otps;
DROP POLICY IF EXISTS booking_claim_otps_update_anon ON public.booking_claim_otps;

REVOKE ALL ON public.booking_claim_otps FROM anon;
REVOKE ALL ON public.booking_claim_otps FROM PUBLIC;
GRANT  ALL ON public.booking_claim_otps TO service_role;
