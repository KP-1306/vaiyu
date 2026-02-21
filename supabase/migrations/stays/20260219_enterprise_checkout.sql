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
    -- 1️⃣ Validate Stay Exists & Is Inhouse
    ---------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM stays
        WHERE id = p_stay_id
        AND booking_id = p_booking_id
        AND status = 'inhouse'
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Stay not active or already checked out'
        );
    END IF;


    ---------------------------------------------------------
    -- 2️⃣ Validate Payment Status
    ---------------------------------------------------------
    -- Check pending balance across all folios for this booking using the ledger (folio_entries)
    SELECT COALESCE(SUM(amount), 0)
    INTO v_pending_amount
    FROM folio_entries
    WHERE booking_id = p_booking_id;

    IF v_pending_amount > 0 AND p_force = FALSE THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Pending balance exists',
            'pending_amount', v_pending_amount
        );
    END IF;


    ---------------------------------------------------------
    -- 3️⃣ Close Stay
    ---------------------------------------------------------
    UPDATE stays
    SET
        status = 'checked_out',
        checked_out_at = v_now
    WHERE id = p_stay_id;


    ---------------------------------------------------------
    -- 4️⃣ Update Booking Status
    ---------------------------------------------------------
    UPDATE bookings
    SET status = 'CHECKED_OUT'
    WHERE id = p_booking_id;


    ---------------------------------------------------------
    -- 5️⃣ Mark Room Dirty
    ---------------------------------------------------------
    SELECT room_id INTO v_room_id
    FROM booking_rooms
    WHERE booking_id = p_booking_id
    LIMIT 1;

    IF v_room_id IS NOT NULL THEN
        UPDATE rooms
        SET housekeeping_status = 'dirty'
        WHERE id = v_room_id;
    END IF;


    ---------------------------------------------------------
    -- 6️⃣ Log Arrival Event
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
        'STATUS_CHANGE',
        jsonb_build_object(
            'action', 'CHECKOUT',
            'force', p_force
        ),
        COALESCE(auth.uid(), NULL)
    );


    ---------------------------------------------------------
    -- 7️⃣ Success Response
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
BEGIN
    IF NEW.status = 'DELIVERED' AND OLD.status <> 'DELIVERED' THEN

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
            b.hotel_id,
            b.id,
            f.id,
            'FOOD_CHARGE',
            NEW.total_amount,
            'Food Order #' || NEW.id,
            NEW.id
        FROM bookings b
        JOIN folios f ON f.booking_id = b.id
        WHERE b.id = NEW.booking_id;

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
            'Payment via ' || NEW.method,
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
    p_method TEXT,
    p_user UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_folio_id UUID;
    v_payment_id UUID;
    v_hotel_id UUID;
BEGIN

    -- get hotel and folio
    SELECT hotel_id INTO v_hotel_id FROM bookings WHERE id = p_booking_id;
    
    SELECT id INTO v_folio_id
    FROM folios
    WHERE booking_id = p_booking_id
    LIMIT 1;

    -- create payment record
    INSERT INTO payments (hotel_id, booking_id, folio_id, amount, method, status, collected_by)
    VALUES (v_hotel_id, p_booking_id, v_folio_id, p_amount, p_method, 'COMPLETED', p_user)
    RETURNING id INTO v_payment_id;

    -- Note: The trigger trg_payment_completed will handle inserting the folio_entry automatically!
    
    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION collect_payment(UUID, NUMERIC, TEXT, UUID) TO authenticated, service_role;
