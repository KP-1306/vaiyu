-- Lock down internal guest/token helper RPCs (auth sweep, batch 3 — 2026-06-14).
--
-- These SECURITY DEFINER functions were anon-callable (PUBLIC default grant) but
-- are only ever called by OTHER SECURITY DEFINER functions (which run as the
-- owner, postgres) — never directly by the frontend. Leaving them anon-callable
-- let an anonymous caller mint precheckin/feedback tokens for any booking or
-- resolve/inject guest identity. Caller analysis (frontend + edge + internal DB
-- + cron):
--   • create_feedback_token   ← only checkout_stay
--   • create_precheckin_token ← only process_booking_group
--   • resolve_guest_identity  ← only process_booking_group
--   • upsert_guest_v2         ← only create_walkin_v2, process_checkin_v2
--                               (the one web/src "hit" is a comment, not a call)
--   • generate_precheckin_tokens ← no caller (orphan; reserve for service/cron)
--
-- Fix: revoke EXECUTE from PUBLIC + anon + authenticated, grant only service_role.
-- The internal SECURITY DEFINER callers are unaffected (they execute as the
-- owner). NOTE: token-gated public RPCs (submit_precheckin, submit_public_feedback,
-- validate_precheckin_token, validate_feedback_token) are deliberately NOT touched
-- — they are public by design and validate their token internally (verified).
-- lookup_guest_profile is also deliberately NOT touched here — it is a separate
-- PII-disclosure concern (reachable by the guest pre-checkin flow) that needs a
-- minimal-disclosure redesign, not a blanket revoke.

-- ── internal-only helpers: service_role only ───────────────────────────────
REVOKE ALL ON FUNCTION public.create_feedback_token(p_booking_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_feedback_token(p_booking_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.create_precheckin_token(p_booking_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_precheckin_token(p_booking_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.resolve_guest_identity(p_hotel_id uuid, p_name text, p_mobile text, p_email text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_guest_identity(p_hotel_id uuid, p_name text, p_mobile text, p_email text) TO service_role;

REVOKE ALL ON FUNCTION public.upsert_guest_v2(p_guest_details jsonb, p_hotel_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_guest_v2(p_guest_details jsonb, p_hotel_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.generate_precheckin_tokens(p_hotel_id uuid, p_days_before integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_precheckin_tokens(p_hotel_id uuid, p_days_before integer) TO service_role;

-- ── self-scoped (uses auth.uid(), called post-login): authenticated only ───
REVOKE ALL ON FUNCTION public.link_auth_user_to_guest() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_auth_user_to_guest() TO authenticated, service_role;
