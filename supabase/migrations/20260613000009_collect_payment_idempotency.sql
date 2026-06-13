-- Make manual/cash payment collection idempotent.
--
-- `collect_payment` had no idempotency. A double-submit (network retry, two
-- tabs, or a fast double-tap that beats the client button-disable) of a PARTIAL
-- payment inserted it twice → folio double-credited → hotel under-collects at
-- checkout. Reproduced on local: ₹40 submitted twice dropped outstanding
-- ₹100→₹20 (₹80 credited for one ₹40 collection). Full-balance submits were
-- already safe — the overpayment guard rejects the second once outstanding hits 0.
--
-- Fix: a client-supplied idempotency key. A retry with the same key returns the
-- original payment; a genuine second payment uses a fresh key. Mirrors how the
-- Razorpay path dedups on `razorpay_payment_id`.

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS idempotency_key uuid;

-- Only non-null keys are unique; Razorpay/legacy rows leave it null (and a
-- unique index treats nulls as distinct, so they never collide).
CREATE UNIQUE INDEX IF NOT EXISTS payments_idempotency_key_uq
  ON public.payments (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Replace both overloads (the 3-arg used by the UI + the unused legacy 4-arg
-- p_user) with a single function. DEFAULT NULL keeps any 3-arg caller working
-- without the "function is not unique" ambiguity a defaulted arg would create
-- alongside a separate 3-arg definition.
DROP FUNCTION IF EXISTS public.collect_payment(uuid, numeric, text);
DROP FUNCTION IF EXISTS public.collect_payment(uuid, numeric, text, uuid);

CREATE OR REPLACE FUNCTION public.collect_payment(
    p_booking_id uuid,
    p_amount numeric,
    p_method text,
    p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
    v_folio_id UUID;
    v_payment_id UUID;
    v_hotel_id UUID;
    v_outstanding NUMERIC;
    v_booking_status TEXT;
    v_existing UUID;
BEGIN
    -- 1. Basic & method validation
    IF p_amount IS NULL OR p_amount <= 0 THEN
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

GRANT EXECUTE ON FUNCTION public.collect_payment(uuid, numeric, text, uuid)
  TO anon, authenticated, service_role;
