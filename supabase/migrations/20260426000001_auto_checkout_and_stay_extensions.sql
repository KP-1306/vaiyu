-- ============================================================
-- VAiyu – Auto-checkout for overdue stays + Stay Extension flow
-- ============================================================
-- TWO related deliverables shipped together because they interact:
--
-- 1. `auto_checkout_overdue_stays(grace_hours INT DEFAULT 6)` — runs
--    on pg_cron every hour. Flips inhouse/arriving stays past their
--    scheduled_checkout_at + grace to checked_out. Closes the gap
--    where front desk forgets to click "Checkout".
--
-- 2. Stay-extension workflow — guests can request an extension via
--    the guest app; staff approves/rejects. Approval bumps the stay's
--    scheduled_checkout_at AND posts a ROOM_CHARGE folio entry for
--    the additional nights. Auto-checkout SKIPS stays with a pending
--    extension so front desk has time to act.
--
-- Both use SECURITY DEFINER RPCs with explicit role checks (mirrors the
-- pricing-discount RBAC pattern from migration 005).
-- ============================================================


-- ─── 0. Extend checkin_event_type enum for new audit events ──
-- ALTER TYPE ... ADD VALUE is idempotent in PG13+ via IF NOT EXISTS.
-- Wrapped in DO blocks so re-running this migration is safe.
DO $$
BEGIN
  ALTER TYPE public.checkin_event_type ADD VALUE IF NOT EXISTS 'AUTO_CHECKOUT';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TYPE public.checkin_event_type ADD VALUE IF NOT EXISTS 'EXTENDED';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ─── 1. Stay extension requests (data model) ───────────────
CREATE TABLE IF NOT EXISTS public.stay_extension_requests (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id                 UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  stay_id                  UUID NOT NULL REFERENCES public.stays(id) ON DELETE CASCADE,
  booking_id               UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  guest_id                 UUID NULL REFERENCES public.guests(id) ON DELETE SET NULL,

  -- Snapshot at request time so the audit trail is self-contained.
  current_checkout_at      TIMESTAMPTZ NOT NULL,
  requested_checkout_at    TIMESTAMPTZ NOT NULL,
  additional_nights        INT NOT NULL CHECK (additional_nights >= 1),

  -- Workflow state
  status                   TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  guest_note               TEXT,
  staff_note               TEXT,

  -- Audit
  requested_by_user        UUID NULL,         -- auth.uid of the requester
  requested_by_source      TEXT NOT NULL DEFAULT 'guest'
    CHECK (requested_by_source IN ('guest', 'staff')),
  requested_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by_user         UUID NULL,
  reviewed_at              TIMESTAMPTZ NULL,

  -- Billing capture (set on approval)
  additional_amount        NUMERIC(12,2) NULL CHECK (additional_amount IS NULL OR additional_amount >= 0),
  folio_entry_id           UUID NULL REFERENCES public.folio_entries(id) ON DELETE SET NULL,

  CONSTRAINT chk_stay_ext_dates
    CHECK (requested_checkout_at > current_checkout_at)
);

CREATE INDEX IF NOT EXISTS idx_stay_extension_requests_hotel_status
  ON public.stay_extension_requests (hotel_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_stay_extension_requests_stay
  ON public.stay_extension_requests (stay_id);

-- Only one pending request per stay at a time (avoid duplicate front-desk noise).
CREATE UNIQUE INDEX IF NOT EXISTS uq_stay_extension_one_pending
  ON public.stay_extension_requests (stay_id)
  WHERE status = 'pending';

COMMENT ON TABLE public.stay_extension_requests IS
  'Tracks guest-initiated stay extensions. Approval bumps stays.scheduled_checkout_at and posts ROOM_CHARGE folio entry. Used by auto_checkout_overdue_stays to skip stays with pending requests.';


ALTER TABLE public.stay_extension_requests ENABLE ROW LEVEL SECURITY;

-- Staff (any hotel member) can read all extensions for their hotel.
DROP POLICY IF EXISTS stay_ext_select_staff ON public.stay_extension_requests;
CREATE POLICY stay_ext_select_staff ON public.stay_extension_requests
  FOR SELECT TO authenticated
  USING (public.vaiyu_is_hotel_member(hotel_id));

-- All writes go through SECURITY DEFINER RPCs (no direct INSERT/UPDATE/DELETE
-- by authenticated users — protects the workflow state machine).


-- ─── 2. Guest-callable RPC: request extension ──────────────
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
  -- Load stay (locked row)
  SELECT * INTO v_stay FROM public.stays WHERE id = p_stay_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stay % not found', p_stay_id;
  END IF;

  IF v_stay.status NOT IN ('arriving', 'inhouse') THEN
    RAISE EXCEPTION 'Cannot extend a % stay', v_stay.status;
  END IF;

  -- Authorization: caller must be EITHER staff at this hotel OR the guest themselves.
  v_is_staff := public.vaiyu_is_hotel_member(v_stay.hotel_id);
  IF NOT v_is_staff THEN
    -- Guest path: caller's auth.uid must map to v_stay.guest_id via guest_user_map.
    SELECT EXISTS (
      SELECT 1 FROM public.guest_user_map gum
      WHERE gum.user_id = v_caller_uid AND gum.guest_id = v_stay.guest_id
    ) INTO v_is_guest;
    IF NOT v_is_guest THEN
      RAISE EXCEPTION 'Only the guest or hotel staff can request extension for this stay';
    END IF;
  END IF;
  v_source := CASE WHEN v_is_staff THEN 'staff' ELSE 'guest' END;

  -- Compute requested checkout timestamp (use hotel checkout time, default 11:00).
  v_requested_ts := (p_requested_checkout_date || ' 11:00:00')::TIMESTAMPTZ;
  IF v_requested_ts <= v_stay.scheduled_checkout_at THEN
    RAISE EXCEPTION 'Requested checkout date must be after current scheduled checkout';
  END IF;

  v_additional_nights := GREATEST(
    1,
    (p_requested_checkout_date - v_stay.scheduled_checkout_at::DATE)
  );

  -- Cancel any existing pending request for this stay (replaced by this one).
  -- Avoids the unique-index conflict and gives the guest the freshest preference.
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

  RETURN v_request_id;
END $$;

GRANT EXECUTE ON FUNCTION public.request_stay_extension(UUID, DATE, TEXT)
  TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.request_stay_extension(UUID, DATE, TEXT) IS
  'Creates a pending stay extension request. Callable by the guest (via guest_user_map) or hotel staff. New request supersedes any existing pending request for the same stay.';


-- ─── 3. Staff-callable RPC: approve extension ──────────────
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
BEGIN
  SELECT * INTO v_req FROM public.stay_extension_requests
    WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Extension request % not found', p_request_id;
  END IF;

  IF v_req.status != 'pending' THEN
    RAISE EXCEPTION 'Cannot approve a % request', v_req.status;
  END IF;

  -- RBAC: staff at this hotel only.
  IF NOT public.vaiyu_is_hotel_member(v_req.hotel_id) THEN
    RAISE EXCEPTION 'Only hotel staff can approve extension requests';
  END IF;

  -- Lock the stay; ensure it's still in a state that can be extended.
  SELECT * INTO v_stay FROM public.stays WHERE id = v_req.stay_id FOR UPDATE;
  IF v_stay.status NOT IN ('arriving', 'inhouse') THEN
    RAISE EXCEPTION 'Cannot extend a % stay', v_stay.status;
  END IF;

  -- 1. Update stays + bookings + booking_rooms with new checkout
  UPDATE public.stays
    SET scheduled_checkout_at = v_req.requested_checkout_at, updated_at = NOW()
    WHERE id = v_stay.id;
  UPDATE public.bookings
    SET scheduled_checkout_at = v_req.requested_checkout_at, updated_at = NOW()
    WHERE id = v_stay.booking_id;

  -- 2. Bill the additional charge (optional — staff may waive).
  IF p_additional_amount IS NOT NULL AND p_additional_amount > 0 THEN
    SELECT id INTO v_folio_id FROM public.folios
      WHERE booking_id = v_stay.booking_id LIMIT 1;
    IF v_folio_id IS NULL THEN
      INSERT INTO public.folios (booking_id, hotel_id, status, currency)
      VALUES (v_stay.booking_id, v_req.hotel_id, 'OPEN', 'INR')
      RETURNING id INTO v_folio_id;
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

    -- Bump booking_rooms total
    UPDATE public.booking_rooms
      SET amount_total = COALESCE(amount_total, 0) + p_additional_amount,
          updated_at = NOW()
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

  -- 4. Audit event
  INSERT INTO public.checkin_events (stay_id, event_type, actor_id, meta)
  VALUES (
    v_stay.id, 'EXTENDED', v_caller_uid,
    jsonb_build_object(
      'request_id', p_request_id,
      'old_checkout_at', v_req.current_checkout_at,
      'new_checkout_at', v_req.requested_checkout_at,
      'additional_nights', v_req.additional_nights,
      'additional_amount', p_additional_amount
    )
  );

  RETURN v_stay.id;
END $$;

GRANT EXECUTE ON FUNCTION public.approve_stay_extension(UUID, NUMERIC, TEXT)
  TO authenticated, service_role;


-- ─── 4. Staff-callable RPC: reject extension ───────────────
CREATE OR REPLACE FUNCTION public.reject_stay_extension(
  p_request_id UUID,
  p_staff_note TEXT DEFAULT NULL
) RETURNS UUID
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public AS $$
DECLARE
  v_req public.stay_extension_requests%ROWTYPE;
  v_caller_uid UUID := auth.uid();
BEGIN
  SELECT * INTO v_req FROM public.stay_extension_requests
    WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Extension request % not found', p_request_id;
  END IF;
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

  RETURN p_request_id;
END $$;

GRANT EXECUTE ON FUNCTION public.reject_stay_extension(UUID, TEXT)
  TO authenticated, service_role;


-- ─── 5. Auto-checkout overdue stays + pg_cron schedule ─────
-- Skip stays that have a pending extension — staff needs to decide
-- before we auto-close. Approved extensions already updated
-- scheduled_checkout_at, so they naturally fall outside the cutoff.

CREATE OR REPLACE FUNCTION public.auto_checkout_overdue_stays(
  p_grace_hours INT DEFAULT 6
) RETURNS TABLE (closed_count INT)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public AS $$
DECLARE
  v_cutoff TIMESTAMPTZ := NOW() - (p_grace_hours || ' hours')::INTERVAL;
  v_count INT := 0;
BEGIN
  WITH overdue AS (
    SELECT s.id
    FROM public.stays s
    WHERE s.status IN ('arriving', 'inhouse')
      AND s.scheduled_checkout_at < v_cutoff
      AND NOT EXISTS (
        SELECT 1 FROM public.stay_extension_requests r
        WHERE r.stay_id = s.id AND r.status = 'pending'
      )
    FOR UPDATE OF s SKIP LOCKED
  )
  UPDATE public.stays
    SET status = 'checked_out',
        actual_checkout_at = COALESCE(actual_checkout_at, NOW()),
        updated_at = NOW()
    WHERE id IN (SELECT id FROM overdue);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Best-effort: log a checkin_event row per closed stay so the audit
  -- trail shows it was system-closed (not staff-initiated).
  INSERT INTO public.checkin_events (stay_id, event_type, actor_id, meta)
  SELECT s.id, 'AUTO_CHECKOUT', NULL,
         jsonb_build_object(
           'reason', 'overdue',
           'grace_hours', p_grace_hours,
           'closed_at', NOW()
         )
  FROM public.stays s
  WHERE s.status = 'checked_out'
    AND s.actual_checkout_at >= NOW() - INTERVAL '1 minute'
    AND s.scheduled_checkout_at < v_cutoff;

  closed_count := v_count;
  RETURN NEXT;
END $$;

GRANT EXECUTE ON FUNCTION public.auto_checkout_overdue_stays(INT)
  TO service_role;

COMMENT ON FUNCTION public.auto_checkout_overdue_stays(INT) IS
  'Closes inhouse/arriving stays whose scheduled_checkout_at is more than `grace_hours` in the past. Skips stays with a pending extension request. Returns the number of stays closed.';


-- Schedule it. Drop existing entry first so re-running this migration is safe.
DO $$
BEGIN
  PERFORM cron.unschedule('vaiyu_auto_checkout_overdue_stays')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vaiyu_auto_checkout_overdue_stays');
EXCEPTION WHEN OTHERS THEN
  NULL; -- ignore if pg_cron isn't fully wired
END $$;

SELECT cron.schedule(
  'vaiyu_auto_checkout_overdue_stays',
  '0 * * * *',  -- every hour at minute 0
  $$ SELECT public.auto_checkout_overdue_stays(6); $$
);
