-- ============================================================
-- VAiyu – Stay extension notifications: production fix
-- ============================================================
-- Issue caught during prod-grade audit:
--   The previous migration queued an `extension_requested_staff`
--   notification using the booking's phone/email — which routes to the
--   GUEST, not staff. send-notifications/index.ts also had no handler for
--   the new template codes, so nothing would actually send anyway.
--
-- Fix:
--   • request_stay_extension: stop queuing a notification at all.
--     Front desk sees pending requests in OwnerArrivals (dashboard card +
--     realtime subscription). That's the correct channel — staff already
--     has the system open. No misrouted SMS/email.
--   • approve_stay_extension + reject_stay_extension: keep guest
--     notifications (template_code goes to guest's contact, which IS
--     correct for these). The send-notifications edge function has
--     matching handlers added in the same change set.
-- ============================================================

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

  -- NO STAFF NOTIFICATION — staff sees pending requests on the
  -- OwnerArrivals dashboard (PendingExtensionsCard, with realtime
  -- subscription on stay_extension_requests). notification_queue is
  -- booking-keyed and would misroute to the guest.

  RETURN v_request_id;
END $$;


-- ─── Realtime publication: add stay_extension_requests ─────────────
-- Required for the PendingExtensionsCard's `postgres_changes` channel to
-- actually fire on inserts/updates. Wrapped so re-running this migration
-- doesn't error if the table is already in the publication.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.stay_extension_requests;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL; -- publication missing in some envs; non-fatal
END $$;
