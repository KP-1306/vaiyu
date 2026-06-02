-- Inbound signals + per-hotel config + shared audit primitive.
--
-- Closes three loops left open in the prior set of migrations:
--
-- 1. Per-hotel partner_verification_stale_days (was hardcoded to 90 in
--    v_partner_directory; now a column so a hotel can tune the threshold).
--
-- 2. notification_queue.external_message_id — stores Resend's message id
--    (and WhatsApp's wamid) so the inbound webhook handlers can correlate
--    delivery/bounce/complaint/inbound-reply events back to the queue row
--    that fired them. Without this, the webhook would have to fuzzy-match
--    by recipient + sent_at which is brittle.
--
-- 3. vaiyu_log_audit() — single helper for writing va_audit_logs entries.
--    Future RPCs use this instead of inlining the INSERT each time;
--    documenting "use this helper" in CLAUDE.md after this lands.
--    NOTE: per-entity event tables (lead_events / partner_events / etc.)
--    keep their inline writes — those carry typed event_type enums and
--    custom payload schemas that a generic helper can't enforce.

-- ─── 1. Per-hotel verification staleness window ────────────────────────────

ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS partner_verification_stale_days integer NOT NULL DEFAULT 90
    CHECK (partner_verification_stale_days BETWEEN 1 AND 3650);

COMMENT ON COLUMN public.hotels.partner_verification_stale_days IS
  'How many days after VERIFIED before v_partner_directory.is_verification_stale flips true. Per-hotel because some categories (yoga, transport) re-verify monthly while others (laundry) can drift for a year.';

-- Rebuild v_partner_directory to read the per-hotel threshold instead of
-- hardcoded 90 days. Keep the same column shape so frontend consumers
-- don't need to change.

DROP VIEW IF EXISTS public.v_partner_directory;

CREATE VIEW public.v_partner_directory AS
SELECT
  p.*,
  (p.archived_at IS NOT NULL) AS is_archived,
  (
    p.verification_status = 'VERIFIED'
    AND p.last_verified_at IS NOT NULL
    AND p.last_verified_at < (
      now() - make_interval(days => COALESCE(h.partner_verification_stale_days, 90))
    )
  ) AS is_verification_stale,
  (
    SELECT COUNT(*) FROM public.leads l
    WHERE l.partner_id = p.id AND l.deleted_at IS NULL
  ) AS lead_count,
  (
    SELECT COALESCE(SUM(amount_inr), 0) FROM public.partner_commissions c
    WHERE c.partner_id = p.id AND c.status = 'ACCRUED'
  ) AS commission_outstanding_inr,
  (
    SELECT COALESCE(SUM(amount_inr), 0) FROM public.partner_commissions c
    WHERE c.partner_id = p.id AND c.status = 'PAID'
  ) AS commission_paid_inr
FROM public.partners p
LEFT JOIN public.hotels h ON h.id = p.hotel_id;

GRANT SELECT ON public.v_partner_directory TO authenticated;
ALTER VIEW public.v_partner_directory SET (security_invoker = on);

COMMENT ON VIEW public.v_partner_directory IS
  'Directory read view. is_verification_stale uses hotels.partner_verification_stale_days (default 90). security_invoker on so RLS on partners + leads + partner_commissions all apply.';

-- ─── 2. External message id on the notification queue ──────────────────────

ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS external_message_id text;

-- Index for webhook lookups (Resend bounces / WhatsApp delivery receipts).
CREATE INDEX IF NOT EXISTS idx_notification_queue_external_id
  ON public.notification_queue (external_message_id)
  WHERE external_message_id IS NOT NULL;

COMMENT ON COLUMN public.notification_queue.external_message_id IS
  'Provider-side identifier (Resend email_id / WhatsApp wamid). Populated by send-notifications when the send succeeds. Used by resend-webhook + whatsapp-webhook to correlate inbound events to the original queue row.';

-- ─── 3. record_external_message_id (service-role writer) ───────────────────

CREATE OR REPLACE FUNCTION public.record_external_message_id(
  p_notification_id  uuid,
  p_external_id      text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';  -- service-role only
  END IF;
  IF p_notification_id IS NULL OR p_external_id IS NULL OR btrim(p_external_id) = '' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  UPDATE public.notification_queue
     SET external_message_id = p_external_id
   WHERE id = p_notification_id
     AND external_message_id IS NULL;  -- don't overwrite if already set
END;
$$;

-- ─── 4. mark_notification_bounced (auto-pause drip if linked) ──────────────

CREATE OR REPLACE FUNCTION public.mark_notification_bounced(
  p_external_id  text,
  p_reason       text DEFAULT 'BOUNCED'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_notif        record;
  v_paused_subs  integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF p_external_id IS NULL OR btrim(p_external_id) = '' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  SELECT id, hotel_id, lead_id, drip_subscription_id, status
    INTO v_notif
    FROM public.notification_queue
   WHERE external_message_id = p_external_id
   LIMIT 1;
  IF v_notif.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;

  UPDATE public.notification_queue
     SET status = 'failed',
         error_message = p_reason
   WHERE id = v_notif.id
     AND status <> 'failed';

  IF v_notif.drip_subscription_id IS NOT NULL THEN
    UPDATE public.lead_drip_subscriptions
       SET status = 'PAUSED',
           paused_reason = 'BOUNCED',
           next_step_idx = NULL,
           next_step_due_at = NULL
     WHERE id = v_notif.drip_subscription_id
       AND status = 'ACTIVE';
    GET DIAGNOSTICS v_paused_subs = ROW_COUNT;

    INSERT INTO public.lead_drip_events (subscription_id, hotel_id, lead_id, event_type, payload)
    VALUES (
      v_notif.drip_subscription_id, v_notif.hotel_id, v_notif.lead_id,
      'BOUNCED',
      jsonb_build_object('notification_id', v_notif.id, 'reason', p_reason, 'external_id', p_external_id)
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'notification_id', v_notif.id,
    'drip_paused', v_paused_subs > 0
  );
END;
$$;

-- ─── 5. pause_drips_on_lead_reply (inbound reply → auto-pause) ─────────────
-- Called by chat-inbound (WhatsApp reply) and resend-webhook (email reply if
-- inbound parse is configured). Looks up any active drip subscriptions for
-- the matched lead and pauses them with paused_reason='LEAD_REPLIED'.

CREATE OR REPLACE FUNCTION public.pause_drips_on_lead_reply(
  p_hotel_id  uuid,
  p_lead_id   uuid,
  p_channel   text                  -- 'WHATSAPP' | 'EMAIL' | 'SMS'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_paused integer := 0;
  v_reason text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF p_hotel_id IS NULL OR p_lead_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF p_channel NOT IN ('WHATSAPP', 'EMAIL', 'SMS') THEN
    RAISE EXCEPTION 'INVALID_CHANNEL';
  END IF;

  v_reason := 'LEAD_REPLIED_' || p_channel;

  UPDATE public.lead_drip_subscriptions
     SET status = 'PAUSED',
         paused_reason = v_reason,
         next_step_idx = NULL,
         next_step_due_at = NULL
   WHERE lead_id = p_lead_id
     AND hotel_id = p_hotel_id
     AND status = 'ACTIVE';
  GET DIAGNOSTICS v_paused = ROW_COUNT;

  IF v_paused > 0 THEN
    INSERT INTO public.lead_drip_events (subscription_id, hotel_id, lead_id, event_type, payload)
    SELECT id, hotel_id, lead_id, 'PAUSED',
           jsonb_build_object('reason', v_reason, 'trigger','lead_reply', 'channel', p_channel)
      FROM public.lead_drip_subscriptions
     WHERE lead_id = p_lead_id
       AND hotel_id = p_hotel_id
       AND status = 'PAUSED'
       AND paused_reason = v_reason;
  END IF;

  -- Also bump the lead's last_activity_at so dashboards reflect the reply.
  UPDATE public.leads
     SET last_activity_at = clock_timestamp()
   WHERE id = p_lead_id;

  RETURN jsonb_build_object('ok', true, 'paused_count', v_paused);
END;
$$;

-- ─── 6. lookup_lead_by_contact (find lead from inbound contact) ────────────
-- Used by chat-inbound to map a phone/email back to an open lead.
-- Returns the most recent non-deleted, non-terminal lead. If multiple
-- matches, caller picks the freshest.

CREATE OR REPLACE FUNCTION public.lookup_lead_by_contact(
  p_hotel_id  uuid,
  p_phone     text DEFAULT NULL,
  p_email     text DEFAULT NULL
)
RETURNS TABLE (
  lead_id  uuid,
  status   text,
  source   text,
  contact_name text,
  last_activity_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_phone_norm text;
BEGIN
  IF p_hotel_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF (p_phone IS NULL OR btrim(p_phone) = '') AND (p_email IS NULL OR btrim(p_email) = '') THEN
    RETURN;  -- nothing to match
  END IF;

  v_phone_norm := public._normalize_phone(p_phone);

  RETURN QUERY
  SELECT l.id, l.status::text, l.source::text, l.contact_name, l.last_activity_at
    FROM public.leads l
   WHERE l.hotel_id = p_hotel_id
     AND l.deleted_at IS NULL
     AND l.status NOT IN ('CONVERTED','LOST')
     AND (
       (v_phone_norm IS NOT NULL AND (
         l.contact_phone = v_phone_norm
         OR l.contact_phone_normalized = v_phone_norm
       ))
       OR (p_email IS NOT NULL AND lower(l.contact_email) = lower(btrim(p_email)))
     )
   ORDER BY l.last_activity_at DESC
   LIMIT 5;
END;
$$;

-- ─── 7. vaiyu_log_audit — shared helper for va_audit_logs writes ───────────
-- Future RPCs that don't have a dedicated per-entity event table use this
-- instead of inlining the INSERT. Keeps action naming + meta shape uniform.

CREATE OR REPLACE FUNCTION public.vaiyu_log_audit(
  p_action     text,
  p_entity     text,
  p_entity_id  uuid DEFAULT NULL,
  p_hotel_id   uuid DEFAULT NULL,
  p_meta       jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  INSERT INTO public.va_audit_logs (action, actor, hotel_id, entity, entity_id, meta)
  VALUES (
    p_action,
    auth.uid()::text,
    p_hotel_id,
    p_entity,
    p_entity_id,
    COALESCE(p_meta, '{}'::jsonb)
  );
$$;

COMMENT ON FUNCTION public.vaiyu_log_audit IS
  'Shared helper for writing va_audit_logs rows. Use for: config/settings changes, role mutations, security events, any cross-cutting audit that does NOT belong in a per-entity event table. Per-entity tables (lead_events / partner_events / quote_draft_events / lead_drip_events / follow_up_events) keep their own typed-enum + payload-schema discipline.';

-- ─── 8. Grants ─────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.record_external_message_id(uuid, text)  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_notification_bounced(text, text)   TO service_role;
GRANT EXECUTE ON FUNCTION public.pause_drips_on_lead_reply(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lookup_lead_by_contact(uuid, text, text)    TO service_role;
GRANT EXECUTE ON FUNCTION public.vaiyu_log_audit(text, text, uuid, uuid, jsonb) TO authenticated;
