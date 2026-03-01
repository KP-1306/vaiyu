-- ============================================================
-- ENTERPRISE CHECKOUT RPC
-- ============================================================

CREATE OR REPLACE FUNCTION checkout_stay(
    p_hotel_id UUID,
    p_booking_id UUID,
    p_stay_id UUID,
    p_force BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pending_amount NUMERIC;
    v_room_id UUID;
    v_now TIMESTAMPTZ := now();
BEGIN

    ---------------------------------------------------------
    -- 1️⃣ Pessimistic Locking & Validation
    ---------------------------------------------------------
    -- Lock stay row and fetch room_id directly
    SELECT room_id INTO v_room_id 
    FROM stays
    WHERE id = p_stay_id
      AND booking_id = p_booking_id
      AND status = 'checkout_requested' -- Strictly enforce request flow
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Stay not found or checkout hasn''t been requested yet.'
        );
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
    -- 2️⃣ Explicit Folio Locking
    ---------------------------------------------------------
    PERFORM 1
    FROM folios
    WHERE booking_id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'No folio found for booking'
        );
    END IF;


    ---------------------------------------------------------
    -- 3️⃣ Revalidate Operational Safety
    ---------------------------------------------------------
    -- Block if open tickets exist (force flag only bypasses financials, not service limits)
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

    -- Block if pending food orders exist
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
    -- Calculate balance safely now that folios are locked
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
    -- 5️⃣ Close Stay (Alignment with lowercase stays.status)
    ---------------------------------------------------------
    UPDATE stays
    SET
        status = 'checked_out',
        actual_checkout_at = v_now
    WHERE id = p_stay_id;


    ---------------------------------------------------------
    -- 6️⃣ Update Booking Status (Consistent lowercase)
    ---------------------------------------------------------
    UPDATE bookings
    SET status = 'checked_out',
        updated_at = v_now
    WHERE id = p_booking_id;

    -- Update booking_rooms statuses for this booking (Consistent lowercase)
    UPDATE booking_rooms
    SET status = 'checked_out',
        updated_at = v_now
    WHERE booking_id = p_booking_id
      AND room_id = v_room_id;


    ---------------------------------------------------------
    -- 7️⃣ Mark Room Dirty (Pessimistic Locking on rooms)
    ---------------------------------------------------------
    -- We already have v_room_id from step 1
    PERFORM 1 FROM rooms WHERE id = v_room_id FOR UPDATE;
    
    UPDATE rooms
    SET housekeeping_status = 'dirty',
        updated_at = v_now
    WHERE id = v_room_id;


    ---------------------------------------------------------
    -- 8️⃣ Log Arrival Event (Explicit Event Type: CHECKOUT)
    ---------------------------------------------------------
    INSERT INTO arrival_events (
        hotel_id,
        booking_id,
        event_type,
        details,
        performed_by
    )
    VALUES (
        p_hotel_id,
        p_booking_id,
        'CHECKOUT',
        jsonb_build_object(
            'stay_id', p_stay_id,
            'room_id', v_room_id,
            'force', p_force,
            'balance_at_checkout', v_pending_amount
        ),
        COALESCE(auth.uid(), NULL)
    );


    ---------------------------------------------------------
    -- 9️⃣ Success Response
    ---------------------------------------------------------
    RETURN jsonb_build_object(
        'success', true,
        'checked_out_at', v_now
    );

END;
$$;

GRANT EXECUTE ON FUNCTION checkout_stay(UUID, UUID, UUID, BOOLEAN)
TO authenticated, service_role;

-- ============================================================
-- FOOD ORDER TO FOLIO INTEGRATION
-- ============================================================

CREATE OR REPLACE FUNCTION trg_food_to_folio()
RETURNS trigger AS $$
DECLARE
    v_folio_id UUID;
    v_booking_id UUID;
BEGIN
    IF NEW.status = 'DELIVERED' AND OLD.status IS DISTINCT FROM 'DELIVERED' THEN

        SELECT s.booking_id, f.id
        INTO STRICT v_booking_id, v_folio_id
        FROM stays s
        JOIN folios f ON f.booking_id = s.booking_id
        WHERE s.id = NEW.stay_id;

        IF v_folio_id IS NULL THEN
            RAISE EXCEPTION 'Folio not found for stay %', NEW.stay_id;
        END IF;

        INSERT INTO folio_entries (
            hotel_id,
            booking_id,
            folio_id,
            entry_type,
            amount,
            description,
            reference_id
        )
        VALUES (
            NEW.hotel_id,
            v_booking_id,
            v_folio_id,
            'FOOD_CHARGE',
            NEW.total_amount,
            'Food Order ' || NEW.display_id,
            NEW.id
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_food_delivered ON food_orders;
CREATE TRIGGER trg_food_delivered
AFTER UPDATE ON food_orders
FOR EACH ROW
EXECUTE FUNCTION trg_food_to_folio();

-- ============================================================
-- PAYMENT TO FOLIO INTEGRATION
-- ============================================================

CREATE OR REPLACE FUNCTION trg_payment_to_folio()
RETURNS trigger AS $$
BEGIN
    IF NEW.status = 'COMPLETED' THEN

        INSERT INTO folio_entries (
            hotel_id,
            booking_id,
            folio_id,
            entry_type,
            amount,
            description,
            reference_id
        )
        SELECT
            NEW.hotel_id,
            NEW.booking_id,
            NEW.folio_id,
            'PAYMENT',
            -NEW.amount,
            'Payment via ' || REPLACE(NEW.method, '_', ' '),
            NEW.id;

    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_completed ON payments;
CREATE TRIGGER trg_payment_completed
AFTER INSERT ON payments
FOR EACH ROW
EXECUTE FUNCTION trg_payment_to_folio();

-- ============================================================
-- FOLIO BALANCE AND CHECKOUT OVERRIDE
-- ============================================================

CREATE OR REPLACE VIEW v_folio_balance AS
SELECT
    booking_id,
    SUM(amount) AS balance
FROM folio_entries
GROUP BY booking_id;

CREATE OR REPLACE FUNCTION checkout_booking(
    p_booking_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_balance NUMERIC;
BEGIN
    SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM folio_entries
    WHERE booking_id = p_booking_id;

    IF COALESCE(v_balance,0) > 0 THEN -- Changed from <> 0 to allow checkouts with credit/zero balance
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Outstanding balance must be settled before checkout'
        );
    END IF;

    UPDATE folios
    SET status = 'CLOSED'
    WHERE booking_id = p_booking_id;

    UPDATE stays
    SET actual_checkout_at = now()
    WHERE booking_id = p_booking_id
    AND actual_checkout_at IS NULL;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- COLLECT PAYMENT RPC
-- ============================================================

CREATE OR REPLACE FUNCTION collect_payment(
    p_booking_id UUID,
    p_amount NUMERIC,
    p_method TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_folio_id UUID;
    v_payment_id UUID;
    v_hotel_id UUID;
    v_outstanding NUMERIC;
    v_booking_status TEXT;
BEGIN

    -- 1. Basic & Method Validation
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Invalid payment amount';
    END IF;

    IF p_method NOT IN ('CASH', 'CARD', 'UPI', 'BANK_TRANSFER') THEN
        RAISE EXCEPTION 'Invalid payment method: %', p_method;
    END IF;

    -- 2. Pessimistic Lock on Booking (Prevents Race Conditions)
    SELECT hotel_id, status INTO v_hotel_id, v_booking_status
    FROM bookings 
    WHERE id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booking not found';
    END IF;

    -- 3. Enforce Booking Status
    IF UPPER(v_booking_status) NOT IN ('CHECKED_IN', 'INHOUSE', 'PRE_CHECKED_IN') THEN
        RAISE EXCEPTION 'Payments not allowed for booking status: %', v_booking_status;
    END IF;

    -- 4. Get and Lock Folio Row
    SELECT id INTO v_folio_id
    FROM folios
    WHERE booking_id = p_booking_id
    LIMIT 1
    FOR UPDATE;

    IF v_folio_id IS NULL THEN
        RAISE EXCEPTION 'Folio not found';
    END IF;

    -- 5. Calculate Outstanding Balance (Scoped strictly to Folio)
    SELECT COALESCE(SUM(amount), 0)
    INTO v_outstanding
    FROM folio_entries
    WHERE folio_id = v_folio_id;

    -- 6. Prevent Zero/Overpayment
    IF v_outstanding <= 0 THEN
        RAISE EXCEPTION 'No outstanding balance on this folio';
    END IF;

    IF p_amount > v_outstanding THEN
        RAISE EXCEPTION 'Payment of % exceeds outstanding balance of %', p_amount, v_outstanding;
    END IF;

    -- 7. Insert Payment Record (Trigger handles Folio Entry)
    INSERT INTO payments (
        hotel_id,
        booking_id,
        folio_id,
        amount,
        method,
        status,
        collected_by
    )
    VALUES (
        v_hotel_id,
        p_booking_id,
        v_folio_id,
        p_amount,
        p_method,
        'COMPLETED',
        auth.uid()
    )
    RETURNING id INTO v_payment_id;

    RETURN jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION collect_payment(UUID, NUMERIC, TEXT) TO authenticated, service_role;

-- ============================================================
-- ENTERPRISE LEDGER IMMUTABILITY
-- ============================================================

-- 1. Prevent DELETE on payments
CREATE OR REPLACE FUNCTION trg_prevent_payment_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Payments cannot be deleted. Adjust the ledger with a new entry instead.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_payment_delete ON payments;
CREATE TRIGGER prevent_payment_delete
BEFORE DELETE ON payments
FOR EACH ROW EXECUTE FUNCTION trg_prevent_payment_delete();

-- 2. Restrict UPDATE on payments
CREATE OR REPLACE FUNCTION trg_restrict_payment_update()
RETURNS TRIGGER AS $$
BEGIN
    -- 1. Blanket Immutability for Terminal States
    -- If a payment is completed, failed, or refunded, NO field (not even description) can be modified.
    IF OLD.status IN ('COMPLETED', 'FAILED', 'REFUNDED') THEN
        RAISE EXCEPTION 'Terminal payments are completely immutable. Reverse with a new entry instead.';
    END IF;

    -- 2. Prevent altering relational keys and audit fields for PENDING payments
    IF NEW.booking_id IS DISTINCT FROM OLD.booking_id THEN
        RAISE EXCEPTION 'Cannot update booking_id.';
    END IF;

    IF NEW.hotel_id IS DISTINCT FROM OLD.hotel_id THEN
        RAISE EXCEPTION 'Cannot update hotel_id.';
    END IF;

    IF NEW.collected_by IS DISTINCT FROM OLD.collected_by THEN
        RAISE EXCEPTION 'Cannot modify collected_by.';
    END IF;

    -- 3. Prevent altering core financial data for PENDING payments
    IF NEW.amount IS DISTINCT FROM OLD.amount THEN
        RAISE EXCEPTION 'Cannot update payment amount. Reverse and create a new payment.';
    END IF;
    
    IF NEW.method IS DISTINCT FROM OLD.method THEN
        RAISE EXCEPTION 'Cannot update payment method.';
    END IF;
    
    IF NEW.folio_id IS DISTINCT FROM OLD.folio_id THEN
        RAISE EXCEPTION 'Cannot update payment folio_id.';
    END IF;

    -- 4. Only allow PENDING -> COMPLETED or FAILED
    IF OLD.status = 'PENDING' AND NEW.status NOT IN ('COMPLETED', 'FAILED') AND NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'Invalid status transition from PENDING to %', NEW.status;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS restrict_payment_update ON payments;
CREATE TRIGGER restrict_payment_update
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION trg_restrict_payment_update();
