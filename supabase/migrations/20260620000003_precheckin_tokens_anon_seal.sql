-- ============================================================
-- VAiyu: seal precheckin_tokens (anon token-table scrape -> chained PII)
-- ============================================================
-- The base-table audit (2026-06-20) found precheckin_tokens readable by ANON via
-- a "Public read precheckin tokens" policy (USING true, role PUBLIC) + an anon
-- SELECT grant. CONFIRMED LIVE on prod: anon read 40 token rows. This is a
-- CHAINED leak: the pre-checkin token is the credential, and validate_precheckin_
-- token(token) (anon-callable by design) returns the full booking PII
-- (guest_name, phone, email, nationality, address, identity_proof incl. ID-image
-- URLs). So scraping the token table -> harvest every guest's PII + ID images.
--
-- Why sealing is SAFE for the (anonymous) guest pre-checkin flow:
-- the guest is NOT a logged-in VAiyu user — the token IS the credential — but the
-- flow NEVER reads this table directly. /precheckin/:token (PreCheckin.tsx) calls
-- the RPCs validate_precheckin_token / submit_precheckin, both SECURITY DEFINER:
-- inside them the query runs as the table OWNER and BYPASSES RLS, so the anon
-- role's table privilege is irrelevant to the RPC. We are NOT touching the anon
-- EXECUTE grant on those RPCs. 0 frontend files read precheckin_tokens directly.
-- Net: anon RPC call still works; only the raw-table scrape (which nothing
-- legitimate uses) is blocked.
--
-- FIX: drop the public-read policy + revoke anon/PUBLIC table SELECT; keep
-- authenticated (the existing member-scoped "Staff can view tokens" policy needs
-- the grant) + service_role ("Service role manages tokens"). RPCs untouched.
-- ============================================================

DROP POLICY IF EXISTS "Public read precheckin tokens" ON public.precheckin_tokens;

REVOKE SELECT ON public.precheckin_tokens FROM anon;
REVOKE SELECT ON public.precheckin_tokens FROM PUBLIC;
GRANT  SELECT ON public.precheckin_tokens TO authenticated, service_role;
