-- Lock down WhatsApp chat webhook RPCs to service_role (auth sweep — 2026-06-14).
--
-- These four SECURITY DEFINER functions were anon-callable via the PUBLIC default
-- grant and have no internal authorization guard, so an anonymous caller could
-- inject inbound guest messages, flip message delivery statuses, or drive the bot
-- thread state. Caller analysis (frontend + edge + internal DB):
--   • record_inbound_chat_message ← interakt-webhook edge only
--   • set_chat_thread_state       ← interakt-webhook edge only
--   • update_chat_message_status  ← interakt-webhook edge only
--   • record_outbound_chat_message ← no caller (orphan; reserved for the dormant
--                                     WhatsApp outbound layer)
-- The interakt-webhook edge function authenticates via HMAC signature
-- (verifyInteraktSignature / INTERAKT_WEBHOOK_SECRET) and calls these with the
-- SUPABASE_SERVICE_ROLE_KEY — confirmed. No frontend caller.
--
-- Fix: revoke EXECUTE from PUBLIC + anon + authenticated; grant only service_role.
-- No body changes — the correct control for a webhook/worker RPC is the grant.
--
-- NOT touched (verified to already enforce real authorization — they fetch the
-- thread and require vaiyu_is_hotel_member(thread.hotel_id)): send_chat_message,
-- mark_chat_thread_read, assign_chat_thread, link_ticket_to_chat_thread (staff
-- chat UI), and record_external_message_id (send-notifications edge).

REVOKE ALL ON FUNCTION public.record_inbound_chat_message(p_hotel_id uuid, p_guest_phone text, p_guest_name text, p_message_type text, p_body text, p_payload jsonb, p_provider text, p_provider_message_id text, p_last_booking_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_inbound_chat_message(p_hotel_id uuid, p_guest_phone text, p_guest_name text, p_message_type text, p_body text, p_payload jsonb, p_provider text, p_provider_message_id text, p_last_booking_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.record_outbound_chat_message(p_thread_id uuid, p_hotel_id uuid, p_message_type text, p_body text, p_payload jsonb, p_template_code text, p_template_name text, p_provider text, p_provider_message_id text, p_staff_user_id uuid, p_is_bot boolean, p_status text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_outbound_chat_message(p_thread_id uuid, p_hotel_id uuid, p_message_type text, p_body text, p_payload jsonb, p_template_code text, p_template_name text, p_provider text, p_provider_message_id text, p_staff_user_id uuid, p_is_bot boolean, p_status text) TO service_role;

REVOKE ALL ON FUNCTION public.set_chat_thread_state(p_thread_id uuid, p_state jsonb, p_expires_in_minutes integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_chat_thread_state(p_thread_id uuid, p_state jsonb, p_expires_in_minutes integer) TO service_role;

REVOKE ALL ON FUNCTION public.update_chat_message_status(p_provider_message_id text, p_status text, p_failed_reason text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_chat_message_status(p_provider_message_id text, p_status text, p_failed_reason text) TO service_role;
