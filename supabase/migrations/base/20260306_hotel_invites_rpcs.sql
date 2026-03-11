-- Migration: Hotel Invites RPCs (Hardened + Audited)
-- Date: 2026-03-06

BEGIN;

-- Add claim tracking columns
ALTER TABLE IF EXISTS public.hotel_invites
ADD COLUMN IF NOT EXISTS claimed_by uuid REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

-- Ensure unique active invite index exists
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_invite
ON public.hotel_invites (hotel_id, email)
WHERE status = 'pending';

-- Protect against token collisions (safely)
DO $$
BEGIN
IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'hotel_invites_token_unique'
) THEN
    ALTER TABLE public.hotel_invites
    ADD CONSTRAINT hotel_invites_token_unique UNIQUE(token);
END IF;
END $$;


-- ============================================================
-- 1. Create the Invitation Creation RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_hotel_invite(
    p_hotel_id uuid,
    p_email text,
    p_role_id uuid,
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invite RECORD;
BEGIN
    p_email := lower(trim(p_email));

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- [SECURITY] Domain safety check
    IF p_email ILIKE '%@mailinator.com' OR p_email ILIKE '%@10minutemail.com' OR p_email ILIKE '%@tempmail.com' THEN
       RAISE EXCEPTION 'Disallowed email domain provided. Please use a standard email address.';
    END IF;

    -- [SECURITY] Hotel rate limit (prevent hotel spam)
    IF (
        SELECT count(*)
        FROM public.hotel_invites
        WHERE hotel_id = p_hotel_id
        AND created_at > now() - interval '1 hour'
    ) >= 50
    THEN
        RAISE EXCEPTION 'Invite limit exceeded for this hotel. Please try again later.';
    END IF;

    -- [SECURITY] User rate limit (prevent staff spam)
    IF (
        SELECT count(*)
        FROM public.hotel_invites
        WHERE created_by = auth.uid()
        AND created_at > now() - interval '1 hour'
    ) >= 20
    THEN
        RAISE EXCEPTION 'You have sent too many invites recently. Please try again later.';
    END IF;

    -- Permission check: Caller must be OWNER, ADMIN, MANAGER, or Platform Admin
    IF NOT public.is_platform_admin() AND NOT EXISTS (
        SELECT 1
        FROM public.hotel_members hm
        JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
        JOIN public.hotel_roles hr ON hr.id = hmr.role_id
        WHERE hm.hotel_id = p_hotel_id
        AND hm.user_id = auth.uid()
        AND hr.code IN ('OWNER', 'ADMIN', 'MANAGER')
        AND hm.is_active = true
        AND hr.is_active = true
    ) THEN
        RAISE EXCEPTION 'Insufficient permissions to create invites for this hotel';
    END IF;

    -- Insert the invite (idempotency handled by unique index ux_unique_active_invite)
    INSERT INTO public.hotel_invites (
        hotel_id,
        email,
        role_id,
        invite_metadata,
        created_by
    )
    VALUES (
        p_hotel_id,
        p_email,
        p_role_id,
        p_metadata,
        auth.uid()
    )
    RETURNING * INTO v_invite;

    -- Queue the email notification
    INSERT INTO public.notification_queue (
        channel,
        template_code,
        payload
    )
    VALUES (
        'email',
        'staff_invite',
        jsonb_build_object(
            'email', v_invite.email,
            'invite_token', v_invite.token,
            'hotel_id', v_invite.hotel_id,
            'role_id', v_invite.role_id
        )
    );

    -- Enterprise Audit Log
    INSERT INTO public.hotel_audit_logs (
        hotel_id,
        user_id,
        action,
        entity_type,
        entity_id,
        changes
    )
    VALUES (
        p_hotel_id,
        auth.uid(),
        'INVITE_CREATED',
        'hotel_invites',
        v_invite.id,
        jsonb_build_object(
            'email', v_invite.email,
            'role_id', v_invite.role_id
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'invite_id', v_invite.id,
        'token', v_invite.token
    );
END;
$$;

DROP FUNCTION IF EXISTS public.create_hotel_invite(uuid, text, uuid);
GRANT EXECUTE ON FUNCTION public.create_hotel_invite(uuid, text, uuid, jsonb) TO authenticated;

-- ============================================================
-- 2. Create the Invitation Claim RPC (Anti-Race & Anti-Forwarding)
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_hotel_invite(
    p_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user uuid;
    v_user_email text;
    v_invite RECORD;
BEGIN
    v_user := auth.uid();
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- Lock invite row first
    SELECT *
    INTO v_invite
    FROM public.hotel_invites
    WHERE token = p_token
    FOR UPDATE;
 
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invite not found';
    END IF;
 
    -- 1. Expiration check
    IF v_invite.expires_at < now() THEN
        RAISE EXCEPTION 'This invite session has expired. Please open the invite link again.';
    END IF;

    IF v_invite.status <> 'pending' THEN
        RAISE EXCEPTION 'This invite session has expired. Please open the invite link again.';
    END IF;
 
    -- 2. Fetch current user's email STRICTLY once
    SELECT email INTO STRICT v_user_email
    FROM auth.users
    WHERE id = v_user;

    -- Already claimed by someone else
    IF v_invite.claimed_by IS NOT NULL AND v_invite.claimed_by <> v_user THEN
        -- Secure Takeover Rule: Only allow if current user's email matches the invite's email
        IF lower(v_invite.email) <> lower(v_user_email) THEN
            RAISE EXCEPTION 'This invitation was sent to %. Please sign in using that email address to continue.', v_invite.email;
        END IF;
        
        -- If we reached here, email matches, so we allow the silent takeover.
    END IF;
 
    UPDATE public.hotel_invites
    SET
        claimed_by = v_user,
        claimed_at = now()
    WHERE id = v_invite.id
    AND status = 'pending'; -- Replay protection
 
    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_hotel_invite(uuid) TO authenticated;

-- ============================================================
-- 3. Create the Invitation Acceptance RPC (Hardened)
-- ============================================================
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
    v_role_code text;
    v_hotel_status public.hotel_lifecycle_status;
BEGIN
    -- 1. Require authentication & Fetch user info STRICT
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT u.email INTO STRICT v_user_email
    FROM auth.users u
    WHERE u.id = v_user_id;

    -- 2. Lock invite row FIRST (Atomic Lock)
    SELECT *
    INTO v_invite
    FROM public.hotel_invites
    WHERE token = p_token
    FOR UPDATE;

    -- 3. Handle Already Accepted / Membership Case
    -- We do this after lock attempt for consistency
    IF NOT FOUND THEN
        -- Check if user is already a member (might have accepted already, causing token scramble)
        SELECT id INTO v_membership_id
        FROM public.hotel_members
        WHERE hotel_id = (SELECT hotel_id FROM public.hotel_invites WHERE (token = p_token OR email = v_user_email) AND status = 'accepted' LIMIT 1)
        AND user_id = v_user_id;

        IF v_membership_id IS NOT NULL THEN
            SELECT hotel_id INTO v_invite.hotel_id FROM public.hotel_members WHERE id = v_membership_id;
            RETURN jsonb_build_object(
                'success', true,
                'hotel_id', v_invite.hotel_id,
                'membership_id', v_membership_id,
                'message', 'Invite already accepted'
            );
        END IF;

        RAISE EXCEPTION 'Invalid invite token';
    END IF;

    -- 4. Validation Layer
    IF v_invite.status = 'accepted' THEN
         SELECT id INTO v_membership_id FROM public.hotel_members WHERE hotel_id = v_invite.hotel_id AND user_id = v_user_id;
         RETURN jsonb_build_object('success', true, 'hotel_id', v_invite.hotel_id, 'membership_id', v_membership_id, 'message', 'Invite already accepted');
    END IF;

    IF v_invite.status <> 'pending' THEN
        RAISE EXCEPTION 'This invite session has expired. Please open the invite link again.';
    END IF;

    IF v_invite.expires_at < now() THEN
        UPDATE public.hotel_invites SET status = 'expired' WHERE id = v_invite.id AND status = 'pending';
        RAISE EXCEPTION 'Invite has expired';
    END IF;

    -- Enforce claim (Anti-Race & Anti-Forwarding)
    IF v_invite.claimed_by IS NULL THEN
        RAISE EXCEPTION 'This invite session has expired. Please open the invite link again.';
    END IF;

    IF v_invite.claimed_by <> v_user_id THEN
        -- Secure Takeover Rule: Only allow if current user's email matches the invite's email
        IF lower(v_invite.email) <> lower(v_user_email) THEN
            RAISE EXCEPTION 'This invitation was sent to %. Please sign in using that email address to continue.', v_invite.email;
        END IF;
    END IF;

    -- Email match validation (case-insensitive)
    IF lower(v_invite.email) <> lower(v_user_email) THEN
        RAISE EXCEPTION 'This invite is not assigned to your email';
    END IF;

    -- 5. Core Transaction: Create membership and assign role
    BEGIN
        INSERT INTO public.hotel_members (
            hotel_id, user_id, role, status, is_active, created_at
        )
        VALUES (
            v_invite.hotel_id, v_user_id, 'STAFF', 'active', true, now()
        )
        RETURNING id INTO v_membership_id;

        INSERT INTO public.hotel_member_roles (hotel_member_id, role_id)
        VALUES (v_membership_id, v_invite.role_id);

    EXCEPTION
        WHEN unique_violation THEN
            SELECT id INTO v_membership_id FROM public.hotel_members WHERE hotel_id = v_invite.hotel_id AND user_id = v_user_id;
            INSERT INTO public.hotel_member_roles (hotel_member_id, role_id)
            VALUES (v_membership_id, v_invite.role_id) ON CONFLICT DO NOTHING;
    END;

    -- 6. Mark invite accepted (Replay Protection)
    UPDATE public.hotel_invites
    SET status = 'accepted',
        accepted_at = now(),
        token = gen_random_uuid()
    WHERE id = v_invite.id
    AND status = 'pending';

    -- 7. Lifecycle & Audit
    SELECT code INTO v_role_code FROM public.hotel_roles WHERE id = v_invite.role_id;
    IF v_role_code = 'OWNER' THEN
        SELECT status INTO v_hotel_status FROM public.hotels WHERE id = v_invite.hotel_id;
        IF v_hotel_status = 'DRAFT' THEN
            UPDATE public.hotels 
            SET status = 'CONFIGURING',
                onboarding_started_at = COALESCE(onboarding_started_at, now())
            WHERE id = v_invite.hotel_id;
            
            INSERT INTO public.hotel_audit_logs (hotel_id, user_id, action, entity_type, entity_id, changes)
            VALUES (v_invite.hotel_id, v_user_id, 'STATUS_CHANGED', 'hotels', v_invite.hotel_id, jsonb_build_object('from', 'DRAFT', 'to', 'CONFIGURING', 'reason', 'First Owner Accepted Invite'));
        END IF;
    END IF;

    INSERT INTO public.hotel_audit_logs (hotel_id, user_id, action, entity_type, entity_id, changes)
    VALUES (v_invite.hotel_id, v_user_id, 'INVITE_ACCEPTED', 'hotel_invites', v_invite.id, jsonb_build_object('email', v_invite.email, 'role_id', v_invite.role_id));

    RETURN jsonb_build_object(
        'success', true,
        'hotel_id', v_invite.hotel_id,
        'membership_id', v_membership_id,
        'role_id', v_invite.role_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_hotel_invite(uuid) TO authenticated;

-- ============================================================
-- 3. Create the Revoke Invitation RPC (Hardened)
-- ============================================================
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

    -- 🔒 Ensure caller is Platform Admin or OWNER, ADMIN, or MANAGER (Prevent lower ranks from revoking)
    IF NOT public.is_platform_admin() AND NOT EXISTS (
        SELECT 1
        FROM public.hotel_members hm
        JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
        JOIN public.hotel_roles hr ON hr.id = hmr.role_id
        WHERE hm.hotel_id = v_invite.hotel_id
        AND hm.user_id = auth.uid()
        AND hr.code IN ('OWNER','ADMIN','MANAGER')
        AND hm.is_active = true
        AND hr.is_active = true
    ) THEN
        RAISE EXCEPTION 'Insufficient permissions for this hotel';
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

    -- Enterprise Audit Log
    INSERT INTO public.hotel_audit_logs (
        hotel_id,
        user_id,
        action,
        entity_type,
        entity_id,
        changes
    )
    VALUES (
        v_invite.hotel_id,
        auth.uid(),
        'INVITE_REVOKED',
        'hotel_invites',
        v_invite.id,
        jsonb_build_object(
            'email', v_invite.email
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'invite_id', v_invite.id,
        'status', 'revoked'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_hotel_invite(uuid) TO authenticated;

-- ============================================================
-- 4. Create the Resend Invitation RPC (Hardened)
-- ============================================================
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

    -- 🔒 Ensure caller is Platform Admin or OWNER, ADMIN, or MANAGER
    IF NOT public.is_platform_admin() AND NOT EXISTS (
        SELECT 1
        FROM public.hotel_members hm
        JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
        JOIN public.hotel_roles hr ON hr.id = hmr.role_id
        WHERE hm.hotel_id = v_invite.hotel_id
        AND hm.user_id = auth.uid()
        AND hr.code IN ('OWNER','ADMIN','MANAGER')
        AND hm.is_active = true
        AND hr.is_active = true
    ) THEN
        RAISE EXCEPTION 'Insufficient permissions for this hotel';
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

    -- Enterprise Audit Log
    INSERT INTO public.hotel_audit_logs (
        hotel_id,
        user_id,
        action,
        entity_type,
        entity_id,
        changes
    )
    VALUES (
        v_invite.hotel_id,
        auth.uid(),
        'INVITE_RESENT',
        'hotel_invites',
        v_invite.id,
        jsonb_build_object(
            'email', v_invite.email,
            'resend_count', v_invite.resend_count
        )
    );

    -- Queue the email notification (Resend)
    INSERT INTO public.notification_queue (
        channel,
        template_code,
        payload
    )
    VALUES (
        'email',
        'staff_invite',
        jsonb_build_object(
            'email', v_invite.email,
            'invite_token', v_invite.token,
            'hotel_id', v_invite.hotel_id,
            'role_id', v_invite.role_id
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'invite_id', v_invite.id,
        'resend_count', v_invite.resend_count,
        'expires_at', v_invite.expires_at
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resend_hotel_invite(uuid) TO authenticated;

-- ============================================================
-- 5. Create the Invite Validation RPC (Lightweight for Frontend)
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_hotel_invite(
    p_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invite RECORD;
BEGIN
    SELECT 
        hi.email,
        hi.status,
        hi.expires_at,
        hi.hotel_id,
        h.name as hotel_name,
        hr.code as role_code,
        hr.name as role_name
    INTO v_invite
    FROM public.hotel_invites hi
    JOIN public.hotels h ON h.id = hi.hotel_id
    JOIN public.hotel_roles hr ON hr.id = hi.role_id
    WHERE hi.token = p_token;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Invite not found');
    END IF;

    IF v_invite.status <> 'pending' THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Invite already used or revoked');
    END IF;

    IF v_invite.expires_at < now() THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Invite has expired');
    END IF;

    RETURN jsonb_build_object(
        'valid', true,
        'email', v_invite.email,
        'hotel_id', v_invite.hotel_id,
        'hotel_name', v_invite.hotel_name,
        'role_code', v_invite.role_code,
        'role_name', v_invite.role_name
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_hotel_invite(uuid) TO anon, authenticated;

-- ============================================================
-- 6. Create RPC to release stale claims (Cron-ready)
-- ============================================================
CREATE OR REPLACE FUNCTION public.release_stale_invite_claims()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.hotel_invites
    SET claimed_by = NULL,
        claimed_at = NULL
    WHERE claimed_at < now() - interval '10 minutes'
    AND status = 'pending';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.release_stale_invite_claims() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_stale_invite_claims() TO service_role;

-- ============================================================
-- 7. Performance Optimization Indexes
-- ============================================================

-- Token lookup (covering index for fast accept validation)
CREATE INDEX IF NOT EXISTS idx_invites_token_lookup
ON public.hotel_invites (token)
INCLUDE (hotel_id, email, role_id, status, expires_at);

-- Pending invites by hotel (for hotel admin screens)
CREATE INDEX IF NOT EXISTS idx_invites_pending
ON public.hotel_invites (hotel_id, created_at DESC)
WHERE status = 'pending';



-- Expiry cleanup (for the cleanup cron job)
CREATE INDEX IF NOT EXISTS idx_invites_expiry_cleanup
ON public.hotel_invites (expires_at)
WHERE status = 'pending';

-- ============================================================
-- 8. Auto-expire Stale Invites (Cron-ready)
-- ============================================================
CREATE OR REPLACE FUNCTION public.expire_stale_invites()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.hotel_invites
    SET status = 'expired'
    WHERE status = 'pending'
    AND expires_at < now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_stale_invites() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_invites() TO service_role;

-- ============================================================
-- 9. Setup Cron Jobs (Postgres pg_cron)
-- ============================================================

-- Ensure pg_cron extension exists (must be run by superuser in prod)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 1. Release stuck claims every 5 minutes
SELECT cron.schedule(
  'release-stuck-invite-claims',
  '*/5 * * * *',
  $$ SELECT public.release_stale_invite_claims(); $$
);

-- 2. Expire old invites every 1 hour
SELECT cron.schedule(
  'expire-stale-invites',
  '0 * * * *',
  $$ SELECT public.expire_stale_invites(); $$
);

COMMIT;


