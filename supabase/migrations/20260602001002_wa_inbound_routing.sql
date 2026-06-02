-- Interakt WhatsApp Integration — Foundation Migration 3 of 3
--
-- Server-side helpers for the inbound webhook + staff outbound reply.
-- Webhook (interakt-webhook edge function) calls these via service_role.
-- Staff UI calls send_chat_message via authenticated.
--
-- Routing model (single-account = single inbound number):
--   1. Webhook receives a guest message
--   2. interakt-webhook resolves which hotel the phone belongs to by calling
--      wa_resolve_hotel_for_phone(phone) which searches recent bookings
--      across all hotels
--   3. If unique match → use that hotel; multi-match → return list, webhook
--      sends "which property?" template; no match → "unknown_guest" template
--   4. Webhook calls record_inbound_chat_message(hotel_id, phone, ...) which
--      lazy-creates the thread + appends the message
--   5. Webhook then runs the state machine (in TS, not SQL) and may call
--      enqueue_chat_outbound to send a reply

-- ─── Phone normalisation ────────────────────────────────────────────────────
-- E.164 expected ("+919999999999"). Drop spaces, dashes; ensure leading "+".
-- For India default: if 10-digit without prefix, prepend +91. (This is for
-- comparison only — we never modify what the BSP gives us.)

CREATE OR REPLACE FUNCTION public._normalize_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v text;
BEGIN
  IF p_phone IS NULL THEN RETURN NULL; END IF;
  v := regexp_replace(p_phone, '[\s\-()]', '', 'g');
  IF v !~ '^\+' THEN
    -- Bare 10 digits → assume India
    IF v ~ '^[6-9][0-9]{9}$' THEN
      v := '+91' || v;
    ELSIF v ~ '^91[6-9][0-9]{9}$' THEN
      v := '+' || v;
    ELSE
      v := '+' || v;
    END IF;
  END IF;
  RETURN v;
END;
$$;
COMMENT ON FUNCTION public._normalize_phone(text) IS
  'Best-effort E.164 normaliser for phone comparison. Indian fallback only — assume +91 for bare 10-digit numbers.';

-- ─── Hotel resolution for inbound messages ──────────────────────────────────
-- Single-account model: one inbound number serves all hotels. We resolve
-- which hotel the message belongs to by searching recent bookings.
--
-- Returns:
--   [{hotel_id, hotel_slug, hotel_name, booking_id, match_score}]
-- ordered most-recent-first. The webhook handler:
--   • 1 row → route to that hotel
--   • >1 rows → send "which property?" template with hotel names as buttons
--   • 0 rows → send "unknown_guest" template

CREATE OR REPLACE FUNCTION public.wa_resolve_hotel_for_phone(p_phone text)
RETURNS TABLE (
  hotel_id   uuid,
  hotel_slug text,
  hotel_name text,
  booking_id uuid,
  matched_at timestamptz,
  match_kind text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_phone text := public._normalize_phone(p_phone);
BEGIN
  IF v_phone IS NULL THEN
    RETURN;
  END IF;

  -- Prefer: an active booking (currently checked in) for this phone
  RETURN QUERY
  SELECT
    h.id, h.slug, h.name, b.id, b.check_in_at, 'ACTIVE_BOOKING'::text
  FROM public.bookings b
  JOIN public.hotels h ON h.id = b.hotel_id
  JOIN public.guests g ON g.id = b.guest_id
  WHERE public._normalize_phone(g.phone) = v_phone
    AND b.status IN ('checked_in', 'confirmed', 'tentative')
    AND b.check_in_at <= now() + interval '7 days'
    AND (b.check_out_at IS NULL OR b.check_out_at >= now() - interval '2 days')
  ORDER BY b.check_in_at DESC
  LIMIT 5;

  -- If no active match, fall back to: any booking in the last 90 days
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      h.id, h.slug, h.name, b.id, b.check_in_at, 'RECENT_BOOKING'::text
    FROM public.bookings b
    JOIN public.hotels h ON h.id = b.hotel_id
    JOIN public.guests g ON g.id = b.guest_id
    WHERE public._normalize_phone(g.phone) = v_phone
      AND b.check_in_at >= now() - interval '90 days'
    ORDER BY b.check_in_at DESC
    LIMIT 5;
  END IF;

  -- If still no match, try leads (someone enquired but didn't book)
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      h.id, h.slug, h.name, NULL::uuid, l.created_at, 'LEAD_ONLY'::text
    FROM public.leads l
    JOIN public.hotels h ON h.id = l.hotel_id
    WHERE public._normalize_phone(l.contact_phone) = v_phone
      AND l.created_at >= now() - interval '90 days'
      AND l.deleted_at IS NULL
    ORDER BY l.last_activity_at DESC
    LIMIT 5;
  END IF;
END;
$$;
COMMENT ON FUNCTION public.wa_resolve_hotel_for_phone(text) IS
  'Single-account routing: given an inbound WhatsApp phone, return candidate hotels in priority order (active booking > recent booking > lead). The webhook handler decides how to route based on row count.';

GRANT EXECUTE ON FUNCTION public.wa_resolve_hotel_for_phone(text) TO service_role;

-- ─── record_inbound_chat_message ────────────────────────────────────────────
-- Lazy-creates the thread and appends an INBOUND message. Called by the
-- webhook after hotel resolution. service_role only (no user JWT context).

CREATE OR REPLACE FUNCTION public.record_inbound_chat_message(
  p_hotel_id            uuid,
  p_guest_phone         text,
  p_guest_name          text,
  p_message_type        text,           -- TEXT | BUTTON_REPLY | LIST_REPLY | IMAGE | ...
  p_body                text,
  p_payload             jsonb,
  p_provider            text,           -- 'INTERAKT' | 'META_DIRECT'
  p_provider_message_id text,
  p_last_booking_id     uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_thread_id uuid;
  v_msg_id    uuid;
  v_phone     text := public._normalize_phone(p_guest_phone);
  v_type      public.chat_message_type;
BEGIN
  IF v_phone IS NULL THEN RAISE EXCEPTION 'INVALID_PHONE'; END IF;
  IF p_hotel_id IS NULL THEN RAISE EXCEPTION 'INVALID_HOTEL'; END IF;

  BEGIN
    v_type := p_message_type::public.chat_message_type;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'INVALID_MESSAGE_TYPE';
  END;

  -- Lazy-create thread (one per hotel+phone)
  INSERT INTO public.wa_chat_threads(
    hotel_id, guest_phone, guest_name, last_booking_id, provider, last_message_at
  ) VALUES (
    p_hotel_id, v_phone, p_guest_name, p_last_booking_id, p_provider, clock_timestamp()
  )
  ON CONFLICT (hotel_id, guest_phone) DO UPDATE SET
    guest_name      = COALESCE(EXCLUDED.guest_name, public.wa_chat_threads.guest_name),
    last_booking_id = COALESCE(EXCLUDED.last_booking_id, public.wa_chat_threads.last_booking_id),
    provider        = EXCLUDED.provider
  RETURNING id INTO v_thread_id;

  -- Idempotent insert (webhook may retry)
  BEGIN
    INSERT INTO public.wa_chat_messages(
      thread_id, hotel_id, direction, message_type,
      body, payload, provider, provider_message_id, status
    ) VALUES (
      v_thread_id, p_hotel_id, 'INBOUND', v_type,
      p_body, COALESCE(p_payload, '{}'::jsonb), p_provider, p_provider_message_id, 'DELIVERED'
    ) RETURNING id INTO v_msg_id;
  EXCEPTION WHEN unique_violation THEN
    -- Already recorded (provider_message_id collision) — return existing id
    SELECT id INTO v_msg_id FROM public.wa_chat_messages
     WHERE provider_message_id = p_provider_message_id;
  END;

  RETURN jsonb_build_object(
    'thread_id', v_thread_id,
    'message_id', v_msg_id
  );
END;
$$;
COMMENT ON FUNCTION public.record_inbound_chat_message(uuid, text, text, text, text, jsonb, text, text, uuid) IS
  'Lazy-creates thread + appends INBOUND message. Idempotent via UNIQUE provider_message_id. service_role only.';

GRANT EXECUTE ON FUNCTION public.record_inbound_chat_message(uuid, text, text, text, text, jsonb, text, text, uuid)
  TO service_role;

-- ─── record_outbound_chat_message ───────────────────────────────────────────
-- Called by the webhook OR send-notifications dispatcher when an OUTBOUND
-- message is sent. Appends to chat_messages so the staff inbox shows what
-- the bot/staff sent.

CREATE OR REPLACE FUNCTION public.record_outbound_chat_message(
  p_thread_id           uuid,
  p_hotel_id            uuid,
  p_message_type        text,
  p_body                text,
  p_payload             jsonb,
  p_template_code       text DEFAULT NULL,
  p_template_name       text DEFAULT NULL,
  p_provider            text DEFAULT 'INTERAKT',
  p_provider_message_id text DEFAULT NULL,
  p_staff_user_id       uuid DEFAULT NULL,
  p_is_bot              boolean DEFAULT false,
  p_status              text DEFAULT 'SENT'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_msg_id uuid;
  v_type   public.chat_message_type;
  v_status public.chat_message_status;
BEGIN
  BEGIN
    v_type := p_message_type::public.chat_message_type;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'INVALID_MESSAGE_TYPE';
  END;
  BEGIN
    v_status := p_status::public.chat_message_status;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END;

  INSERT INTO public.wa_chat_messages(
    thread_id, hotel_id, direction, message_type,
    body, payload, template_code, template_name,
    provider, provider_message_id, status,
    staff_user_id, is_bot, sent_at
  ) VALUES (
    p_thread_id, p_hotel_id, 'OUTBOUND', v_type,
    p_body, COALESCE(p_payload, '{}'::jsonb), p_template_code, p_template_name,
    p_provider, p_provider_message_id, v_status,
    p_staff_user_id, p_is_bot, now()
  ) RETURNING id INTO v_msg_id;

  RETURN jsonb_build_object('message_id', v_msg_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_outbound_chat_message(uuid, uuid, text, text, jsonb, text, text, text, text, uuid, boolean, text)
  TO service_role, authenticated;

-- ─── send_chat_message (staff outbound; 24h window enforced) ───────────────
-- Authenticated members of the hotel call this from the staff inbox UI.
-- Inserts an OUTBOUND chat_message + enqueues a notification_queue row so
-- the send-notifications worker picks it up and ships it via the provider.

CREATE OR REPLACE FUNCTION public.send_chat_message(
  p_thread_id   uuid,
  p_body        text,
  p_template_code text DEFAULT NULL,   -- if outside 24h window, must use a template
  p_payload     jsonb   DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_thread       public.wa_chat_threads;
  v_in_window    boolean;
  v_msg_id       uuid;
  v_nq_id        uuid;
BEGIN
  SELECT * INTO v_thread FROM public.wa_chat_threads WHERE id = p_thread_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'THREAD_NOT_FOUND'; END IF;
  IF NOT public.vaiyu_is_hotel_member(v_thread.hotel_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  IF p_body IS NULL OR length(btrim(p_body)) = 0 THEN
    RAISE EXCEPTION 'BODY_REQUIRED';
  END IF;
  IF length(p_body) > 4096 THEN
    RAISE EXCEPTION 'BODY_TOO_LONG';
  END IF;

  v_in_window := (v_thread.last_inbound_at IS NOT NULL
                  AND v_thread.last_inbound_at > now() - interval '24 hours');

  -- Outside 24h window: must use an approved template
  IF NOT v_in_window AND p_template_code IS NULL THEN
    RAISE EXCEPTION 'WINDOW_CLOSED_USE_TEMPLATE';
  END IF;

  -- Append chat_message (status QUEUED until worker sends)
  INSERT INTO public.wa_chat_messages(
    thread_id, hotel_id, direction, message_type,
    body, payload, template_code, provider, status,
    staff_user_id, is_bot
  ) VALUES (
    p_thread_id, v_thread.hotel_id, 'OUTBOUND',
    CASE WHEN p_template_code IS NULL THEN 'TEXT' ELSE 'TEMPLATE' END,
    p_body, COALESCE(p_payload, '{}'::jsonb), p_template_code,
    v_thread.provider, 'QUEUED',
    auth.uid(), false
  ) RETURNING id INTO v_msg_id;

  -- Enqueue notification for the worker
  INSERT INTO public.notification_queue(
    booking_id, hotel_id, channel, template_code, payload,
    provider, status, next_attempt_at
  ) VALUES (
    v_thread.last_booking_id, v_thread.hotel_id, 'whatsapp',
    COALESCE(p_template_code, 'chat_freeform'),
    jsonb_build_object(
      'thread_id', p_thread_id,
      'chat_message_id', v_msg_id,
      'phone', v_thread.guest_phone,
      'guest_name', v_thread.guest_name,
      'body', p_body
    ) || COALESCE(p_payload, '{}'::jsonb),
    v_thread.provider, 'pending', now()
  ) RETURNING id INTO v_nq_id;

  RETURN jsonb_build_object(
    'message_id', v_msg_id,
    'notification_id', v_nq_id,
    'within_24h_window', v_in_window
  );
END;
$$;
COMMENT ON FUNCTION public.send_chat_message(uuid, text, text, jsonb) IS
  'Staff outbound reply. Inside 24h window: free-text. Outside: template_code required (raises WINDOW_CLOSED_USE_TEMPLATE otherwise). Inserts chat_message (status QUEUED) + enqueues notification_queue for the worker.';

GRANT EXECUTE ON FUNCTION public.send_chat_message(uuid, text, text, jsonb) TO authenticated;

-- ─── set_chat_thread_state (state machine helper) ───────────────────────────
-- Called by the webhook handler when the bot is mid-conversation
-- (e.g. just asked "what time for housekeeping?"). The next inbound from
-- the same thread will be interpreted in light of this state.

CREATE OR REPLACE FUNCTION public.set_chat_thread_state(
  p_thread_id  uuid,
  p_state      jsonb,
  p_expires_in_minutes int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  UPDATE public.wa_chat_threads SET
    state            = COALESCE(p_state, '{}'::jsonb),
    state_expires_at = CASE WHEN p_state IS NULL OR p_state = '{}'::jsonb
                              THEN NULL
                            ELSE now() + (p_expires_in_minutes || ' minutes')::interval
                       END
   WHERE id = p_thread_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_chat_thread_state(uuid, jsonb, int) TO service_role;

-- ─── tickets bridge: link a chat thread to a freshly created ticket ─────────
-- Staff UI calls this after the existing create_ticket flow to bind the
-- ticket to the originating chat. Audit logs the bridge.

CREATE OR REPLACE FUNCTION public.link_ticket_to_chat_thread(
  p_ticket_id uuid,
  p_thread_id uuid,
  p_note      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_hotel_id_ticket uuid;
  v_hotel_id_thread uuid;
  v_msg_id          uuid;
BEGIN
  SELECT hotel_id INTO v_hotel_id_ticket FROM public.tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TICKET_NOT_FOUND'; END IF;
  SELECT hotel_id INTO v_hotel_id_thread FROM public.wa_chat_threads WHERE id = p_thread_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'THREAD_NOT_FOUND'; END IF;
  IF v_hotel_id_ticket <> v_hotel_id_thread THEN
    RAISE EXCEPTION 'CROSS_HOTEL_FORBIDDEN';
  END IF;
  IF NOT public.vaiyu_is_hotel_member(v_hotel_id_ticket) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  -- Append a SYSTEM message into the thread for visibility
  INSERT INTO public.wa_chat_messages(
    thread_id, hotel_id, direction, message_type,
    body, payload, provider, status, linked_ticket_id, is_bot
  ) VALUES (
    p_thread_id, v_hotel_id_thread, 'OUTBOUND', 'SYSTEM',
    COALESCE(p_note, 'Ticket created from this conversation.'),
    jsonb_build_object('ticket_id', p_ticket_id),
    (SELECT provider FROM public.wa_chat_threads WHERE id = p_thread_id),
    'SENT', p_ticket_id, true
  ) RETURNING id INTO v_msg_id;

  INSERT INTO public.va_audit_logs(action, actor, hotel_id, entity, entity_id, meta)
  VALUES (
    'chat_ticket_linked',
    auth.uid()::text,
    v_hotel_id_ticket,
    'chat_thread',
    p_thread_id,
    jsonb_build_object('ticket_id', p_ticket_id, 'chat_message_id', v_msg_id)
  );

  RETURN jsonb_build_object('ok', true, 'message_id', v_msg_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.link_ticket_to_chat_thread(uuid, uuid, text) TO authenticated;

-- ─── Telemetry update RPC (called by webhook on delivery receipts) ──────────

CREATE OR REPLACE FUNCTION public.update_chat_message_status(
  p_provider_message_id text,
  p_status              text,
  p_failed_reason       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_status public.chat_message_status;
  v_id     uuid;
BEGIN
  BEGIN
    v_status := p_status::public.chat_message_status;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END;
  -- Mirror to chat_messages
  UPDATE public.wa_chat_messages SET
    status        = v_status,
    delivered_at  = CASE WHEN v_status IN ('DELIVERED','READ') AND delivered_at IS NULL THEN now() ELSE delivered_at END,
    read_at       = CASE WHEN v_status = 'READ' AND read_at IS NULL THEN now() ELSE read_at END,
    failed_reason = CASE WHEN v_status = 'FAILED' THEN COALESCE(p_failed_reason, failed_reason) ELSE failed_reason END
   WHERE provider_message_id = p_provider_message_id
   RETURNING id INTO v_id;

  -- Mirror to notification_queue (if the row exists)
  UPDATE public.notification_queue SET
    status        = CASE WHEN v_status = 'FAILED' THEN 'failed' WHEN v_status = 'SENT' THEN 'sent' ELSE status END,
    delivered_at  = CASE WHEN v_status IN ('DELIVERED','READ') AND delivered_at IS NULL THEN now() ELSE delivered_at END,
    read_at       = CASE WHEN v_status = 'READ' AND read_at IS NULL THEN now() ELSE read_at END,
    failed_reason = CASE WHEN v_status = 'FAILED' THEN COALESCE(p_failed_reason, failed_reason) ELSE failed_reason END
   WHERE provider_message_id = p_provider_message_id;

  RETURN jsonb_build_object('ok', true, 'chat_message_id', v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_chat_message_status(text, text, text) TO service_role;
