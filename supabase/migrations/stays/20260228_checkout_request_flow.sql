-- ============================================================
-- CHECKOUT REQUEST FLOW - PART 2: LOGIC & CONSTRAINTS
-- ============================================================

-- IMPORTANT: Run 20260228_checkout_request_enum.sql FIRST.
-- This file contains the constraints and RPC that depend on the 'checkout_requested' enum value.

-- 1. Update Constraints
ALTER TABLE stays DROP CONSTRAINT IF EXISTS stays_status_valid;
ALTER TABLE stays ADD CONSTRAINT stays_status_valid
CHECK (status IN ('arriving','inhouse','checkout_requested','checked_out','cancelled'));

-- Update Arrival Events Constraint
ALTER TABLE arrival_events DROP CONSTRAINT IF EXISTS arrival_events_type_check;
ALTER TABLE arrival_events ADD CONSTRAINT arrival_events_type_check 
CHECK (event_type IN ('STATUS_CHANGE', 'ROOM_ASSIGNED', 'ROOM_UNASSIGNED', 'ROOM_REASSIGNED', 'CHECKIN', 'CHECKOUT', 'CHECKOUT_REQUESTED', 'CANCEL', 'NO_SHOW'));

-- ============================================================
-- 2. GUEST PORTAL RPC: REQUEST CHECKOUT
-- ============================================================

CREATE OR REPLACE FUNCTION request_checkout(
    p_booking_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_stay_id UUID;
    v_hotel_id UUID;
    v_pending_amount NUMERIC;
    v_now TIMESTAMPTZ := now();
BEGIN

    ---------------------------------------------------------
    -- 1️⃣ Transactional Locking (Order: Booking -> Stay -> Folio)
    ---------------------------------------------------------
    -- A: Lock Booking
    PERFORM 1 FROM bookings WHERE id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Booking not found'
        );
    END IF;

    -- B: Lock Active Stay
    SELECT id, hotel_id INTO v_stay_id, v_hotel_id
    FROM stays
    WHERE booking_id = p_booking_id
      AND status = 'inhouse'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'No active inhouse stay found. Checkout may already be requested or completed.'
        );
    END IF;

    -- C: Lock Folio explicitly
    PERFORM 1 FROM folios WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN
        -- Every booking MUST have a folio in this model
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Booking folio not found'
        );
    END IF;


    ---------------------------------------------------------
    -- 2️⃣ Operational Validations (Strictly enforced)
    ---------------------------------------------------------
    -- A: No Open Tickets
    IF EXISTS (
        SELECT 1 FROM tickets
        WHERE stay_id = v_stay_id
        AND status NOT IN ('COMPLETED', 'CANCELLED')
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'You have open service requests. Please let the front desk close them before checkout.'
        );
    END IF;

    -- B: No Pending Food Orders
    IF EXISTS (
        SELECT 1 FROM food_orders
        WHERE stay_id = v_stay_id
        AND status NOT IN ('DELIVERED', 'CANCELLED', 'REJECTED')
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'You have an active or pending food order. Please wait for delivery before checkout.'
        );
    END IF;


    ---------------------------------------------------------
    -- 3️⃣ Financial Validation (Must be zero balance)
    ---------------------------------------------------------
    -- Calculate balance safely now that folios are locked
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


    ---------------------------------------------------------
    -- 4️⃣ Set Status to Requested
    ---------------------------------------------------------
    UPDATE stays
    SET status = 'checkout_requested',
        updated_at = v_now
    WHERE id = v_stay_id;


    ---------------------------------------------------------
    -- 5️⃣ Log Event
    ---------------------------------------------------------
    INSERT INTO arrival_events (
        hotel_id,
        booking_id,
        event_type,
        details,
        performed_by
    )
    VALUES (
        v_hotel_id,
        p_booking_id,
        'CHECKOUT_REQUESTED',
        jsonb_build_object(
            'stay_id', v_stay_id,
            'balance_at_request', v_pending_amount
        ),
        COALESCE(auth.uid(), NULL)
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Checkout requested successfully.'
    );

END;
$$;

GRANT EXECUTE ON FUNCTION request_checkout(UUID) TO authenticated, service_role;
