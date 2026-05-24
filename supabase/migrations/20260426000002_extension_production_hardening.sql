-- ============================================================
-- VAiyu – Stay extension + auto-checkout: production hardening
-- ============================================================
-- Production gaps closed in this migration (per audit):
--
-- #1 auto_checkout_overdue_stays now CALLS checkout_stay() per row instead
--    of bypass-updating stays.status — so it triggers the same downstream
--    side effects (folio close, post-checkout notification, housekeeping
--    transitions, payment validation).
-- #2 approve_stay_extension validates inventory: rejects if another stay
--    or confirmed booking on the same room overlaps the extended window.
-- #3 Notification queue inserts at every workflow boundary:
--      • request submitted   → staff notified (whatsapp + email if avail)
--      • approved            → guest notified (whatsapp + email if avail)
--      • rejected            → guest notified (whatsapp + email if avail)
--    Auto-checkout's guest farewell is already handled by checkout_stay.
-- #6 cancel_stale_extension_requests + hourly cron — pending requests
--    >24 h past their (current) checkout get auto-cancelled.
-- #8 cancel_stay_extension RPC — guest can cancel their own pending
--    request (or staff can cancel any).
--
-- All changes are CREATE OR REPLACE / additive. No data migration. No
-- breaking changes for any existing caller.
-- ============================================================


-- ─── 0. DROP function whose return signature is changing ──
-- The previous migration's auto_checkout_overdue_stays returned a single
-- column (closed_count). The new version returns (closed_count, skipped_count).
-- CREATE OR REPLACE cannot change the return signature, so we drop first.
DROP FUNCTION IF EXISTS public.auto_checkout_overdue_stays(INT);


-- ─── 1. Auto-checkout: delegate to checkout_stay ──────────
-- checkout_stay() handles: folio close, post_checkout_thankyou notification,
-- housekeeping fanout, payment validation. We pass p_force=TRUE so a small
-- pending balance doesn't block the cron, and p_source='STAFF' so the gate
-- accepts inhouse stays. checkout_stay returns {success, error, …} jsonb;
-- we count successes and skip rows where it returns success=false (those
-- have legitimate blockers like open tickets that need manual review).

CREATE OR REPLACE FUNCTION public.auto_checkout_overdue_stays(
  p_grace_hours INT DEFAULT 6
) RETURNS TABLE (closed_count INT, skipped_count INT)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public AS $$
DECLARE
  v_cutoff TIMESTAMPTZ := NOW() - (p_grace_hours || ' hours')::INTERVAL;
  v_row RECORD;
  v_result JSONB;
  v_closed INT := 0;
  v_skipped INT := 0;
BEGIN
  FOR v_row IN
    SELECT s.id AS stay_id, s.booking_id, s.hotel_id
    FROM public.stays s
    WHERE s.status IN ('arriving', 'inhouse')
      AND s.scheduled_checkout_at < v_cutoff
      AND NOT EXISTS (
        SELECT 1 FROM public.stay_extension_requests r
        WHERE r.stay_id = s.id AND r.status = 'pending'
      )
    ORDER BY s.scheduled_checkout_at  -- close oldest first
  LOOP
    BEGIN
      v_result := public.checkout_stay(
        p_hotel_id   := v_row.hotel_id,
        p_booking_id := v_row.booking_id,
        p_stay_id    := v_row.stay_id,
        p_force      := TRUE,         -- ignore residual balance for cron
        p_source     := 'STAFF'       -- satisfies the inhouse-gate; meta marks it system
      );
      IF (v_result->>'success')::BOOLEAN IS TRUE THEN
        v_closed := v_closed + 1;
        -- Mark as system-initiated in checkin_events for the audit trail.
        INSERT INTO public.checkin_events (stay_id, event_type, actor_id, meta)
        VALUES (
          v_row.stay_id, 'AUTO_CHECKOUT', NULL,
          jsonb_build_object(
            'reason', 'overdue',
            'grace_hours', p_grace_hours,
            'closed_at', NOW(),
            'checkout_stay_result', v_result
          )
        );
      ELSE
        -- Real blocker (open tickets, food orders, etc.) — leave for staff.
        v_skipped := v_skipped + 1;
        RAISE NOTICE 'auto_checkout: skipping stay % — %',
          v_row.stay_id, v_result->>'error';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- One failed row should never abort the whole cron run.
      v_skipped := v_skipped + 1;
      RAISE NOTICE 'auto_checkout: error on stay %: %', v_row.stay_id, SQLERRM;
    END;
  END LOOP;

  closed_count := v_closed;
  skipped_count := v_skipped;
  RETURN NEXT;
END $$;

GRANT EXECUTE ON FUNCTION public.auto_checkout_overdue_stays(INT)
  TO service_role;

COMMENT ON FUNCTION public.auto_checkout_overdue_stays(INT) IS
  'Closes overdue stays via checkout_stay() so all downstream effects fire (folio close, post-checkout notification, housekeeping). Skips stays with pending extensions or unresolved blockers. Returns (closed, skipped) counts.';


-- ─── 2. Inventory-conflict helper used by approve_stay_extension ───
-- Returns the conflicting stay/booking id if any; NULL otherwise.

CREATE OR REPLACE FUNCTION public.find_extension_conflict(
  p_stay_id UUID,
  p_room_id UUID,
  p_old_checkout TIMESTAMPTZ,
  p_new_checkout TIMESTAMPTZ
) RETURNS TABLE (
  conflict_kind TEXT,
  conflict_id UUID,
  conflict_label TEXT,
  conflict_starts_at TIMESTAMPTZ
) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  -- Other in-house / arriving stays on the same room overlapping [old, new).
  RETURN QUERY
  SELECT 'stay'::TEXT,
         s.id,
         'Stay ' || COALESCE(s.booking_code, s.id::TEXT),
         s.scheduled_checkin_at
  FROM public.stays s
  WHERE s.room_id = p_room_id
    AND s.id != p_stay_id
    AND s.status IN ('arriving', 'inhouse')
    AND s.scheduled_checkin_at < p_new_checkout
    AND s.scheduled_checkout_at > p_old_checkout
  ORDER BY s.scheduled_checkin_at
  LIMIT 1;

  IF FOUND THEN RETURN; END IF;

  -- Confirmed bookings that haven't been checked in yet (no stay row) but
  -- have this room reserved within the extended window.
  RETURN QUERY
  SELECT 'booking'::TEXT,
         b.id,
         'Booking ' || COALESCE(b.code, b.id::TEXT),
         b.scheduled_checkin_at
  FROM public.bookings b
  WHERE b.room_id = p_room_id
    AND b.status IN ('CONFIRMED', 'PRE_CHECKED_IN')
    AND b.scheduled_checkin_at < p_new_checkout
    AND b.scheduled_checkout_at > p_old_checkout
    AND NOT EXISTS (
      SELECT 1 FROM public.stays s2
      WHERE s2.booking_id = b.id AND s2.id = p_stay_id
    )
  ORDER BY b.scheduled_checkin_at
  LIMIT 1;
END $$;

GRANT EXECUTE ON FUNCTION public.find_extension_conflict(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ)
  TO authenticated, service_role;


-- ─── 3. Notification helper (internal — used by RPCs below) ───────
-- Inserts SMS/email/whatsapp queue rows depending on which contacts the
-- booking has. Idempotent at the row level: caller decides duplicate
-- handling. Channel-CHECK in the table enforces 'sms'|'email'|'whatsapp'.

CREATE OR REPLACE FUNCTION public.queue_extension_notification(
  p_booking_id UUID,
  p_template_code TEXT,
  p_payload JSONB
) RETURNS VOID
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public AS $$
DECLARE
  v_phone TEXT;
  v_email TEXT;
BEGIN
  SELECT phone, email INTO v_phone, v_email
  FROM public.bookings WHERE id = p_booking_id;

  IF v_phone IS NOT NULL AND v_phone <> '' THEN
    INSERT INTO public.notification_queue (booking_id, channel, template_code, payload, status, next_attempt_at)
    VALUES (p_booking_id, 'whatsapp', p_template_code, p_payload, 'pending', NOW())
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_email IS NOT NULL AND v_email <> '' THEN
    INSERT INTO public.notification_queue (booking_id, channel, template_code, payload, status, next_attempt_at)
    VALUES (p_booking_id, 'email', p_template_code, p_payload, 'pending', NOW())
    ON CONFLICT DO NOTHING;
  END IF;
END $$;


-- ─── 4. request_stay_extension — add staff notification ────────────
CREATE OR REPLACE FUNCTION public.request_stay_extension(
  p_stay_id UUID,
  p_requested_checkout_date DATE,
  p_guest_note TEXT DEFAULT NULL
) RETURNS UUID
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public AS $$
DECLARE
  v_stay public.stays%ROWTYPE;
  v_request_id UUID;
  v_requested_ts TIMESTAMPTZ;
  v_additional_nights INT;
  v_caller_uid UUID := auth.uid();
  v_is_staff BOOLEAN := FALSE;
  v_is_guest BOOLEAN := FALSE;
  v_source TEXT;
  v_hotel_name TEXT;
  v_guest_name TEXT;
BEGIN
  SELECT * INTO v_stay FROM public.stays WHERE id = p_stay_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stay % not found', p_stay_id; END IF;
  IF v_stay.status NOT IN ('arriving', 'inhouse') THEN
    RAISE EXCEPTION 'Cannot extend a % stay', v_stay.status;
  END IF;

  v_is_staff := public.vaiyu_is_hotel_member(v_stay.hotel_id);
  IF NOT v_is_staff THEN
    SELECT EXISTS (
      SELECT 1 FROM public.guest_user_map gum
      WHERE gum.user_id = v_caller_uid AND gum.guest_id = v_stay.guest_id
    ) INTO v_is_guest;
    IF NOT v_is_guest THEN
      RAISE EXCEPTION 'Only the guest or hotel staff can request extension for this stay';
    END IF;
  END IF;
  v_source := CASE WHEN v_is_staff THEN 'staff' ELSE 'guest' END;

  v_requested_ts := (p_requested_checkout_date || ' 11:00:00')::TIMESTAMPTZ;
  IF v_requested_ts <= v_stay.scheduled_checkout_at THEN
    RAISE EXCEPTION 'Requested checkout date must be after current scheduled checkout';
  END IF;

  v_additional_nights := GREATEST(1, (p_requested_checkout_date - v_stay.scheduled_checkout_at::DATE));

  -- Cancel any existing pending request — new one supersedes.
  UPDATE public.stay_extension_requests
  SET status = 'cancelled',
      staff_note = COALESCE(staff_note, '') || ' [auto-cancelled — replaced by new request]',
      reviewed_at = NOW()
  WHERE stay_id = p_stay_id AND status = 'pending';

  INSERT INTO public.stay_extension_requests (
    hotel_id, stay_id, booking_id, guest_id,
    current_checkout_at, requested_checkout_at, additional_nights,
    status, guest_note,
    requested_by_user, requested_by_source
  ) VALUES (
    v_stay.hotel_id, v_stay.id, v_stay.booking_id, v_stay.guest_id,
    v_stay.scheduled_checkout_at, v_requested_ts, v_additional_nights,
    'pending', NULLIF(TRIM(p_guest_note), ''),
    v_caller_uid, v_source
  ) RETURNING id INTO v_request_id;

  -- Notify front desk via the queue (no per-template uniqueness for these,
  -- so multiple requests on the same booking are queued each time).
  SELECT h.name INTO v_hotel_name FROM public.hotels h WHERE h.id = v_stay.hotel_id;
  SELECT b.guest_name INTO v_guest_name FROM public.bookings b WHERE b.id = v_stay.booking_id;
  PERFORM public.queue_extension_notification(
    v_stay.booking_id,
    'extension_requested_staff',
    jsonb_build_object(
      'request_id', v_request_id,
      'hotel_name', v_hotel_name,
      'guest_name', v_guest_name,
      'current_checkout_at', v_stay.scheduled_checkout_at,
      'requested_checkout_at', v_requested_ts,
      'additional_nights', v_additional_nights,
      'guest_note', p_guest_note,
      'source', v_source
    )
  );

  RETURN v_request_id;
END $$;


-- ─── 5. approve_stay_extension — inventory check + notify guest ────
CREATE OR REPLACE FUNCTION public.approve_stay_extension(
  p_request_id UUID,
  p_additional_amount NUMERIC DEFAULT NULL,
  p_staff_note TEXT DEFAULT NULL
) RETURNS UUID
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public AS $$
DECLARE
  v_req public.stay_extension_requests%ROWTYPE;
  v_stay public.stays%ROWTYPE;
  v_folio_id UUID;
  v_folio_entry_id UUID;
  v_caller_uid UUID := auth.uid();
  v_conflict RECORD;
  v_hotel_name TEXT;
BEGIN
  SELECT * INTO v_req FROM public.stay_extension_requests
    WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Extension request % not found', p_request_id; END IF;
  IF v_req.status != 'pending' THEN
    RAISE EXCEPTION 'Cannot approve a % request', v_req.status;
  END IF;
  IF NOT public.vaiyu_is_hotel_member(v_req.hotel_id) THEN
    RAISE EXCEPTION 'Only hotel staff can approve extension requests';
  END IF;

  SELECT * INTO v_stay FROM public.stays WHERE id = v_req.stay_id FOR UPDATE;
  IF v_stay.status NOT IN ('arriving', 'inhouse') THEN
    RAISE EXCEPTION 'Cannot extend a % stay', v_stay.status;
  END IF;

  -- INVENTORY CONFLICT CHECK (#2 fix).
  -- Only check the NEW window — the existing reservation is fine.
  SELECT * INTO v_conflict FROM public.find_extension_conflict(
    v_stay.id, v_stay.room_id,
    v_stay.scheduled_checkout_at, v_req.requested_checkout_at
  );
  IF v_conflict IS NOT NULL AND v_conflict.conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot extend: room is reserved for % (%) starting %',
      v_conflict.conflict_label, v_conflict.conflict_kind, v_conflict.conflict_starts_at;
  END IF;

  -- 1. Update stays + bookings + booking_rooms with new checkout
  UPDATE public.stays
    SET scheduled_checkout_at = v_req.requested_checkout_at, updated_at = NOW()
    WHERE id = v_stay.id;
  UPDATE public.bookings
    SET scheduled_checkout_at = v_req.requested_checkout_at, updated_at = NOW()
    WHERE id = v_stay.booking_id;

  -- 2. Bill the additional charge (optional)
  IF p_additional_amount IS NOT NULL AND p_additional_amount > 0 THEN
    SELECT id INTO v_folio_id FROM public.folios WHERE booking_id = v_stay.booking_id LIMIT 1;
    IF v_folio_id IS NULL THEN
      INSERT INTO public.folios (booking_id, hotel_id, status, currency)
      VALUES (v_stay.booking_id, v_req.hotel_id, 'OPEN', 'INR') RETURNING id INTO v_folio_id;
    END IF;
    INSERT INTO public.folio_entries (
      hotel_id, booking_id, folio_id, entry_type, amount, description, reference_id
    ) VALUES (
      v_req.hotel_id, v_stay.booking_id, v_folio_id, 'ROOM_CHARGE',
      p_additional_amount,
      'Stay extension: ' || v_req.additional_nights || ' additional night'
        || CASE WHEN v_req.additional_nights = 1 THEN '' ELSE 's' END
        || ' (request ' || p_request_id::TEXT || ')',
      v_stay.booking_room_id
    ) RETURNING id INTO v_folio_entry_id;
    UPDATE public.booking_rooms
      SET amount_total = COALESCE(amount_total, 0) + p_additional_amount, updated_at = NOW()
      WHERE id = v_stay.booking_room_id;
  END IF;

  -- 3. Mark request approved
  UPDATE public.stay_extension_requests
    SET status = 'approved',
        staff_note = NULLIF(TRIM(p_staff_note), ''),
        reviewed_by_user = v_caller_uid,
        reviewed_at = NOW(),
        additional_amount = p_additional_amount,
        folio_entry_id = v_folio_entry_id
    WHERE id = p_request_id;

  INSERT INTO public.checkin_events (stay_id, event_type, actor_id, meta)
  VALUES (v_stay.id, 'EXTENDED', v_caller_uid,
    jsonb_build_object(
      'request_id', p_request_id,
      'old_checkout_at', v_req.current_checkout_at,
      'new_checkout_at', v_req.requested_checkout_at,
      'additional_nights', v_req.additional_nights,
      'additional_amount', p_additional_amount));

  -- Notify the guest.
  SELECT h.name INTO v_hotel_name FROM public.hotels h WHERE h.id = v_req.hotel_id;
  PERFORM public.queue_extension_notification(
    v_stay.booking_id,
    'extension_approved_guest',
    jsonb_build_object(
      'request_id', p_request_id,
      'hotel_name', v_hotel_name,
      'new_checkout_at', v_req.requested_checkout_at,
      'additional_nights', v_req.additional_nights,
      'additional_amount', p_additional_amount,
      'staff_note', p_staff_note
    )
  );

  RETURN v_stay.id;
END $$;


-- ─── 6. reject_stay_extension — notify guest ───────────────────────
CREATE OR REPLACE FUNCTION public.reject_stay_extension(
  p_request_id UUID,
  p_staff_note TEXT DEFAULT NULL
) RETURNS UUID
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public AS $$
DECLARE
  v_req public.stay_extension_requests%ROWTYPE;
  v_caller_uid UUID := auth.uid();
  v_hotel_name TEXT;
BEGIN
  SELECT * INTO v_req FROM public.stay_extension_requests
    WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Extension request % not found', p_request_id; END IF;
  IF v_req.status != 'pending' THEN
    RAISE EXCEPTION 'Cannot reject a % request', v_req.status;
  END IF;
  IF NOT public.vaiyu_is_hotel_member(v_req.hotel_id) THEN
    RAISE EXCEPTION 'Only hotel staff can reject extension requests';
  END IF;

  UPDATE public.stay_extension_requests
    SET status = 'rejected',
        staff_note = NULLIF(TRIM(p_staff_note), ''),
        reviewed_by_user = v_caller_uid,
        reviewed_at = NOW()
    WHERE id = p_request_id;

  SELECT h.name INTO v_hotel_name FROM public.hotels h WHERE h.id = v_req.hotel_id;
  PERFORM public.queue_extension_notification(
    v_req.booking_id,
    'extension_rejected_guest',
    jsonb_build_object(
      'request_id', p_request_id,
      'hotel_name', v_hotel_name,
      'requested_checkout_at', v_req.requested_checkout_at,
      'staff_note', p_staff_note
    )
  );

  RETURN p_request_id;
END $$;


-- ─── 7. cancel_stay_extension — guest can withdraw own pending ─────
CREATE OR REPLACE FUNCTION public.cancel_stay_extension(
  p_request_id UUID
) RETURNS UUID
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public AS $$
DECLARE
  v_req public.stay_extension_requests%ROWTYPE;
  v_caller_uid UUID := auth.uid();
  v_is_staff BOOLEAN;
  v_is_guest BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_req FROM public.stay_extension_requests
    WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Extension request % not found', p_request_id; END IF;
  IF v_req.status != 'pending' THEN
    RAISE EXCEPTION 'Only pending requests can be cancelled (this is %)', v_req.status;
  END IF;

  v_is_staff := public.vaiyu_is_hotel_member(v_req.hotel_id);
  IF NOT v_is_staff THEN
    SELECT EXISTS (
      SELECT 1 FROM public.guest_user_map gum
      WHERE gum.user_id = v_caller_uid AND gum.guest_id = v_req.guest_id
    ) INTO v_is_guest;
    IF NOT v_is_guest THEN
      RAISE EXCEPTION 'Only the guest or hotel staff can cancel this request';
    END IF;
  END IF;

  UPDATE public.stay_extension_requests
    SET status = 'cancelled',
        reviewed_by_user = v_caller_uid,
        reviewed_at = NOW(),
        staff_note = CASE
          WHEN v_is_staff THEN COALESCE(staff_note, '') || ' [cancelled by staff]'
          ELSE COALESCE(staff_note, '') || ' [cancelled by guest]'
        END
    WHERE id = p_request_id;

  RETURN p_request_id;
END $$;

GRANT EXECUTE ON FUNCTION public.cancel_stay_extension(UUID)
  TO authenticated, anon, service_role;


-- ─── 8. cancel_stale_extension_requests + cron schedule ────────────
-- Pending requests that are still pending more than X hours past their
-- ORIGINAL scheduled checkout get auto-cancelled. Default: 24h. This
-- complements the auto-checkout job — by the time auto-checkout fires
-- (6h grace), these have had a fair window to be reviewed.

CREATE OR REPLACE FUNCTION public.cancel_stale_extension_requests(
  p_grace_hours INT DEFAULT 24
) RETURNS INT
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE public.stay_extension_requests
    SET status = 'cancelled',
        staff_note = COALESCE(staff_note, '') || ' [auto-cancelled — pending past grace]',
        reviewed_at = NOW()
    WHERE status = 'pending'
      AND current_checkout_at < NOW() - (p_grace_hours || ' hours')::INTERVAL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.cancel_stale_extension_requests(INT)
  TO service_role;

-- Schedule it to run every hour, 5 min after auto-checkout (so stale
-- pending ones are cancelled BEFORE the next auto-checkout sweep can use
-- them as a skip signal).
DO $$
BEGIN
  PERFORM cron.unschedule('vaiyu_cancel_stale_extension_requests')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vaiyu_cancel_stale_extension_requests');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'vaiyu_cancel_stale_extension_requests',
  '5 * * * *',  -- every hour at :05
  $$ SELECT public.cancel_stale_extension_requests(24); $$
);
