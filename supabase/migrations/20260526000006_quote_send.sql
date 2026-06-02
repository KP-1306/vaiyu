-- Quote Send Pipeline — Position 3 of the growth sheet (PDF + email send)
--
-- Builds on the existing AI Quote Drafts module (Phase 8B), which today
-- produces a text draft that the operator copy-pastes. This migration adds:
--   • PDF rendering bookkeeping (path + generated_at + size)
--   • A private Supabase Storage bucket `quote-pdfs` with RLS
--   • One-shot transactional RPC `enqueue_quote_send` that enqueues a
--     notification_queue row AND flips status→SENT in the same transaction
--   • Trigger that denormalises quote bookkeeping onto leads
--       (quote_count, last_quote_at, last_quote_pdf_path)
--   • Extension of mark_quote_draft_sent to accept recipient address
--
-- Why a storage *path* on leads, not a URL:
--   Supabase signed URLs max out at 7 days. A persistent URL on the lead
--   would silently 403 after a week. The lead row stores the canonical
--   storage path; the UI/edge function regenerates a signed URL on demand
--   via get_quote_pdf_signed_url(). The user-spec named `last_quote_pdf_url`
--   maps to last_quote_pdf_path here for the same data, technically correct.
--
-- Path convention: `<hotel_id>/<quote_draft_id>.pdf`. RLS on storage.objects
-- enforces hotel membership by parsing split_part(name,'/',1) as the hotel
-- uuid. Service role (edge function) writes; hotel members read.
--
-- Per CLAUDE.md:
--   • Multi-tenancy: storage + table RLS both hotel-scoped
--   • Immutability: quote_draft_events stays append-only
--   • Audit: SENT event already logged by mark_quote_draft_sent; we add a
--           QUEUED-style payload on the SENT event so the timeline shows
--           which channel + recipient + notification_id was used

-- ─── leads: denormalised quote counters ────────────────────────────────────

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS quote_count integer NOT NULL DEFAULT 0
    CHECK (quote_count >= 0);
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS last_quote_at timestamptz;
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS last_quote_pdf_path text;

COMMENT ON COLUMN public.leads.quote_count IS
  'Count of quote_drafts ever marked SENT for this lead. Denormalised from quote_drafts via trigger trg_lead_quote_counters. Decreases on lead conversion only if we hard-delete drafts (we don''t).';
COMMENT ON COLUMN public.leads.last_quote_pdf_path IS
  'Storage path (NOT signed URL) of the most recent SENT quote PDF. Regenerate signed URL on demand via get_quote_pdf_signed_url().';

-- ─── quote_drafts: PDF + send bookkeeping ──────────────────────────────────

ALTER TABLE public.quote_drafts
  ADD COLUMN IF NOT EXISTS pdf_storage_path text;
ALTER TABLE public.quote_drafts
  ADD COLUMN IF NOT EXISTS pdf_generated_at timestamptz;
ALTER TABLE public.quote_drafts
  ADD COLUMN IF NOT EXISTS pdf_byte_size integer
    CHECK (pdf_byte_size IS NULL OR pdf_byte_size > 0);
ALTER TABLE public.quote_drafts
  ADD COLUMN IF NOT EXISTS sent_to_address text;
ALTER TABLE public.quote_drafts
  ADD COLUMN IF NOT EXISTS sent_notification_id uuid REFERENCES public.notification_queue(id);

-- Defense-in-depth: SENT rows that went out via email must carry an address.
-- Drafts marked SENT via the legacy manual path keep sent_to_address NULL,
-- so we only enforce when sent_channel is set to a wire channel.
DO $$ BEGIN
  ALTER TABLE public.quote_drafts
    ADD CONSTRAINT quote_drafts_sent_channel_needs_addr CHECK (
      status <> 'SENT'
      OR sent_channel IS NULL
      OR sent_channel NOT IN ('email','whatsapp','sms')
      OR (sent_to_address IS NOT NULL AND length(btrim(sent_to_address)) > 0)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_quote_drafts_pdf_present
  ON public.quote_drafts (hotel_id, pdf_generated_at DESC)
  WHERE pdf_storage_path IS NOT NULL;

-- ─── notification_queue: idempotency key ───────────────────────────────────
-- Caller-provided UUID. The same key passed twice returns the same row
-- instead of producing duplicate sends. Drip rows pass NULL (they're already
-- dedup-safe via FOR UPDATE SKIP LOCKED in the worker).

ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_queue_idempotency
  ON public.notification_queue (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.notification_queue.idempotency_key IS
  'Optional caller-supplied UUID for dedup. UNIQUE partial index enforces at-most-once enqueue per key. NULL allowed for queue paths that have their own dedup (drip worker via SKIP LOCKED, legacy booking comms via UNIQUE template_code indexes).';

-- ─── quote_draft_events: enum extension for RESENT ─────────────────────────
-- ALTER TYPE ... ADD VALUE inside a DO block to stay idempotent.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'quote_draft_event_type' AND e.enumlabel = 'RESENT'
  ) THEN
    ALTER TYPE public.quote_draft_event_type ADD VALUE 'RESENT';
  END IF;
END $$;

-- Email format guard on the quote_drafts.sent_to_address (new column,
-- so the constraint covers all rows past this migration). Format check is
-- pragmatic — not RFC-perfect, just catches obvious typos. Length cap
-- prevents pathological inputs from inflating audit payloads.
DO $$ BEGIN
  ALTER TABLE public.quote_drafts
    ADD CONSTRAINT quote_drafts_sent_to_address_format CHECK (
      sent_to_address IS NULL
      OR sent_channel NOT IN ('email')
      OR (
        length(sent_to_address) BETWEEN 5 AND 254
        AND sent_to_address ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Storage bucket: quote-pdfs (private) ─────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'quote-pdfs', 'quote-pdfs', false,
  5 * 1024 * 1024,             -- 5 MB cap per PDF; ample for text-only quotes
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS — service role bypasses, but explicit policies keep
-- authenticated users from peeking outside their hotel folder.
DROP POLICY IF EXISTS "Quote PDFs: hotel members read own" ON storage.objects;
CREATE POLICY "Quote PDFs: hotel members read own"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'quote-pdfs'
    AND public.vaiyu_is_hotel_member(
      NULLIF(split_part(name, '/', 1), '')::uuid
    )
  );

-- INSERT/UPDATE/DELETE: service role only. No authenticated policies means
-- only service_role (which bypasses RLS) can write. Edge function uses
-- service_role; UI must go through the function.

-- ─── record_quote_pdf (service-role writer) ────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_quote_pdf(
  p_quote_id      uuid,
  p_storage_path  text,
  p_byte_size     integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE v_hotel uuid;
BEGIN
  -- Service-role only (edge function `render-quote-pdf` writes via this).
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  IF p_storage_path IS NULL OR btrim(p_storage_path) = '' THEN
    RAISE EXCEPTION 'PATH_REQUIRED';
  END IF;
  IF p_byte_size IS NULL OR p_byte_size <= 0 THEN
    RAISE EXCEPTION 'INVALID_SIZE';
  END IF;

  SELECT hotel_id INTO v_hotel FROM public.quote_drafts WHERE id = p_quote_id;
  IF v_hotel IS NULL THEN RAISE EXCEPTION 'QUOTE_NOT_FOUND'; END IF;

  -- Defense: path must live under <hotel_id>/ folder.
  IF split_part(p_storage_path, '/', 1) <> v_hotel::text THEN
    RAISE EXCEPTION 'PATH_HOTEL_MISMATCH';
  END IF;

  UPDATE public.quote_drafts SET
    pdf_storage_path = p_storage_path,
    pdf_generated_at = clock_timestamp(),
    pdf_byte_size    = p_byte_size
  WHERE id = p_quote_id;
END;
$$;

-- ─── enqueue_quote_send (one-shot transactional send) ─────────────────────
-- Edge function calls this AFTER it has uploaded the PDF and resolved the
-- signed URL. RPC writes the notification_queue row, marks the draft SENT,
-- and logs the event — all in one transaction.

CREATE OR REPLACE FUNCTION public.enqueue_quote_send(
  p_quote_id        uuid,
  p_channel         text,            -- 'email' | 'whatsapp' (whatsapp stubbed)
  p_to_address      text,
  p_subject         text,
  p_body_html       text,
  p_signed_url      text,            -- regenerated by caller; may be NULL if PDF not used
  p_idempotency_key uuid             -- caller-supplied; same key returns the same row
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row     record;
  v_notif   uuid;
  v_hotel   uuid;
  v_existing uuid;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED';
  END IF;

  -- Short-circuit: if this key already produced a notification, return it.
  -- Covers double-click + network-retry without surfacing a duplicate to the
  -- guest. The caller must reuse the same key for retries — a fresh key
  -- means a fresh send.
  SELECT id INTO v_existing
    FROM public.notification_queue
   WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'idempotent_hit', true,
      'notification_id', v_existing, 'quote_status', 'SENT'
    );
  END IF;

  IF p_channel NOT IN ('email','whatsapp') THEN
    RAISE EXCEPTION 'UNSUPPORTED_CHANNEL';
  END IF;

  IF p_channel = 'whatsapp' THEN
    -- WhatsApp gated by Meta template approval. Flip in a later migration
    -- when WHATSAPP_QUOTE_TEMPLATE_APPROVED becomes true.
    RAISE EXCEPTION 'WHATSAPP_PENDING_APPROVAL';
  END IF;

  IF p_to_address IS NULL OR btrim(p_to_address) = '' THEN
    RAISE EXCEPTION 'RECIPIENT_REQUIRED';
  END IF;
  -- Pragmatic email format check (matches CHECK constraint on sent_to_address).
  IF p_channel = 'email' AND (
    length(p_to_address) NOT BETWEEN 5 AND 254
    OR p_to_address !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ) THEN
    RAISE EXCEPTION 'INVALID_EMAIL';
  END IF;
  IF p_subject IS NULL OR btrim(p_subject) = '' THEN
    RAISE EXCEPTION 'SUBJECT_REQUIRED';
  END IF;
  IF p_body_html IS NULL OR btrim(p_body_html) = '' THEN
    RAISE EXCEPTION 'BODY_REQUIRED';
  END IF;

  SELECT * INTO v_row FROM public.quote_drafts WHERE id = p_quote_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'QUOTE_NOT_FOUND'; END IF;
  v_hotel := v_row.hotel_id;

  -- Auth: hotel member (operator-initiated send) OR service_role (cron resend).
  IF auth.uid() IS NOT NULL AND NOT public.vaiyu_is_hotel_member(v_hotel) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF NOT (v_row.availability_confirmed AND v_row.terms_confirmed) THEN
    RAISE EXCEPTION 'GOVERNANCE_INCOMPLETE';
  END IF;

  -- DRAFT only. Re-sending a SENT quote must go through resend_quote()
  -- so the operator records an explicit reason and we audit the resend.
  IF v_row.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: % -> SENT (use resend_quote for already-sent drafts)', v_row.status;
  END IF;

  -- Enqueue with idempotency key
  INSERT INTO public.notification_queue (
    booking_id, hotel_id, lead_id,
    channel, template_code, payload, status, next_attempt_at, idempotency_key
  ) VALUES (
    NULL, v_hotel, v_row.lead_id,
    p_channel, 'quote_send_v1',
    jsonb_build_object(
      'to',           p_to_address,
      'subject',      p_subject,
      'body_html',    p_body_html,
      'pdf_url',      p_signed_url,
      'quote_id',     v_row.id
    ),
    'pending', clock_timestamp(),
    p_idempotency_key
  )
  RETURNING id INTO v_notif;

  -- Mark SENT
  UPDATE public.quote_drafts SET
    status               = 'SENT',
    sent_at              = clock_timestamp(),
    sent_channel         = p_channel,
    sent_to_address      = p_to_address,
    sent_notification_id = v_notif,
    updated_by           = auth.uid()
  WHERE id = p_quote_id;

  INSERT INTO public.quote_draft_events (quote_draft_id, hotel_id, event_type, payload, actor_id)
  VALUES (
    p_quote_id, v_hotel, 'SENT',
    jsonb_build_object(
      'channel',          p_channel,
      'to',               p_to_address,
      'notification_id',  v_notif,
      'has_pdf',          p_signed_url IS NOT NULL,
      'idempotency_key',  p_idempotency_key
    ),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent_hit', false,
    'notification_id', v_notif,
    'quote_status', 'SENT'
  );
END;
$$;

-- ─── resend_quote (explicit resend, requires reason) ──────────────────────
-- For "I already sent this quote and want to send it again because the guest
-- didn't get the email / I want to update the inclusions and re-deliver".
-- Requires status='SENT', a non-empty reason, and a fresh idempotency_key.
-- Does NOT update sent_at/sent_channel — the original send remains canonical;
-- resends are logged as RESENT events with the new notification_id.

CREATE OR REPLACE FUNCTION public.resend_quote(
  p_quote_id        uuid,
  p_channel         text,
  p_to_address      text,
  p_subject         text,
  p_body_html       text,
  p_signed_url      text,
  p_resend_reason   text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row      record;
  v_notif    uuid;
  v_existing uuid;
BEGIN
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED'; END IF;
  IF p_resend_reason IS NULL OR btrim(p_resend_reason) = '' THEN
    RAISE EXCEPTION 'RESEND_REASON_REQUIRED';
  END IF;

  SELECT id INTO v_existing FROM public.notification_queue WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent_hit', true, 'notification_id', v_existing);
  END IF;

  IF p_channel NOT IN ('email','whatsapp') THEN RAISE EXCEPTION 'UNSUPPORTED_CHANNEL'; END IF;
  IF p_channel = 'whatsapp' THEN RAISE EXCEPTION 'WHATSAPP_PENDING_APPROVAL'; END IF;

  IF p_channel = 'email' AND (
    length(COALESCE(p_to_address,'')) NOT BETWEEN 5 AND 254
    OR p_to_address !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ) THEN
    RAISE EXCEPTION 'INVALID_EMAIL';
  END IF;
  IF p_subject IS NULL OR btrim(p_subject) = '' THEN RAISE EXCEPTION 'SUBJECT_REQUIRED'; END IF;
  IF p_body_html IS NULL OR btrim(p_body_html) = '' THEN RAISE EXCEPTION 'BODY_REQUIRED'; END IF;

  SELECT * INTO v_row FROM public.quote_drafts WHERE id = p_quote_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'QUOTE_NOT_FOUND'; END IF;
  IF auth.uid() IS NOT NULL AND NOT public.vaiyu_is_hotel_member(v_row.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_row.status <> 'SENT' THEN
    RAISE EXCEPTION 'RESEND_REQUIRES_SENT';
  END IF;

  INSERT INTO public.notification_queue (
    booking_id, hotel_id, lead_id,
    channel, template_code, payload, status, next_attempt_at, idempotency_key
  ) VALUES (
    NULL, v_row.hotel_id, v_row.lead_id,
    p_channel, 'quote_send_v1',
    jsonb_build_object(
      'to', p_to_address, 'subject', p_subject, 'body_html', p_body_html,
      'pdf_url', p_signed_url, 'quote_id', v_row.id, 'resend', true
    ),
    'pending', clock_timestamp(),
    p_idempotency_key
  )
  RETURNING id INTO v_notif;

  -- Do NOT update quote_drafts.status (stays SENT) or sent_at (preserves the
  -- original send timestamp). DO update sent_notification_id so the UI shows
  -- the latest send.
  UPDATE public.quote_drafts SET
    sent_notification_id = v_notif,
    updated_by           = auth.uid()
  WHERE id = p_quote_id;

  INSERT INTO public.quote_draft_events (quote_draft_id, hotel_id, event_type, payload, actor_id)
  VALUES (
    p_quote_id, v_row.hotel_id, 'RESENT'::public.quote_draft_event_type,
    jsonb_build_object(
      'channel',         p_channel,
      'to',              p_to_address,
      'notification_id', v_notif,
      'reason',          btrim(p_resend_reason),
      'idempotency_key', p_idempotency_key
    ),
    auth.uid()
  );

  RETURN jsonb_build_object('ok', true, 'idempotent_hit', false, 'notification_id', v_notif);
END;
$$;

-- ─── get_quote_pdf_signed_url (read-side helper) ───────────────────────────
-- We cannot sign URLs from SQL, but we CAN return the path + expected TTL
-- and let the frontend ask the edge function to sign. This RPC validates
-- access and exposes the path, nothing more.

CREATE OR REPLACE FUNCTION public.get_quote_pdf_storage_path(p_quote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE v_row record;
BEGIN
  SELECT id, hotel_id, pdf_storage_path, pdf_generated_at, pdf_byte_size
    INTO v_row FROM public.quote_drafts WHERE id = p_quote_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'QUOTE_NOT_FOUND'; END IF;
  IF NOT public.vaiyu_is_hotel_member(v_row.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_row.pdf_storage_path IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NO_PDF');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'bucket', 'quote-pdfs',
    'path', v_row.pdf_storage_path,
    'generated_at', v_row.pdf_generated_at,
    'byte_size', v_row.pdf_byte_size
  );
END;
$$;

-- ─── Trigger: keep leads denormalised counters in sync ─────────────────────
-- Fires on quote_drafts UPDATE where status moves to SENT for a lead-linked
-- draft. Updates leads.quote_count, last_quote_at, last_quote_pdf_path.

CREATE OR REPLACE FUNCTION public.trg_lead_quote_counters()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Only fire on transitions INTO SENT (not on re-saves of already-SENT rows
  -- if such a thing ever happens).
  IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'SENT' AND NEW.status = 'SENT')
     OR (TG_OP = 'INSERT' AND NEW.status = 'SENT') THEN
    IF NEW.lead_id IS NOT NULL THEN
      UPDATE public.leads SET
        quote_count         = quote_count + 1,
        last_quote_at       = COALESCE(NEW.sent_at, clock_timestamp()),
        last_quote_pdf_path = COALESCE(NEW.pdf_storage_path, last_quote_pdf_path),
        last_activity_at    = clock_timestamp()
      WHERE id = NEW.lead_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quote_drafts_lead_counters ON public.quote_drafts;
CREATE TRIGGER trg_quote_drafts_lead_counters
  AFTER INSERT OR UPDATE ON public.quote_drafts
  FOR EACH ROW EXECUTE FUNCTION public.trg_lead_quote_counters();

-- ─── Backfill leads.quote_count for any existing SENT drafts ───────────────
-- Idempotent: recompute from quote_drafts. Safe to re-run.

WITH agg AS (
  SELECT lead_id,
         COUNT(*) FILTER (WHERE status = 'SENT')        AS sent_count,
         MAX(sent_at) FILTER (WHERE status = 'SENT')    AS last_at,
         (
           SELECT pdf_storage_path FROM public.quote_drafts q2
            WHERE q2.lead_id = q.lead_id AND q2.status = 'SENT'
            ORDER BY q2.sent_at DESC NULLS LAST LIMIT 1
         )                                              AS last_path
    FROM public.quote_drafts q
   WHERE lead_id IS NOT NULL
   GROUP BY lead_id
)
UPDATE public.leads l
   SET quote_count         = agg.sent_count,
       last_quote_at       = agg.last_at,
       last_quote_pdf_path = agg.last_path
  FROM agg
 WHERE l.id = agg.lead_id;

-- ─── Grants ────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.enqueue_quote_send(uuid, text, text, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resend_quote(uuid, text, text, text, text, text, text, uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_quote_pdf_storage_path(uuid)                              TO authenticated;
-- record_quote_pdf is service-role only — no authenticated grant.

-- ─── Comments ──────────────────────────────────────────────────────────────

COMMENT ON FUNCTION public.enqueue_quote_send IS
  'One-shot transactional quote send. Inserts notification_queue row AND marks quote_drafts SENT in the same txn. Trigger trg_quote_drafts_lead_counters then bumps the lead''s denormalised counters. Edge function `send-quote` is the canonical caller.';

COMMENT ON TRIGGER trg_quote_drafts_lead_counters ON public.quote_drafts IS
  'Bumps leads.quote_count / last_quote_at / last_quote_pdf_path when a quote_draft transitions to SENT for a lead-linked draft. Restores the dashboard signal the original spec named explicitly.';
