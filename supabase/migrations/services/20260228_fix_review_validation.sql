-- ============================================================
-- FIX: REVIEW VALIDATION FOR CHECKOUT REQUEST FLOW
-- ============================================================

CREATE OR REPLACE FUNCTION trg_validate_review_booking_state()
RETURNS TRIGGER 
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_status TEXT;
    v_hotel_id UUID;
BEGIN
    -- Get booking status and hotel_id
    SELECT status, hotel_id INTO v_status, v_hotel_id 
    FROM bookings 
    WHERE id = NEW.booking_id;

    -- Allow reviews if:
    -- 1. Booking is officially CHECKED_OUT or COMPLETED
    -- 2. OR at least one stay in this booking has 'checkout_requested' (guest is done with service)
    -- 3. OR at least one stay is already 'checked_out'
    IF UPPER(v_status) NOT IN ('CHECKED_OUT', 'COMPLETED') THEN
        IF NOT EXISTS (
            SELECT 1 FROM stays 
            WHERE booking_id = NEW.booking_id 
            AND status IN ('checkout_requested', 'checked_out')
        ) THEN
            RAISE EXCEPTION 'Reviews can only be submitted post-service (Booking Status: %, No requested checkouts found)', v_status;
        END IF;
    END IF;
    
    -- Hotel integrity check (Security)
    IF v_hotel_id != NEW.hotel_id THEN
        RAISE EXCEPTION 'Booking hotel does not match review hotel';
    END IF;
    
    RETURN NEW;
END;
$$;

-- Re-apply trigger to ensure it uses the new function
DROP TRIGGER IF EXISTS validate_review_booking_state ON guest_reviews;
CREATE TRIGGER validate_review_booking_state
BEFORE INSERT ON guest_reviews
FOR EACH ROW
EXECUTE FUNCTION trg_validate_review_booking_state();
