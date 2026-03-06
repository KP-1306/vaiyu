-- Migration: Secure Invitation Acceptance Flow
-- Target: Refactor hotel_members and add accept_hotel_invite RPC
-- Date: 2026-03-03

BEGIN;

-- 1. Essential Schema Adjustments
-- Relaxing constraints so the invitation function can insert records 
-- without needing department or status info upfront.
ALTER TABLE public.hotel_members 
ALTER COLUMN role DROP NOT NULL,
ALTER COLUMN primary_department_id DROP NOT NULL,
ALTER COLUMN is_active SET DEFAULT true,
ALTER COLUMN is_verified SET DEFAULT false,
ALTER COLUMN updated_at SET DEFAULT now();

-- [HARDENING] Ensure unique constraints for race-condition safety
CREATE UNIQUE INDEX IF NOT EXISTS ux_hotel_member_unique
ON public.hotel_members (hotel_id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_hotel_member_roles_unique
ON public.hotel_member_roles (hotel_member_id, role_id);

-- 2. Create the Invitation Acceptance RPC
CREATE OR REPLACE FUNCTION public.accept_hotel_invite(
    p_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invite RECORD;
    v_user_id uuid;
    v_user_email text;
    v_membership_id uuid;
BEGIN
    -- Require authentication
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- Get authenticated user's email safely
    SELECT email INTO v_user_email
    FROM auth.users
    WHERE id = v_user_id;

    IF v_user_email IS NULL THEN
        RAISE EXCEPTION 'Authenticated user email not found';
    END IF;

    -- Lock invite row
    SELECT *
    INTO v_invite
    FROM public.hotel_invites
    WHERE token = p_token
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid invite token';
    END IF;

    -- Already accepted → ensure membership exists (defensive check)
    IF v_invite.status = 'accepted' THEN
        SELECT id INTO v_membership_id
        FROM public.hotel_members
        WHERE hotel_id = v_invite.hotel_id
        AND user_id = v_user_id;

        -- [HARDENING] Ensure membership really exists
        IF v_membership_id IS NULL THEN
            RAISE EXCEPTION 'Invite accepted but membership missing. Contact support.';
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'hotel_id', v_invite.hotel_id,
            'membership_id', v_membership_id,
            'message', 'Invite already accepted'
        );
    END IF;

    -- Status validation
    IF v_invite.status <> 'pending' THEN
        RAISE EXCEPTION 'Invite is not active (status: %)', v_invite.status;
    END IF;

    -- Expiry validation
    IF v_invite.expires_at < now() THEN
        -- [HARDENING] Conditional update for state integrity
        UPDATE public.hotel_invites
        SET status = 'expired'
        WHERE id = v_invite.id
        AND status = 'pending'
        AND expires_at < now();

        RAISE EXCEPTION 'Invite has expired';
    END IF;

    -- Email match validation (case-insensitive)
    IF lower(v_invite.email) <> lower(v_user_email) THEN
        RAISE EXCEPTION 'This invite is not assigned to your email';
    END IF;

    -- Core Transaction: Create membership and assign role
    -- Insert membership safely (race-condition protected via UNIQUE index)
    BEGIN
        INSERT INTO public.hotel_members (
            hotel_id,
            user_id,
            created_at
        )
        VALUES (
            v_invite.hotel_id,
            v_user_id,
            now()
        )
        RETURNING id INTO v_membership_id;

        -- Assign the role via the join table (protected via UNIQUE index)
        INSERT INTO public.hotel_member_roles (
            hotel_member_id,
            role_id
        )
        VALUES (
            v_membership_id,
            v_invite.role_id
        );

    EXCEPTION
        WHEN unique_violation THEN
            -- Already member → fetch existing membership ID
            SELECT id INTO v_membership_id
            FROM public.hotel_members
            WHERE hotel_id = v_invite.hotel_id
            AND user_id = v_user_id;

            -- Check if role already assigned, if not assign it (idempotent)
            INSERT INTO public.hotel_member_roles (hotel_member_id, role_id)
            VALUES (v_membership_id, v_invite.role_id)
            ON CONFLICT DO NOTHING;
    END;

    -- Mark invite accepted
    UPDATE public.hotel_invites
    SET status = 'accepted',
        accepted_at = now()
    WHERE id = v_invite.id;

    RETURN jsonb_build_object(
        'success', true,
        'hotel_id', v_invite.hotel_id,
        'membership_id', v_membership_id,
        'role_id', v_invite.role_id
    );

END;
$$;

-- 3. Create the Revoke Invitation RPC
CREATE OR REPLACE FUNCTION public.revoke_hotel_invite(
    p_invite_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invite RECORD;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- Lock invite row
    SELECT *
    INTO v_invite
    FROM public.hotel_invites
    WHERE id = p_invite_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invite not found';
    END IF;

    -- 🔒 Ensure caller belongs to same hotel
    IF NOT EXISTS (
        SELECT 1
        FROM public.hotel_members hm
        WHERE hm.hotel_id = v_invite.hotel_id
        AND hm.user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Access denied for this hotel';
    END IF;

    -- Idempotent behavior
    IF v_invite.status = 'revoked' THEN
        RETURN jsonb_build_object(
            'success', true,
            'invite_id', v_invite.id,
            'status', 'revoked',
            'message', 'Invite already revoked'
        );
    END IF;

    -- Cannot revoke accepted invite
    IF v_invite.status = 'accepted' THEN
        RAISE EXCEPTION 'Cannot revoke an accepted invite';
    END IF;

    UPDATE public.hotel_invites
    SET status = 'revoked'
    WHERE id = v_invite.id
    AND status IN ('pending','expired');

    RETURN jsonb_build_object(
        'success', true,
        'invite_id', v_invite.id,
        'status', 'revoked'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_hotel_invite(uuid) TO authenticated;

-- 4. Create the Resend Invitation RPC
CREATE OR REPLACE FUNCTION public.resend_hotel_invite(
    p_invite_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invite RECORD;
    v_max_resend integer := 5;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- Lock invite row
    SELECT *
    INTO v_invite
    FROM public.hotel_invites
    WHERE id = p_invite_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invite not found';
    END IF;

    -- 🔒 Ensure caller belongs to same hotel
    IF NOT EXISTS (
        SELECT 1
        FROM public.hotel_members hm
        WHERE hm.hotel_id = v_invite.hotel_id
        AND hm.user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Access denied for this hotel';
    END IF;

    -- State validation
    IF v_invite.status = 'accepted' THEN
        RAISE EXCEPTION 'Cannot resend accepted invite';
    END IF;

    IF v_invite.status = 'revoked' THEN
        RAISE EXCEPTION 'Cannot resend revoked invite';
    END IF;

    -- Resend limit
    IF v_invite.resend_count >= v_max_resend THEN
        RAISE EXCEPTION 'Resend limit exceeded';
    END IF;

    -- Optional cooldown (enterprise safety)
    IF v_invite.last_sent_at IS NOT NULL
       AND v_invite.last_sent_at > now() - interval '30 seconds'
    THEN
        RAISE EXCEPTION 'Invite recently sent. Please wait.';
    END IF;

    -- If expired, reactivate and extend expiry
    IF v_invite.status = 'expired' OR v_invite.expires_at < now() THEN
        UPDATE public.hotel_invites
        SET status = 'pending',
            expires_at = now() + interval '7 days'
        WHERE id = v_invite.id;
    END IF;

    -- Increment resend tracking
    UPDATE public.hotel_invites
    SET resend_count = resend_count + 1,
        last_sent_at = now()
    WHERE id = v_invite.id;

    -- Re-fetch latest values
    SELECT *
    INTO v_invite
    FROM public.hotel_invites
    WHERE id = p_invite_id;

    RETURN jsonb_build_object(
        'success', true,
        'invite_id', v_invite.id,
        'resend_count', v_invite.resend_count,
        'expires_at', v_invite.expires_at
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resend_hotel_invite(uuid) TO authenticated;

COMMIT;
