-- Interakt WhatsApp Integration — Foundation Migration 2 of 3
--
-- chat_threads + chat_messages schema. The existing chat-inbound stub
-- references these tables ("// TODO — pending the chat-threads schema work")
-- but they were never built. This migration is that work.
--
-- One thread per (hotel, guest_phone). Threads carry conversation state
-- (the bot's pending question, e.g. "what time for housekeeping?") with a
-- 30-minute expiry so abandoned conversations restart cleanly.
--
-- chat_messages is append-only. Realtime publication on it drives the staff
-- inbox live updates. Both directions (INBOUND from guest, OUTBOUND from
-- staff/bot) live in the same table for chronological rendering.
--
-- Service-request bridge: chat_messages has an optional linked_ticket_id.
-- v1 does NOT auto-create tickets from chat (the service/department/zone
-- mapping is too hotel-specific). Staff click "Create ticket" in the inbox
-- UI to formalise the existing ticket flow with pre-filled context.
--
-- Per CLAUDE.md:
--   • Multi-tenancy: vaiyu_is_hotel_member RLS on both tables
--   • Writes via SECURITY DEFINER RPCs only (chat-inbound + staff reply)
--   • Audit: per-message rows ARE the audit trail (append-only)
--   • Realtime: messages published; threads polled (lower frequency)

-- ─── Enums ──────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.chat_message_direction AS ENUM ('INBOUND', 'OUTBOUND');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.chat_message_type AS ENUM (
    'TEXT', 'BUTTON_REPLY', 'LIST_REPLY', 'TEMPLATE',
    'IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO', 'LOCATION', 'CONTACTS', 'SYSTEM'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.chat_message_status AS ENUM (
    'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── chat_threads ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.wa_chat_threads (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id            uuid NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,

  guest_phone         text NOT NULL CHECK (length(guest_phone) BETWEEN 6 AND 32),
  guest_name          text,
  -- Most recent booking we've matched to this phone (nullable for unknown-guest threads)
  last_booking_id     uuid REFERENCES public.bookings(id) ON DELETE SET NULL,

  -- Provider tracking — single-account model, but per-thread we record the
  -- BSP that delivered the message so a future provider switch doesn't
  -- silently break in-flight threads.
  provider            text NOT NULL DEFAULT 'INTERAKT'
                        CHECK (provider IN ('META_DIRECT', 'INTERAKT')),

  -- Conversation state (the hybrid inbound state machine).
  -- Examples:
  --   { "pending": "housekeeping_time", "since": "<iso>", "category": "housekeeping" }
  --   { "pending": null }
  -- Cleared when state_expires_at < now() at next inbound.
  state               jsonb NOT NULL DEFAULT '{}'::jsonb,
  state_expires_at    timestamptz,

  -- 24h window tracking — the moment of the LATEST guest message decides
  -- whether free-text outbound is still allowed. Computed in a trigger from
  -- chat_messages.
  last_inbound_at     timestamptz,
  last_outbound_at    timestamptz,
  last_message_at     timestamptz NOT NULL DEFAULT now(),

  unread_count        int NOT NULL DEFAULT 0 CHECK (unread_count >= 0),

  -- Optional assignment to a staff member (for "this is mine" UX)
  assigned_to         uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- One open thread per (hotel, guest_phone). Soft-delete via a future
  -- archived_at if ever needed.
  CONSTRAINT chat_threads_uq UNIQUE (hotel_id, guest_phone)
);
COMMENT ON TABLE public.wa_chat_threads IS
  'One thread per (hotel, guest_phone). Carries the conversation state machine, 24h-window tracking, and unread badge counter.';

CREATE INDEX IF NOT EXISTS idx_chat_threads_hotel_recent
  ON public.wa_chat_threads (hotel_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_threads_unread
  ON public.wa_chat_threads (hotel_id, unread_count) WHERE unread_count > 0;
CREATE INDEX IF NOT EXISTS idx_chat_threads_guest_phone
  ON public.wa_chat_threads (guest_phone);

DROP TRIGGER IF EXISTS trg_chat_threads_updated_at ON public.wa_chat_threads;
CREATE TRIGGER trg_chat_threads_updated_at
  BEFORE UPDATE ON public.wa_chat_threads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── chat_messages ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.wa_chat_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id           uuid NOT NULL REFERENCES public.wa_chat_threads(id) ON DELETE CASCADE,
  hotel_id            uuid NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,

  direction           public.chat_message_direction NOT NULL,
  message_type        public.chat_message_type NOT NULL,

  body                text,        -- displayed text (or null for media)
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
                                  -- raw provider data, template params, media urls
  template_code       text,        -- our internal name (e.g. 'precheckin_link')
  template_name       text,        -- the BSP-side template name actually sent

  provider            text NOT NULL DEFAULT 'INTERAKT'
                        CHECK (provider IN ('META_DIRECT', 'INTERAKT')),
  provider_message_id text,
  status              public.chat_message_status NOT NULL DEFAULT 'QUEUED',
  failed_reason       text,

  -- Origin tracking
  staff_user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_bot              boolean NOT NULL DEFAULT false,

  -- Optional ticket linkage when staff converts a thread into a service request
  linked_ticket_id    uuid REFERENCES public.tickets(id) ON DELETE SET NULL,

  -- Delivery telemetry (mirror of notification_queue but per-message)
  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz,

  created_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- chat_messages are append-only; no updated_at, no DELETE policy

  CONSTRAINT chat_messages_provider_msg_id_uq
    UNIQUE (provider_message_id) DEFERRABLE INITIALLY DEFERRED
);
COMMENT ON TABLE public.wa_chat_messages IS
  'Append-only message log. Both INBOUND (guest) and OUTBOUND (staff or bot) live here for chronological rendering. provider_message_id is UNIQUE (when present) for webhook idempotency.';

CREATE INDEX IF NOT EXISTS idx_chat_messages_thread
  ON public.wa_chat_messages (thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_hotel_recent
  ON public.wa_chat_messages (hotel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_provider_id
  ON public.wa_chat_messages (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Append-only enforcement: block UPDATE (only delivery telemetry can move forward)
-- and DELETE. We exempt the specific telemetry columns via a trigger.
CREATE OR REPLACE FUNCTION public._chat_messages_restrict_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Allow only delivery-telemetry transitions (status + timestamps).
  -- Body, direction, type, payload, links are immutable post-INSERT.
  IF (OLD.body IS DISTINCT FROM NEW.body)
     OR (OLD.direction IS DISTINCT FROM NEW.direction)
     OR (OLD.message_type IS DISTINCT FROM NEW.message_type)
     OR (OLD.payload IS DISTINCT FROM NEW.payload)
     OR (OLD.thread_id IS DISTINCT FROM NEW.thread_id)
     OR (OLD.hotel_id IS DISTINCT FROM NEW.hotel_id)
     OR (OLD.staff_user_id IS DISTINCT FROM NEW.staff_user_id)
     OR (OLD.is_bot IS DISTINCT FROM NEW.is_bot)
     OR (OLD.template_code IS DISTINCT FROM NEW.template_code)
  THEN
    RAISE EXCEPTION 'CHAT_MESSAGE_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_chat_messages_restrict_update ON public.wa_chat_messages;
CREATE TRIGGER trg_chat_messages_restrict_update
  BEFORE UPDATE ON public.wa_chat_messages
  FOR EACH ROW EXECUTE FUNCTION public._chat_messages_restrict_update();

CREATE OR REPLACE FUNCTION public._chat_messages_block_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'CHAT_MESSAGE_DELETE_FORBIDDEN';
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_chat_messages_block_delete ON public.wa_chat_messages;
CREATE TRIGGER trg_chat_messages_block_delete
  BEFORE DELETE ON public.wa_chat_messages
  FOR EACH ROW EXECUTE FUNCTION public._chat_messages_block_delete();

-- ─── Thread mutation triggers (last_*_at + unread_count) ────────────────────

-- On INBOUND insert: bump last_inbound_at, last_message_at, unread_count
-- On OUTBOUND insert: bump last_outbound_at, last_message_at; do NOT reset
--    unread_count (only the staff inbox UI does that via mark_thread_read)
CREATE OR REPLACE FUNCTION public._chat_messages_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NEW.direction = 'INBOUND' THEN
    UPDATE public.wa_chat_threads SET
      last_inbound_at = NEW.created_at,
      last_message_at = NEW.created_at,
      unread_count    = unread_count + 1
     WHERE id = NEW.thread_id;
  ELSE
    UPDATE public.wa_chat_threads SET
      last_outbound_at = NEW.created_at,
      last_message_at  = NEW.created_at
     WHERE id = NEW.thread_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_chat_messages_after_insert ON public.wa_chat_messages;
CREATE TRIGGER trg_chat_messages_after_insert
  AFTER INSERT ON public.wa_chat_messages
  FOR EACH ROW EXECUTE FUNCTION public._chat_messages_after_insert();

-- ─── RPC: mark_chat_thread_read ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_chat_thread_read(p_thread_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_hotel_id uuid;
BEGIN
  SELECT hotel_id INTO v_hotel_id
    FROM public.wa_chat_threads
   WHERE id = p_thread_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'THREAD_NOT_FOUND'; END IF;
  IF NOT public.vaiyu_is_hotel_member(v_hotel_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  UPDATE public.wa_chat_threads SET unread_count = 0
   WHERE id = p_thread_id AND unread_count > 0;

  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mark_chat_thread_read(uuid) TO authenticated;

-- ─── RPC: assign_chat_thread (optional ownership) ──────────────────────────

CREATE OR REPLACE FUNCTION public.assign_chat_thread(p_thread_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_hotel_id uuid;
BEGIN
  SELECT hotel_id INTO v_hotel_id FROM public.wa_chat_threads WHERE id = p_thread_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'THREAD_NOT_FOUND'; END IF;
  IF NOT public.vaiyu_is_hotel_member(v_hotel_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;
  -- Allow self-assign or assign-to-null (unassign)
  IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() THEN
    -- Manager+ can assign anyone; members can only self-assign
    IF NOT public.vaiyu_is_hotel_finance_manager(v_hotel_id) THEN
      RAISE EXCEPTION 'NOT_A_MANAGER';
    END IF;
  END IF;
  UPDATE public.wa_chat_threads SET assigned_to = p_user_id WHERE id = p_thread_id;
  RETURN jsonb_build_object('ok', true, 'assigned_to', p_user_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.assign_chat_thread(uuid, uuid) TO authenticated;

-- ─── Read view: active threads with 24h-window state ───────────────────────

DROP VIEW IF EXISTS public.v_chat_threads CASCADE;
CREATE VIEW public.v_chat_threads WITH (security_invoker = on) AS
  SELECT
    t.id,
    t.hotel_id,
    t.guest_phone,
    t.guest_name,
    t.last_booking_id,
    t.last_message_at,
    t.last_inbound_at,
    t.last_outbound_at,
    t.unread_count,
    t.assigned_to,
    t.state,
    t.state_expires_at,
    -- Free-text outbound allowed iff last guest message <24h ago
    (t.last_inbound_at IS NOT NULL
       AND t.last_inbound_at > now() - interval '24 hours') AS within_24h_window,
    GREATEST(
      0,
      EXTRACT(EPOCH FROM (t.last_inbound_at + interval '24 hours' - now()))::int
    ) AS window_seconds_remaining,
    t.created_at,
    t.updated_at
  FROM public.wa_chat_threads t
  WHERE public.vaiyu_is_hotel_member(t.hotel_id);
COMMENT ON VIEW public.v_chat_threads IS
  'Primary read surface for the staff inbox. Adds derived 24h-window fields so the UI can show "Free-text reply available for N seconds" without re-deriving on the client.';
GRANT SELECT ON public.v_chat_threads TO authenticated;

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.wa_chat_threads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_threads_select_members  ON public.wa_chat_threads;
CREATE POLICY chat_threads_select_members
  ON public.wa_chat_threads FOR SELECT
  TO authenticated
  USING (public.vaiyu_is_hotel_member(hotel_id));

DROP POLICY IF EXISTS chat_messages_select_members ON public.wa_chat_messages;
CREATE POLICY chat_messages_select_members
  ON public.wa_chat_messages FOR SELECT
  TO authenticated
  USING (public.vaiyu_is_hotel_member(hotel_id));

-- Writes only via RPCs (revoke direct DML from anon/authenticated)
REVOKE ALL ON public.wa_chat_threads  FROM anon, authenticated;
REVOKE ALL ON public.wa_chat_messages FROM anon, authenticated;
GRANT  SELECT ON public.wa_chat_threads  TO authenticated;
GRANT  SELECT ON public.wa_chat_messages TO authenticated;

-- ─── Realtime publication for the staff inbox ───────────────────────────────

-- Add chat_messages to the supabase_realtime publication so the staff UI
-- subscribes to live INSERTs. Guard with DO block so re-applying the
-- migration on a DB where the publication already includes the table is safe.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.wa_chat_messages;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.wa_chat_threads;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;
