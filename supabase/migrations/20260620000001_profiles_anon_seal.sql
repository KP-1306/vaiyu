-- ============================================================
-- VAiyu: Phase 1 — close the ANONYMOUS (open-internet) read of profiles
-- ============================================================
-- public.profiles holds full guest identity: full_name, phone, email,
-- govt_id_type, govt_id_number, address, emergency_name, emergency_phone,
-- vehicle_number. A base-table audit (2026-06-20) found it readable by ANON:
-- a "Public profiles read" policy (USING true, to PUBLIC) + an anon SELECT grant
-- let any anonymous internet caller dump every row via /rest/v1/profiles.
-- CONFIRMED LIVE on prod: anon read 18 rows (govt IDs etc.).
--
-- FIX (surgical, anon dimension only): revoke the SELECT privilege from anon and
-- PUBLIC, and grant it explicitly to authenticated + service_role. anon is then
-- blocked at the GRANT layer (PostgREST -> 401) before RLS is even evaluated.
-- NO policy is touched, so every AUTHENTICATED reader behaves exactly as before
-- (this preserves the ~13 owner/staff/guest screens that read profiles, and the
-- guest's own-profile reads). INSERT/UPDATE are left as-is — they are already
-- self-scoped by policy (auth.uid() = id), which anon (null uid) cannot satisfy.
--
-- Verified safe for the check-in prefill the owner flagged: the booking-code
-- prefill (BookingLookup -> search_booking RPC -> BookingDetails/GuestKYC) sources
-- guest details from the booking object + v_public_hotels, NOT from profiles.
-- No anon/pre-login path reads profiles anywhere in the app.
--
-- OUT OF SCOPE (Phase 2, by design — to be built against the guest<->hotel
-- relationship tables and tested against every reader): tightening the
-- AUTHENTICATED read from "any logged-in account" down to "the guest themselves +
-- staff of a hotel where that guest has a booking/stay". The "Public profiles
-- read" USING(true) policy is intentionally LEFT IN PLACE so authenticated
-- behaviour is unchanged until Phase 2. booking_claim_otps and precheckin_tokens
-- are also deferred to a later batch per owner direction.
-- ============================================================

REVOKE SELECT ON public.profiles FROM anon;
REVOKE SELECT ON public.profiles FROM PUBLIC;
GRANT  SELECT ON public.profiles TO authenticated, service_role;
