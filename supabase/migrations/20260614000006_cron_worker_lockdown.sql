-- Lock down cron / worker RPCs to service_role (auth sweep, batch 4 — 2026-06-14).
--
-- These are trusted-backend functions: invoked by pg_cron (as the postgres job
-- owner) or by edge-function workers using the service_role key (confirmed:
-- process-import-rows, send-notifications, auto-apply-pricing all use
-- SUPABASE_SERVICE_ROLE_KEY). None is called by the frontend (web/src grep = 0).
-- They were anon-callable via the PUBLIC default grant, so an anonymous caller
-- could trigger queue claims, imports, pricing changes, reminder generation,
-- billing/SLA enforcement, invite expiry, etc.
--
-- Fix: revoke EXECUTE from PUBLIC + anon + authenticated; grant only service_role.
-- pg_cron is unaffected (runs as postgres, the owner). No body changes — the
-- correct control for a trusted-backend RPC is the grant, not an internal guard.

REVOKE ALL ON FUNCTION public._degrade_expired_visibility_attestations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._degrade_expired_visibility_attestations() TO service_role;

REVOKE ALL ON FUNCTION public.apply_pricing_change_system(p_hotel_id uuid, p_room_type_id uuid, p_rule_id uuid, p_base_price numeric, p_new_price numeric, p_occupancy_pct numeric, p_adjustment_type text, p_adjustment_value numeric, p_was_clamped boolean, p_clamp_reason text, p_matched_rule_name text, p_explanation text, p_client_request_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_pricing_change_system(p_hotel_id uuid, p_room_type_id uuid, p_rule_id uuid, p_base_price numeric, p_new_price numeric, p_occupancy_pct numeric, p_adjustment_type text, p_adjustment_value numeric, p_was_clamped boolean, p_clamp_reason text, p_matched_rule_name text, p_explanation text, p_client_request_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.cancel_stale_extension_requests(p_grace_hours integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_stale_extension_requests(p_grace_hours integer) TO service_role;

REVOKE ALL ON FUNCTION public.claim_pending_booking_groups(p_limit integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_booking_groups(p_limit integer) TO service_role;

REVOKE ALL ON FUNCTION public.claim_pending_drip_steps(p_limit integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_drip_steps(p_limit integer) TO service_role;

REVOKE ALL ON FUNCTION public.claim_pending_notifications(p_limit integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_notifications(p_limit integer) TO service_role;

REVOKE ALL ON FUNCTION public.cleanup_expired_hotel_invites() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_hotel_invites() TO service_role;

REVOKE ALL ON FUNCTION public.enforce_billing_compliance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_billing_compliance() TO service_role;

REVOKE ALL ON FUNCTION public.enforce_onboarding_sla() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_onboarding_sla() TO service_role;

REVOKE ALL ON FUNCTION public.expire_stale_invites() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_invites() TO service_role;

REVOKE ALL ON FUNCTION public.fetch_pending_booking_groups(p_limit integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fetch_pending_booking_groups(p_limit integer) TO service_role;

REVOKE ALL ON FUNCTION public.fetch_pending_rows(p_limit integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fetch_pending_rows(p_limit integer) TO service_role;

REVOKE ALL ON FUNCTION public.generate_checkout_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_checkout_reminders() TO service_role;

REVOKE ALL ON FUNCTION public.generate_precheckin_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_precheckin_reminders() TO service_role;

REVOKE ALL ON FUNCTION public.process_booking_group(p_booking_reference text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_booking_group(p_booking_reference text) TO service_role;

REVOKE ALL ON FUNCTION public.prune_api_hits(p_retention_hours integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_api_hits(p_retention_hours integer) TO service_role;

REVOKE ALL ON FUNCTION public.release_stale_invite_claims() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_stale_invite_claims() TO service_role;
