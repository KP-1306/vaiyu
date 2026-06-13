-- Checkout / folio-close audit fixes (2026-06-14).
--
-- Found in the audit (all evidence-backed against prod + local repro):
--
--   1. [CORRECTNESS] checkout_stay never closed the folio. On prod all 56
--      folios were OPEN, 51 of them for already-checked-out stays. folios.status
--      is the lifecycle signal the owner dashboard uses to count "active" folios
--      and in-house balances, so it was meaningless: the dashboard showed ~32
--      "active" folios when only ~2 stays were in-house, and 15 departed guests'
--      balances were counted as money owed by in-house guests.
--
--   2. [SECURITY / MONEY] checkout_stay and request_checkout were SECURITY
--      DEFINER, granted to anon, with NO authorization guard. Reproduced
--      locally: as the public `anon` role, checkout_stay(p_force:=true,
--      p_source:='STAFF') checked a guest out (room freed, booking CHECKED_OUT)
--      with the balance LEFT UNPAID. A guest holding only their own
--      booking/stay/hotel UUIDs (all visible in their portal's network traffic)
--      could self-checkout and bypass an unpaid balance.
--
--   3. [DEAD CODE] checkout_booking was an orphan (no caller anywhere) that
--      diverged dangerously -- it closed the folio but did NOT free the room or
--      set housekeeping -- and was also anon-callable.
--
-- This migration:
--   A. Drops the orphan checkout_booking.
--   B. Adds an authorization guard to checkout_stay (member of the stay's REAL
--      hotel, platform admin, or a trusted backend/cron context) and closes the
--      folio when the stay leaves fully settled. Revokes anon EXECUTE.
--   C. Adds an authorization guard to request_checkout (booking owner / member /
--      admin). Revokes anon EXECUTE.
--   D. Backfills: closes OPEN folios for departed, fully-settled bookings so the
--      dashboard's "active" count reflects reality. Departed guests who still
--      owe (forced / auto checkouts) keep an OPEN folio -- they are real
--      receivables.
--   E. Adds get_outstanding_balance_summary(hotel) -- one source of truth that
--      splits in-house balances (collect now) from departed receivables (chase
--      later), the way a real PMS separates the guest ledger from the city
--      ledger.

-- ════════════════════════════════════════════════════════════════════════
-- A. Drop the orphan checkout_booking (no caller; divergent; anon-exposed).
-- ════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.checkout_booking(uuid);

-- ════════════════════════════════════════════════════════════════════════
-- B. checkout_stay: authorization guard + folio close on settle.
--    (Body is the audited live definition with two inserts marked NEW.)
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.checkout_stay(p_hotel_id uuid, p_booking_id uuid, p_stay_id uuid, p_force boolean DEFAULT false, p_source text DEFAULT 'GUEST'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_pending_amount NUMERIC;
    v_room_id UUID;
    v_stay_status TEXT;
    v_now TIMESTAMPTZ := now();
    v_feedback_token TEXT;
    v_folio_id UUID;
    v_hotel_id UUID;
BEGIN

    ---------------------------------------------------------
    -- 1️⃣ Pessimistic Locking & Validation
    ---------------------------------------------------------
    SELECT room_id, status, hotel_id INTO v_room_id, v_stay_status, v_hotel_id
    FROM stays
    WHERE id = p_stay_id
      AND booking_id = p_booking_id
      AND (
          status = 'checkout_requested'
          OR (status = 'inhouse' AND p_source = 'STAFF')
      )
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', CASE WHEN p_source = 'STAFF'
                THEN 'Stay not found or not eligible for checkout.'
                ELSE 'Stay not found or checkout hasn''t been requested yet.'
            END
        );
    END IF;

    ---------------------------------------------------------
    -- 1️⃣b Authorization (NEW)
    ---------------------------------------------------------
    -- Checkout is a staff/back-office action. Authorize against the stay's REAL
    -- hotel (v_hotel_id), never the client-supplied p_hotel_id -- the stay
    -- lookup above is keyed on stay+booking, not hotel, so trusting p_hotel_id
    -- would let a member of hotel A check out a stay in hotel B.
    --   • auth.uid() IS NULL  → trusted backend context (pg_cron auto-checkout
    --     runs with no JWT; service_role key has no `sub`). Allowed; anon is
    --     blocked at the GRANT layer (REVOKE below), so a null uid here is never
    --     an anonymous API caller.
    --   • otherwise the caller must be an active member of v_hotel_id or a
    --     platform admin. This blocks an authenticated guest from force-checking
    --     themselves out (and bypassing an unpaid balance) via the public API.
    IF auth.uid() IS NOT NULL
       AND NOT (public.vaiyu_is_hotel_member(v_hotel_id) OR public.is_platform_admin())
    THEN
        RAISE EXCEPTION 'Not authorized to check out this stay'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Lock booking row
    PERFORM 1 FROM bookings WHERE id = p_booking_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Booking not found'
        );
    END IF;


    ---------------------------------------------------------
    -- 2️⃣ Explicit Folio Locking & Lazy Creation
    ---------------------------------------------------------
    SELECT id INTO v_folio_id
    FROM folios
    WHERE booking_id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        -- Create it just-in-time
        INSERT INTO folios (booking_id, hotel_id, status)
        VALUES (p_booking_id, v_hotel_id, 'OPEN')
        ON CONFLICT (booking_id) DO NOTHING
        RETURNING id INTO v_folio_id;

        -- Fallback if conflict happened and it wasn't returned
        IF v_folio_id IS NULL THEN
            SELECT id INTO v_folio_id FROM folios WHERE booking_id = p_booking_id FOR UPDATE;
        END IF;
    END IF;


    ---------------------------------------------------------
    -- 3️⃣ Revalidate Operational Safety
    ---------------------------------------------------------
    IF EXISTS (
        SELECT 1 FROM tickets
        WHERE stay_id = p_stay_id
        AND status NOT IN ('COMPLETED', 'CANCELLED')
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Open service requests exist'
        );
    END IF;

    IF EXISTS (
        SELECT 1
        FROM food_orders fo
        JOIN stays s ON s.id = fo.stay_id
        WHERE s.id = p_stay_id
        AND fo.status NOT IN ('DELIVERED','CANCELLED', 'REJECTED')
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Pending food orders exist'
        );
    END IF;


    ---------------------------------------------------------
    -- 4️⃣ Robust Ledger Scoping & Payment Validation
    ---------------------------------------------------------
    SELECT COALESCE(SUM(amount), 0)
    INTO v_pending_amount
    FROM folio_entries
    WHERE folio_id IN (
        SELECT id FROM folios WHERE booking_id = p_booking_id
    );

    IF v_pending_amount > 0 AND p_force = FALSE THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Pending balance exists',
            'pending_amount', v_pending_amount
        );
    END IF;


    ---------------------------------------------------------
    -- 5️⃣ Close Stay
    ---------------------------------------------------------
    UPDATE stays
    SET
        status = 'checked_out',
        actual_checkout_at = v_now
    WHERE id = p_stay_id;


    ---------------------------------------------------------
    -- 6️⃣ Update Booking Status
    ---------------------------------------------------------
    UPDATE bookings
    SET status = 'CHECKED_OUT',
        updated_at = v_now
    WHERE id = p_booking_id;

    UPDATE booking_rooms
    SET status = 'CHECKED_OUT',
        updated_at = v_now
    WHERE booking_id = p_booking_id
      AND room_id = v_room_id;


    ---------------------------------------------------------
    -- 7️⃣ Mark Room Dirty
    ---------------------------------------------------------
    PERFORM 1 FROM rooms WHERE id = v_room_id FOR UPDATE;

    UPDATE rooms
    SET housekeeping_status = 'dirty',
        updated_at = v_now
    WHERE id = v_room_id;


    ---------------------------------------------------------
    -- 7️⃣b Close the folio when fully settled (NEW)
    ---------------------------------------------------------
    -- folios.status is the lifecycle signal the dashboard reads to count
    -- "active" folios and in-house balances. A settled checkout closes the
    -- folio so it drops out of the active set. A forced / auto checkout that
    -- leaves a residual balance (guest still owes) -- or a credit balance
    -- (hotel owes the guest a refund) -- keeps the folio OPEN so the receivable
    -- / refund stays visible to staff and is reported as a departed receivable.
    --
    -- Multi-room bookings share one folio across several stays (ux_booking_folio
    -- is UNIQUE on booking_id). Only close once THIS is the last active stay --
    -- the current stay was already set to 'checked_out' above, so we just check
    -- that no other stay on the booking is still active. Closing earlier would
    -- drop a still-in-house guest from the dashboard and freeze a folio that may
    -- still take charges.
    IF abs(COALESCE(v_pending_amount, 0)) < 0.005
       AND NOT EXISTS (
           SELECT 1 FROM stays s
           WHERE s.booking_id = p_booking_id
             AND s.status IN ('inhouse', 'arriving', 'checkout_requested')
       )
    THEN
        UPDATE folios SET status = 'CLOSED', updated_at = v_now
        WHERE id = v_folio_id;
    END IF;


    ---------------------------------------------------------
    -- 8️⃣ Log Arrival Event
    ---------------------------------------------------------
    INSERT INTO arrival_events (
        hotel_id,
        booking_id,
        event_type,
        details,
        performed_by
    )
    VALUES (
        v_hotel_id,                              -- the stay's real hotel (NEW: was p_hotel_id)
        p_booking_id,
        'CHECKOUT',
        jsonb_build_object(
            'stay_id', p_stay_id,
            'room_id', v_room_id,
            'force', p_force,
            'balance_at_checkout', v_pending_amount,
            'origin', p_source
        ),
        COALESCE(auth.uid(), NULL)
    );


    ---------------------------------------------------------
    -- 9️⃣ Generate Feedback Token & Queue Post-Checkout Email
    ---------------------------------------------------------
    BEGIN
        -- Create feedback token
        SELECT (create_feedback_token(p_booking_id))->>'token'
        INTO v_feedback_token;

        -- Queue email notification (1-hour delay for optimal response rate)
        INSERT INTO public.notification_queue (
            booking_id, channel, template_code, payload, status, next_attempt_at
        )
        SELECT
            p_booking_id,
            'email',
            'post_checkout_thankyou',
            jsonb_build_object(
                'booking_id', p_booking_id,
                'guest_name', b.guest_name,
                'email', b.email,
                'feedback_token', v_feedback_token,
                'hotel_name', h.name
            ),
            'pending',
            v_now + interval '1 hour'  -- 1-hour delay: optimal feedback response window
        FROM bookings b
        JOIN hotels h ON h.id = b.hotel_id
        WHERE b.id = p_booking_id
        AND b.email IS NOT NULL AND b.email != '';

        -- Queue WhatsApp notification (2nd priority, for future use)
        INSERT INTO public.notification_queue (
            booking_id, channel, template_code, payload, status, next_attempt_at
        )
        SELECT
            p_booking_id,
            'whatsapp',
            'post_checkout_thankyou',
            jsonb_build_object(
                'booking_id', p_booking_id,
                'guest_name', b.guest_name,
                'phone', b.phone,
                'feedback_token', v_feedback_token,
                'hotel_name', h.name
            ),
            'pending',
            v_now + interval '1 hour'
        FROM bookings b
        JOIN hotels h ON h.id = b.hotel_id
        WHERE b.id = p_booking_id
        AND b.phone IS NOT NULL AND b.phone != '';

    EXCEPTION WHEN OTHERS THEN
        -- Non-blocking: log but don't fail checkout if notification fails
        RAISE WARNING 'Post-checkout notification failed: %', SQLERRM;
    END;


    ---------------------------------------------------------
    -- 🔟 Success Response
    ---------------------------------------------------------
    RETURN jsonb_build_object(
        'success', true,
        'checked_out_at', v_now,
        'feedback_token', v_feedback_token
    );

END;
$function$;

-- Postgres grants EXECUTE to PUBLIC by default, and anon inherits via PUBLIC,
-- so revoking from `anon` alone is not enough -- revoke from PUBLIC and re-grant
-- only to the trusted roles. (The body's null-uid bypass is for cron /
-- service_role; an anonymous API caller also has a null `sub`, so the GRANT
-- layer -- not the body -- is what must keep anon out.)
REVOKE ALL ON FUNCTION public.checkout_stay(uuid, uuid, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.checkout_stay(uuid, uuid, uuid, boolean, text) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════
-- C. request_checkout: authorization guard (booking owner / member / admin).
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.request_checkout(p_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_stay_id UUID;
    v_hotel_id UUID;
    v_pending_amount NUMERIC;
    v_now TIMESTAMPTZ := now();
BEGIN
    -- 1A: Lock Booking
    PERFORM 1 FROM bookings WHERE id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
    END IF;

    -- 1B: Lock Active Stay
    SELECT id, hotel_id INTO v_stay_id, v_hotel_id
    FROM stays
    WHERE booking_id = p_booking_id
      AND status = 'inhouse'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'No active inhouse stay found. Checkout may already be requested or completed.');
    END IF;

    -- 1B-auth: Authorization (NEW)
    -- The caller must be the guest who owns this booking (the same
    -- bookings.guest_id = current_guest_id() check the folios RLS policy uses),
    -- a member of the stay's real hotel, or a platform admin. anon is revoked
    -- below, so this runs only for authenticated sessions.
    IF NOT (
        public.vaiyu_is_hotel_member(v_hotel_id)
        OR public.is_platform_admin()
        OR EXISTS (
            SELECT 1 FROM public.bookings
            WHERE id = p_booking_id
              AND guest_id IS NOT NULL
              AND guest_id = public.current_guest_id()
        )
    ) THEN
        RAISE EXCEPTION 'Not authorized to request checkout for this booking'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 1C: Lock Folio explicitly OR Create Just-In-Time
    PERFORM 1 FROM folios WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN
        INSERT INTO folios (booking_id, hotel_id, status)
        VALUES (p_booking_id, v_hotel_id, 'OPEN')
        ON CONFLICT (booking_id) DO NOTHING;

        -- Lock newly created folio
        PERFORM 1 FROM folios WHERE booking_id = p_booking_id FOR UPDATE;
    END IF;

    -- 2A: No Open Tickets
    IF EXISTS (
        SELECT 1 FROM tickets
        WHERE stay_id = v_stay_id
        AND status NOT IN ('COMPLETED', 'CANCELLED')
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'You have open service requests. Please let the front desk close them before checkout.');
    END IF;

    -- 2B: No Pending Food Orders
    IF EXISTS (
        SELECT 1 FROM food_orders
        WHERE stay_id = v_stay_id
        AND status NOT IN ('DELIVERED', 'CANCELLED', 'REJECTED')
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'You have an active or pending food order. Please wait for delivery before checkout.');
    END IF;

    -- 3: Financial Validation
    SELECT COALESCE(SUM(amount), 0)
    INTO v_pending_amount
    FROM folio_entries
    WHERE folio_id IN (
        SELECT id FROM folios WHERE booking_id = p_booking_id
    );

    IF v_pending_amount > 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Please settle your outstanding balance before requesting checkout.',
            'pending_amount', v_pending_amount
        );
    END IF;

    -- 4: Set Status to Requested
    UPDATE stays
    SET status = 'checkout_requested',
        updated_at = v_now
    WHERE id = v_stay_id;

    -- 5: Log Event
    INSERT INTO arrival_events (
        hotel_id, booking_id, event_type, details, performed_by
    )
    VALUES (
        v_hotel_id, p_booking_id, 'CHECKOUT_REQUESTED',
        jsonb_build_object('stay_id', v_stay_id, 'balance_at_request', v_pending_amount),
        COALESCE(auth.uid(), NULL)
    );

    RETURN jsonb_build_object('success', true, 'message', 'Checkout requested successfully.');
END;
$function$;

REVOKE ALL ON FUNCTION public.request_checkout(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_checkout(uuid) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════
-- D. Backfill: close OPEN folios for departed, fully-settled bookings.
--    A booking is "departed" when it has a checked_out stay and NO active stay.
--    Departed bookings that still carry a balance (forced / auto checkouts) are
--    left OPEN on purpose -- they are real receivables surfaced by (E).
--    Folios with no stay at all (e.g. cancelled reservations) are left untouched
--    here; that is a separate lifecycle, out of scope for the checkout audit.
-- ════════════════════════════════════════════════════════════════════════
UPDATE public.folios f
SET status = 'CLOSED', updated_at = now()
WHERE f.status = 'OPEN'
  AND EXISTS (
      SELECT 1 FROM public.stays s
      WHERE s.booking_id = f.booking_id AND s.status = 'checked_out')
  AND NOT EXISTS (
      SELECT 1 FROM public.stays s
      WHERE s.booking_id = f.booking_id
        AND s.status IN ('inhouse', 'arriving', 'checkout_requested'))
  AND abs(COALESCE(
      (SELECT SUM(amount) FROM public.folio_entries e WHERE e.folio_id = f.id), 0)) < 0.005;

-- ════════════════════════════════════════════════════════════════════════
-- E. Outstanding-balance summary: split guest ledger (in-house) from city
--    ledger (departed receivables). One source of truth, membership-guarded.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_outstanding_balance_summary(p_hotel_id uuid)
RETURNS TABLE(
    in_house_owed        numeric,
    in_house_stays       integer,
    in_house_open_folios integer,
    refund_owed          numeric,
    departed_owed        numeric,
    departed_count       integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT (public.vaiyu_is_hotel_member(p_hotel_id) OR public.is_platform_admin()) THEN
        RAISE EXCEPTION 'Not authorized for this hotel'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN QUERY
    WITH folio_bal AS (
        SELECT f.id,
               COALESCE(SUM(e.amount), 0) AS bal,
               EXISTS (
                   SELECT 1 FROM public.stays s
                   WHERE s.booking_id = f.booking_id
                     AND s.status IN ('inhouse', 'arriving', 'checkout_requested')
               ) AS is_in_house
        FROM public.folios f
        LEFT JOIN public.folio_entries e ON e.folio_id = f.id
        WHERE f.hotel_id = p_hotel_id
          AND f.status = 'OPEN'
        GROUP BY f.id, f.booking_id
    )
    SELECT
        COALESCE(SUM(bal)  FILTER (WHERE is_in_house AND bal > 0.005), 0)::numeric,
        COUNT(*)           FILTER (WHERE is_in_house AND bal > 0.005)::int,
        COUNT(*)           FILTER (WHERE is_in_house)::int,
        COALESCE(SUM(-bal) FILTER (WHERE is_in_house AND bal < -0.005), 0)::numeric,
        COALESCE(SUM(bal)  FILTER (WHERE NOT is_in_house AND bal > 0.005), 0)::numeric,
        COUNT(*)           FILTER (WHERE NOT is_in_house AND bal > 0.005)::int
    FROM folio_bal;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_outstanding_balance_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_outstanding_balance_summary(uuid) TO authenticated, service_role;
