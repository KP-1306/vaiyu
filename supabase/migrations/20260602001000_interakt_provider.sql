-- Interakt WhatsApp Integration — Foundation Migration 1 of 3
--
-- Adds the provider routing layer + delivery tracking + cost-cap controls
-- to the existing notification_queue. Dual-mode is preserved during cutover:
--   notification_queue.provider = 'META_DIRECT'   (existing path, default)
--   notification_queue.provider = 'INTERAKT'      (new path, opt-in per hotel)
--
-- Per-hotel `whatsapp_provider` column on hotels decides which provider
-- new queue rows inherit. Flipping a hotel from META_DIRECT to INTERAKT does
-- not touch in-flight rows — they drain via the provider they were enqueued
-- with. This is the safe cutover model.
--
-- Cost cap: each hotel sets a daily template-send limit. When hit, new
-- WhatsApp rows stay 'pending' with next_attempt_at bumped to tomorrow.
-- An audit-log entry fires once per hotel per day so owners get notified.
--
-- Idempotency: provider_message_id is the unique key for webhook reconciliation.
-- Both META_DIRECT and INTERAKT paths populate this with whatever ID the
-- provider returns; the partial UNIQUE index prevents double-recording even
-- if a webhook retries.
--
-- Per CLAUDE.md:
--   • Money math: N/A (no INR fields)
--   • Immutability: notification_queue rows remain mutable for status updates
--   • Audit: cap hits and provider switches → va_audit_logs
--   • Multi-tenancy: writes via vaiyu_is_hotel_finance_manager only (RPC)

-- ─── notification_queue: provider routing + delivery tracking ───────────────

DO $$ BEGIN
  ALTER TABLE public.notification_queue
    ADD COLUMN provider text NOT NULL DEFAULT 'META_DIRECT'
      CHECK (provider IN ('META_DIRECT', 'INTERAKT'));
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.notification_queue
    ADD COLUMN provider_message_id text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.notification_queue
    ADD COLUMN delivered_at timestamptz;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.notification_queue
    ADD COLUMN read_at timestamptz;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.notification_queue
    ADD COLUMN failed_reason text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.notification_queue
    ADD COLUMN hotel_id uuid REFERENCES public.hotels(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Idempotency: one row per provider_message_id when present
CREATE UNIQUE INDEX IF NOT EXISTS notification_queue_provider_message_id_uq
  ON public.notification_queue (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Lookup by hotel for cap calculations + delivery-rate widgets
CREATE INDEX IF NOT EXISTS idx_notification_queue_hotel_sent
  ON public.notification_queue (hotel_id, status, sent_at)
  WHERE channel = 'whatsapp';

-- Backfill hotel_id from booking_id for existing rows (best-effort, no error)
DO $$ BEGIN
  UPDATE public.notification_queue nq
     SET hotel_id = b.hotel_id
    FROM public.bookings b
   WHERE nq.booking_id = b.id
     AND nq.hotel_id IS NULL;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ─── hotels: per-hotel provider switch + daily template cap ─────────────────

DO $$ BEGIN
  ALTER TABLE public.hotels
    ADD COLUMN whatsapp_provider text NOT NULL DEFAULT 'META_DIRECT'
      CHECK (whatsapp_provider IN ('META_DIRECT', 'INTERAKT'));
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.hotels
    ADD COLUMN whatsapp_daily_cap int NOT NULL DEFAULT 200
      CHECK (whatsapp_daily_cap BETWEEN 0 AND 10000);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

COMMENT ON COLUMN public.hotels.whatsapp_provider IS
  'Which BSP routes outbound WhatsApp for this hotel. META_DIRECT = legacy Cloud-API path; INTERAKT = Interakt BSP. New queue rows inherit this; in-flight rows drain via their own provider.';
COMMENT ON COLUMN public.hotels.whatsapp_daily_cap IS
  'Daily template-send cap to prevent cost runaway. 0 disables WhatsApp; default 200 = ~₹400/day at standard utility-template pricing. Cap is per-hotel per-IST-day.';

-- ─── Helpers ────────────────────────────────────────────────────────────────

-- Count today's sent + processing template messages for a hotel.
-- IST = UTC+5:30. Used by the dispatcher to enforce daily_cap before
-- handing a row to the provider.
CREATE OR REPLACE FUNCTION public.wa_template_sends_today(p_hotel_id uuid)
RETURNS int
LANGUAGE sql STABLE
SET search_path = 'public'
AS $$
  SELECT COUNT(*)::int
    FROM public.notification_queue
   WHERE hotel_id = p_hotel_id
     AND channel = 'whatsapp'
     AND provider = 'INTERAKT'
     AND status IN ('sent', 'processing')
     -- IST window: today's 00:00 IST = today's -5:30 UTC
     AND COALESCE(sent_at, created_at) >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')
                                          AT TIME ZONE 'Asia/Kolkata';
$$;
COMMENT ON FUNCTION public.wa_template_sends_today(uuid) IS
  'Counts today (IST) sent or in-flight Interakt template messages for cap enforcement.';

GRANT EXECUTE ON FUNCTION public.wa_template_sends_today(uuid)
  TO anon, authenticated, service_role;

-- Owner RPC to update WhatsApp settings. Manager+ only.
CREATE OR REPLACE FUNCTION public.set_hotel_whatsapp_settings(
  p_hotel_id        uuid,
  p_enabled         boolean DEFAULT NULL,
  p_provider        text DEFAULT NULL,
  p_daily_cap       int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_prev_provider text;
  v_new_provider  text;
BEGIN
  IF NOT public.vaiyu_is_hotel_finance_manager(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_A_MANAGER';
  END IF;

  IF p_provider IS NOT NULL AND p_provider NOT IN ('META_DIRECT', 'INTERAKT') THEN
    RAISE EXCEPTION 'INVALID_PROVIDER';
  END IF;
  IF p_daily_cap IS NOT NULL AND (p_daily_cap < 0 OR p_daily_cap > 10000) THEN
    RAISE EXCEPTION 'INVALID_CAP';
  END IF;

  SELECT whatsapp_provider INTO v_prev_provider FROM public.hotels WHERE id = p_hotel_id;

  UPDATE public.hotels SET
    whatsapp_enabled   = COALESCE(p_enabled,   whatsapp_enabled),
    whatsapp_provider  = COALESCE(p_provider,  whatsapp_provider),
    whatsapp_daily_cap = COALESCE(p_daily_cap, whatsapp_daily_cap)
   WHERE id = p_hotel_id
   RETURNING whatsapp_provider INTO v_new_provider;

  -- Audit only when provider actually changed
  IF v_prev_provider IS DISTINCT FROM v_new_provider THEN
    INSERT INTO public.va_audit_logs(action, actor, hotel_id, entity, meta)
    VALUES (
      'whatsapp_provider_switched',
      COALESCE(auth.uid()::text, 'system'),
      p_hotel_id,
      'hotel_whatsapp',
      jsonb_build_object('from', v_prev_provider, 'to', v_new_provider)
    );
  END IF;

  RETURN jsonb_build_object(
    'provider', v_new_provider,
    'enabled', (SELECT whatsapp_enabled FROM public.hotels WHERE id = p_hotel_id),
    'daily_cap', (SELECT whatsapp_daily_cap FROM public.hotels WHERE id = p_hotel_id)
  );
END;
$$;
COMMENT ON FUNCTION public.set_hotel_whatsapp_settings(uuid, boolean, text, int) IS
  'Manager-only WhatsApp settings update. Audit-logs provider switches.';

GRANT EXECUTE ON FUNCTION public.set_hotel_whatsapp_settings(uuid, boolean, text, int)
  TO authenticated;

-- ─── Read view: per-hotel WhatsApp delivery health (last 7d) ────────────────

DROP VIEW IF EXISTS public.v_hotel_whatsapp_health CASCADE;
CREATE VIEW public.v_hotel_whatsapp_health WITH (security_invoker = on) AS
  SELECT h.id AS hotel_id,
         h.slug AS hotel_slug,
         h.whatsapp_enabled,
         h.whatsapp_provider,
         h.whatsapp_daily_cap,
         public.wa_template_sends_today(h.id) AS sent_today,
         (SELECT COUNT(*) FROM public.notification_queue nq
           WHERE nq.hotel_id = h.id AND nq.channel = 'whatsapp'
             AND nq.created_at >= now() - interval '7 days') AS queued_7d,
         (SELECT COUNT(*) FROM public.notification_queue nq
           WHERE nq.hotel_id = h.id AND nq.channel = 'whatsapp' AND nq.status = 'sent'
             AND nq.created_at >= now() - interval '7 days') AS sent_7d,
         (SELECT COUNT(*) FROM public.notification_queue nq
           WHERE nq.hotel_id = h.id AND nq.channel = 'whatsapp' AND nq.status = 'failed'
             AND nq.created_at >= now() - interval '7 days') AS failed_7d,
         (SELECT COUNT(*) FROM public.notification_queue nq
           WHERE nq.hotel_id = h.id AND nq.channel = 'whatsapp' AND nq.delivered_at IS NOT NULL
             AND nq.created_at >= now() - interval '7 days') AS delivered_7d,
         (SELECT COUNT(*) FROM public.notification_queue nq
           WHERE nq.hotel_id = h.id AND nq.channel = 'whatsapp' AND nq.read_at IS NOT NULL
             AND nq.created_at >= now() - interval '7 days') AS read_7d
    FROM public.hotels h
   WHERE public.vaiyu_is_hotel_member(h.id);
COMMENT ON VIEW public.v_hotel_whatsapp_health IS
  'Per-hotel WhatsApp delivery health for the last 7 days. Drives the Owner Settings > WhatsApp page and dashboard delivery-rate strip.';
GRANT SELECT ON public.v_hotel_whatsapp_health TO authenticated;
