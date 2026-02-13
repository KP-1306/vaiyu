-- Migration: Fix Pre-checkin Token RPC
-- Purpose: Correct the search path for gen_random_bytes and add missing RLS policies.

-- 1. Correct the RPC
CREATE OR REPLACE FUNCTION public.create_precheckin_token(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions -- CRITICAL: Make extensions functions visible
AS $$
DECLARE
    v_token TEXT;
    v_new_token TEXT;
    v_expires_at TIMESTAMPTZ;
    v_checkin_date DATE;
BEGIN
    -- Get scheduled checkin date to set expiry (e.g., 23:00 on check-in day)
    SELECT scheduled_checkin_at INTO v_checkin_date
    FROM public.bookings
    WHERE id = p_booking_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booking not found';
    END IF;

    -- Default expiry: Check-in date at 23:59 + 23 hours? No, same day 23:00 + interval?
    -- Hardening: Ensure token is valid for at least 12 hours from now even if check-in was in the past
    v_expires_at := GREATEST(
        (v_checkin_date::timestamp + INTERVAL '23 hours'),
        now() + INTERVAL '12 hours'
    );
    
    -- Fallback if checkin date is missing or invalid logic: 30 days
    IF v_expires_at IS NULL THEN
        v_expires_at := now() + INTERVAL '30 days';
    END IF;

    -- Hardening: Pre-calculate token to avoid reuse issues
    v_new_token := encode(gen_random_bytes(32), 'hex');

    -- Hardening: Ensure unique constraint name matches user's schema
    -- User's constraint is 'uq_precheckin_booking'.
    INSERT INTO public.precheckin_tokens (booking_id, token, expires_at)
    VALUES (
        p_booking_id,
        v_new_token,
        v_expires_at
    )
    ON CONFLICT (booking_id) -- This handles any unique constraint on booking_id (uq_precheckin_booking or idx_...)
    DO UPDATE SET 
        token = EXCLUDED.token,
        expires_at = EXCLUDED.expires_at,
        updated_at = now()
    RETURNING token INTO v_token;

    RETURN jsonb_build_object(
        'booking_id', p_booking_id,
        'token', v_token,
        'expires_at', v_expires_at
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_precheckin_token TO service_role;

-- Hardening 2: Ensure unique index for ON CONFLICT
CREATE UNIQUE INDEX IF NOT EXISTS idx_precheckin_tokens_booking
ON public.precheckin_tokens(booking_id);

-- Hardening 3: Index for fast token lookup (Guest Portal)
CREATE INDEX IF NOT EXISTS idx_precheckin_tokens_token
ON public.precheckin_tokens(token);


-- 2. Add Policies (safely)
DO $$
BEGIN
    -- Enable RLS (idempotent)
    ALTER TABLE public.precheckin_tokens ENABLE ROW LEVEL SECURITY;

    -- Drop existing policies to avoid conflicts
    DROP POLICY IF EXISTS "Service role manages tokens" ON public.precheckin_tokens;
    DROP POLICY IF EXISTS "Staff can view tokens" ON public.precheckin_tokens;

    -- Create Policies
    CREATE POLICY "Service role manages tokens"
    ON public.precheckin_tokens
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

    CREATE POLICY "Staff can view tokens"
    ON public.precheckin_tokens
    FOR SELECT
    TO authenticated
    USING (
         EXISTS (
            SELECT 1 FROM public.bookings b
            JOIN public.hotels h ON b.hotel_id = h.id
            WHERE b.id = precheckin_tokens.booking_id
            AND EXISTS (
                 SELECT 1 FROM public.hotel_members hm
                 WHERE hm.hotel_id = h.id
                 AND hm.user_id = auth.uid()
            )
        )
    );
END $$;
