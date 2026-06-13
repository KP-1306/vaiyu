-- collect_payment: add a "settle in full" mode (p_amount = NULL).
--
-- Why: the walk-in cash path recorded a payment via a raw INSERT with a
-- CLIENT-computed amount (liveTotals.totalPayable) and no server validation.
-- Every other payment path treats the amount as server-canonical. Worse, the
-- client computes tax UNROUNDED on the aggregate net while create_walkin_v2
-- computes it ROUNDED per room (Σ round ≠ round Σ), so the client figure can
-- drift from the folio's actual charges by paise — a latent money-correctness
-- gap.
--
-- Routing walk-in cash through collect_payment (locked, idempotent,
-- overpayment-guarded) fixes it, but passing the client amount would let that
-- same rounding drift trip the overpayment guard and REJECT legitimate cash. So
-- collect_payment now accepts p_amount = NULL meaning "settle the full
-- outstanding balance", computed server-side. The amount is then never trusted
-- from the client.
--
-- This change is purely additive: every existing caller passes an explicit
-- amount (FolioDrawer partial/full payments) and is unaffected.

CREATE OR REPLACE FUNCTION public.collect_payment(p_booking_id uuid, p_amount numeric, p_method text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_folio_id UUID;
    v_payment_id UUID;
    v_hotel_id UUID;
    v_outstanding NUMERIC;
    v_booking_status TEXT;
    v_existing UUID;
BEGIN
    -- 1. Basic & method validation. p_amount NULL is allowed and means
    --    "settle the full outstanding balance" (resolved server-side at step 6).
    IF p_amount IS NOT NULL AND p_amount <= 0 THEN
        RAISE EXCEPTION 'Invalid payment amount';
    END IF;
    IF p_method NOT IN ('CASH', 'CARD', 'UPI', 'BANK_TRANSFER') THEN
        RAISE EXCEPTION 'Invalid payment method: %', p_method;
    END IF;

    -- 2. Pessimistic lock on booking (serializes concurrent submits)
    SELECT hotel_id, status INTO v_hotel_id, v_booking_status
    FROM bookings WHERE id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booking not found';
    END IF;

    -- 3. Idempotency: a retry with the same key returns the original payment.
    --    Checked AFTER the lock so a concurrent retry waits, then sees the
    --    committed first row rather than inserting a duplicate.
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_existing
        FROM payments
        WHERE idempotency_key = p_idempotency_key AND booking_id = p_booking_id
        LIMIT 1;
        IF v_existing IS NOT NULL THEN
            RETURN jsonb_build_object('success', true, 'payment_id', v_existing, 'deduped', true);
        END IF;
    END IF;

    -- 4. Enforce booking status
    IF UPPER(v_booking_status) NOT IN ('CHECKED_IN', 'INHOUSE', 'PRE_CHECKED_IN') THEN
        RAISE EXCEPTION 'Payments not allowed for booking status: %', v_booking_status;
    END IF;

    -- 5. Lock folio
    SELECT id INTO v_folio_id FROM folios WHERE booking_id = p_booking_id LIMIT 1 FOR UPDATE;
    IF v_folio_id IS NULL THEN
        RAISE EXCEPTION 'Folio not found';
    END IF;

    -- 6. Outstanding + overpayment guard
    SELECT COALESCE(SUM(amount), 0) INTO v_outstanding FROM folio_entries WHERE folio_id = v_folio_id;
    IF v_outstanding <= 0 THEN
        RAISE EXCEPTION 'No outstanding balance on this folio';
    END IF;

    -- NULL amount = settle the full outstanding balance (server-computed). This
    -- is how the walk-in cash path collects "the whole bill" without trusting a
    -- client-sent figure.
    IF p_amount IS NULL THEN
        p_amount := v_outstanding;
    END IF;

    IF p_amount > v_outstanding THEN
        RAISE EXCEPTION 'Payment of % exceeds outstanding balance of %', p_amount, v_outstanding;
    END IF;

    -- 7. Insert payment (trigger posts the folio entry). A concurrent retry that
    --    races past step 3 is caught by the partial unique index here.
    BEGIN
        INSERT INTO payments (
            hotel_id, booking_id, folio_id, amount, method, status, collected_by, idempotency_key
        )
        VALUES (
            v_hotel_id, p_booking_id, v_folio_id, p_amount, p_method, 'COMPLETED', auth.uid(), p_idempotency_key
        )
        RETURNING id INTO v_payment_id;
    EXCEPTION WHEN unique_violation THEN
        IF p_idempotency_key IS NULL THEN
            RAISE;  -- not an idempotency collision; surface it
        END IF;
        SELECT id INTO v_existing
        FROM payments
        WHERE idempotency_key = p_idempotency_key AND booking_id = p_booking_id
        LIMIT 1;
        RETURN jsonb_build_object('success', true, 'payment_id', v_existing, 'deduped', true);
    END;

    RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id);
END;
$function$;
