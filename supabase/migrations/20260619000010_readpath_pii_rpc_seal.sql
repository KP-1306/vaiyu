-- ============================================================
-- VAiyu: Read-path PII RPC seal
-- ============================================================
-- The earlier RPC authorization sweep (20260614000001..11) covered MUTATING
-- SECURITY DEFINER functions (INSERT/UPDATE/DELETE). It did NOT systematically
-- cover SECURITY DEFINER *reads* that RETURN guest/lead/user PII to anon — the
-- search_booking leak (20260614000011) was the only instance, caught by hand.
-- This migration closes that class on the function surface, the same way the
-- 2026-06-19 view sweep closed it on the view surface.
--
-- METHOD: enumerated every anon-executable SECURITY DEFINER function whose body
-- references PII identifiers and that lacks an authorization guard (10 on prod),
-- then classified each by its INTENDED caller (frontend + edge + DB-internal):
--
--   KEEP anon — token IS the credential (verified token-gated public flows):
--     submit_precheckin, validate_precheckin_token, validate_feedback_token,
--     validate_hotel_invite, and create_lead_public (public write-intake; its
--     only return is the new lead_id + a same-contact duplicate flag, no
--     third-party PII).
--
--   EXCLUDED — regex false positive, no PII in the RESULT:
--     _gbp_signal_for_visibility returns a boolean. Its caller
--     _compute_visibility_score is SECURITY INVOKER, so the pre-existing
--     GRANT EXECUTE ... TO authenticated on the helper is load-bearing (the
--     authenticated owner needs it to compute their own visibility score).
--     Left untouched.
--
--   SEALED here — anon-callable, no token, RETURNS others' PII → service_role
--   only. For each, EVERY runtime caller is either a service_role edge worker
--   or a SECURITY DEFINER function (runs as owner), so revoking anon +
--   authenticated cannot break a SECURITY INVOKER path (verified, see below):
--
--     * lookup_lead_by_contact(uuid,text,text) — RETURNS lead contact_name +
--       status by (hotel_id, phone|email): an anon phone/email -> name
--       enumeration. Sole callers: chat-inbound + interakt-webhook edge
--       functions, both initialised with SUPABASE_SERVICE_ROLE_KEY. No
--       web/src caller.
--     * wa_resolve_hotel_for_phone(text) — RETURNS hotel (name/slug) +
--       booking_id by phone: an anon enumeration of who is staying / has
--       enquired, and where. Sole caller: interakt-webhook (service_role).
--     * _user_display_name(uuid) — RETURNS ANY auth user's full_name / name /
--       email-localpart by user_id. Internal helper; every caller (claim_lead,
--       release_claim, assign_lead, create_lead, transition_lead_status,
--       convert_lead_to_walkin, record_hotel_asset_file, approve/reject_hotel_
--       asset, _build_claim_status_jsonb, _record_seasonal_window_event) is
--       SECURITY DEFINER — verified on prod, all 12 prosecdef=true.
--     * _drip_render(text,uuid) — substitutes lead PII (contact_name,
--       contact_phone) into a caller-supplied template by lead_id. Internal
--       helper; sole caller claim_pending_drip_steps is SECURITY DEFINER (drip
--       cron worker).
--
-- REVOKE FROM PUBLIC is mandatory: Postgres grants EXECUTE to PUBLIC by default
-- and Supabase's anon role inherits via PUBLIC, so revoking anon alone is a
-- no-op. The function owner (postgres) retains EXECUTE by ownership, so the
-- SECURITY DEFINER callers above are unaffected.
-- ============================================================

-- 1. lookup_lead_by_contact — webhook-only (service_role)
REVOKE ALL ON FUNCTION public.lookup_lead_by_contact(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_lead_by_contact(uuid, text, text) TO service_role;

-- 2. wa_resolve_hotel_for_phone — webhook-only (service_role)
REVOKE ALL ON FUNCTION public.wa_resolve_hotel_for_phone(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_resolve_hotel_for_phone(text) TO service_role;

-- 3. _user_display_name — internal helper, all callers SECURITY DEFINER
REVOKE ALL ON FUNCTION public._user_display_name(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._user_display_name(uuid) TO service_role;

-- 4. _drip_render — internal helper, sole caller SECURITY DEFINER (drip worker)
REVOKE ALL ON FUNCTION public._drip_render(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._drip_render(text, uuid) TO service_role;
