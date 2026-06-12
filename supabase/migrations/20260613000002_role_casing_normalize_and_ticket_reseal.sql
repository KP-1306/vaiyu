-- Role-casing normalization + tickets cross-tenant reseal.
--
-- ROOT CAUSE (confirmed on local, two-hotel matrix):
-- `hotel_members.role` (legacy text) carries inconsistent casing — 'OWNER' (9)
-- vs 'owner' (8) — and is not kept in sync with the M2M source of truth
-- `hotel_member_roles`. Every consumer picked a different source + casing, so
-- members break in different places:
--
--   • tickets policy `supervisors_and_owners_see_all_tickets` (baseline) checks
--     UPPERCASE legacy role AND has NO hotel_id correlation. Two confirmed bugs:
--       - LEAK: a single-hotel 'OWNER' saw 56 tickets across 4 hotels.
--       - OVER-TIGHT: a lowercase 'owner' saw 0 of their own hotel's 50 tickets.
--   • owner-dashboard guard reads M2M only → lowercase-'owner'-no-M2M members
--     (7 of 8 locally) get "Access denied".
--   • client routing (HomeGate/BackHome/Owner/OwnerHome/MarketingHome) compares
--     legacy role to LOWERCASE → uppercase-'OWNER' members aren't treated as owner.
--   • accept_hotel_invite hardcodes legacy 'STAFF' + NULL role_id regardless of
--     invited role → it manufactures the divergence on every new accept.
--
-- This migration normalizes the data + seals the leak + stops the recurrence.
-- Verified-safe to lowercase the column: the only DB consumers of the legacy
-- role are vaiyu_is_hotel_finance_manager (checks BOTH cases), is_hotel_owner
-- (lowercase, unused by any policy), and the tickets policy replaced below.
-- All client comparisons are lowercase, so lowercasing fixes routing.

-- ════════════════════════════════════════════════════════════════════════
-- 1. Shared mapping: role code → coarse legacy routing tier.
--    Single source of truth for both the backfill and accept_hotel_invite, so
--    the legacy column and the M2M role can never silently disagree again.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.role_code_to_legacy_tier(p_code text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN upper(coalesce(p_code, '')) IN ('OWNER', 'OWNER_0', 'HOTEL_OWNER')        THEN 'owner'
    WHEN upper(coalesce(p_code, '')) IN ('MANAGER', 'GENERAL_MANAGER', 'OPS_MANAGER',
                                          'ADMIN', 'ADMINISTRATOR')                THEN 'manager'
    ELSE 'staff'
  END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 2. Normalize existing legacy role to lowercase (fixes client routing for the
--    uppercase-'OWNER' members). Touches only rows that differ; idempotent.
-- ════════════════════════════════════════════════════════════════════════
UPDATE public.hotel_members
SET role = lower(role)
WHERE role IS NOT NULL AND role <> lower(role);

-- ════════════════════════════════════════════════════════════════════════
-- 3. TICKETS reseal — hotel-scoped, case-insensitive, M2M + legacy aware.
--    Owner + supervisor + manager tier see the whole board (user-approved).
--    SECURITY DEFINER → bypasses the self-only RLS on hotel_members and the
--    member-scoped RLS on hotel_roles/hotel_member_roles (no nested-RLS trap).
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.vaiyu_can_view_all_hotel_tickets(p_hotel_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM public.hotel_members hm
      LEFT JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
      LEFT JOIN public.hotel_roles hr         ON hr.id = hmr.role_id
      WHERE hm.user_id   = auth.uid()
        AND hm.hotel_id  = p_hotel_id
        AND hm.is_active = true
        AND (
          -- M2M source of truth (preferred)
          upper(coalesce(hr.code, '')) IN (
            'OWNER', 'OWNER_0', 'HOTEL_OWNER',
            'SUPERVISOR',
            'MANAGER', 'GENERAL_MANAGER', 'OPS_MANAGER',
            'ADMIN', 'ADMINISTRATOR'
          )
          -- Legacy text-role fallback (case-insensitive)
          OR upper(coalesce(hm.role, '')) IN (
            'OWNER', 'OWNER_0', 'HOTEL_OWNER',
            'SUPERVISOR',
            'MANAGER', 'GENERAL_MANAGER', 'OPS_MANAGER',
            'ADMIN', 'ADMINISTRATOR'
          )
        )
    );
$$;
GRANT EXECUTE ON FUNCTION public.vaiyu_can_view_all_hotel_tickets(uuid)
  TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "supervisors_and_owners_see_all_tickets" ON public.tickets;
CREATE POLICY "supervisors_and_owners_see_all_tickets"
  ON public.tickets FOR SELECT TO authenticated
  USING (public.vaiyu_can_view_all_hotel_tickets(tickets.hotel_id));

-- ════════════════════════════════════════════════════════════════════════
-- 4. accept_hotel_invite — write the correct legacy tier + role_id + M2M, and
--    reactivate/normalize on re-accept. Stops the divergence at its source.
--    (Full replace of the baseline definition; signature unchanged.)
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.accept_hotel_invite(p_token uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_invite RECORD;
    v_user_id uuid;
    v_user_email text;
    v_membership_id uuid;
    v_role_code text;
    v_legacy_tier text;
    v_hotel_status public.hotel_lifecycle_status;
    v_full_name text;
BEGIN
    -- 1. Require authentication & fetch user info STRICT
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT u.email INTO STRICT v_user_email
    FROM auth.users u
    WHERE u.id = v_user_id;

    -- 2. Lock invite row FIRST (atomic lock)
    SELECT *
    INTO v_invite
    FROM public.hotel_invites
    WHERE token = p_token
    FOR UPDATE;

    -- 3. Handle already-accepted / membership case
    IF NOT FOUND THEN
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

    -- 4. Validation layer
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

    -- Enforce claim (anti-race & anti-forwarding)
    IF v_invite.claimed_by IS NULL THEN
        RAISE EXCEPTION 'This invite session has expired. Please open the invite link again.';
    END IF;

    IF v_invite.claimed_by <> v_user_id THEN
        IF lower(v_invite.email) <> lower(v_user_email) THEN
            RAISE EXCEPTION 'This invitation was sent to %. Please sign in using that email address to continue.', v_invite.email;
        END IF;
    END IF;

    IF lower(v_invite.email) <> lower(v_user_email) THEN
        RAISE EXCEPTION 'This invite is not assigned to your email';
    END IF;

    -- 5. Extract full name from metadata & update profile
    v_full_name := v_invite.invite_metadata->>'full_name';
    IF v_full_name IS NOT NULL AND v_full_name <> '' THEN
        UPDATE public.profiles
        SET full_name = COALESCE(full_name, v_full_name),
            updated_at = now()
        WHERE id = v_user_id
        AND (full_name IS NULL OR full_name = '');
    END IF;

    -- 5b. Resolve the invited role's code -> legacy routing tier (single source
    --     of mapping truth). Both legacy column and M2M are written from this.
    SELECT code INTO v_role_code FROM public.hotel_roles WHERE id = v_invite.role_id;
    v_legacy_tier := public.role_code_to_legacy_tier(v_role_code);

    -- 6. Core transaction: create membership and assign role (legacy + M2M)
    BEGIN
        INSERT INTO public.hotel_members (
            hotel_id, user_id, role, role_id, status, is_active, created_at
        )
        VALUES (
            v_invite.hotel_id, v_user_id, v_legacy_tier, v_invite.role_id, 'active', true, now()
        )
        RETURNING id INTO v_membership_id;

        INSERT INTO public.hotel_member_roles (hotel_member_id, role_id)
        VALUES (v_membership_id, v_invite.role_id);

    EXCEPTION
        WHEN unique_violation THEN
            -- Pre-existing membership: reactivate + normalize legacy role/role_id,
            -- then ensure the invited M2M role is linked.
            UPDATE public.hotel_members
               SET is_active = true,
                   status    = 'active',
                   role      = v_legacy_tier,
                   role_id   = v_invite.role_id
             WHERE hotel_id = v_invite.hotel_id AND user_id = v_user_id
            RETURNING id INTO v_membership_id;

            INSERT INTO public.hotel_member_roles (hotel_member_id, role_id)
            VALUES (v_membership_id, v_invite.role_id) ON CONFLICT DO NOTHING;
    END;

    -- 7. Mark invite accepted (replay protection)
    UPDATE public.hotel_invites
    SET status = 'accepted',
        accepted_at = now(),
        token = gen_random_uuid()
    WHERE id = v_invite.id
    AND status = 'pending';

    -- 8. Lifecycle & audit
    IF v_role_code = 'OWNER' THEN
        SELECT lifecycle_status INTO v_hotel_status FROM public.hotels WHERE id = v_invite.hotel_id;
        IF v_hotel_status = 'DRAFT' THEN
            UPDATE public.hotels
            SET lifecycle_status = 'CONFIGURING',
                status = 'active',
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

-- ════════════════════════════════════════════════════════════════════════
-- 5a. Some hotels have active legacy-'owner' members but NO owner-tier role
--     defined at all (incomplete onboarding data) — so the M2M source of truth
--     can never be completed for them and they'd also fail the kitchen RPCs'
--     M2M-only owner check. Create the canonical 'OWNER' role for those hotels
--     so the backfill below can attach it. UNIQUE(hotel_id, code) → idempotent.
-- ════════════════════════════════════════════════════════════════════════
INSERT INTO public.hotel_roles (hotel_id, code, name, is_active)
SELECT DISTINCT hm.hotel_id, 'OWNER', 'Owner', true
FROM public.hotel_members hm
WHERE hm.is_active = true
  AND lower(hm.role) = 'owner'
  AND NOT EXISTS (
    SELECT 1 FROM public.hotel_member_roles x WHERE x.hotel_member_id = hm.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.hotel_roles r
    WHERE r.hotel_id = hm.hotel_id AND upper(r.code) IN ('OWNER', 'OWNER_0', 'HOTEL_OWNER')
  )
ON CONFLICT (hotel_id, code) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════
-- 5b. Backfill the M2M source of truth for the locked-out OWNERS: active
--     legacy-'owner' members with NO M2M role row, attaching their hotel's
--     owner role (now guaranteed to exist after 5a). Idempotent.
-- ════════════════════════════════════════════════════════════════════════
INSERT INTO public.hotel_member_roles (hotel_member_id, role_id)
SELECT hm.id, hr.id
FROM public.hotel_members hm
JOIN LATERAL (
    SELECT r.id
    FROM public.hotel_roles r
    WHERE r.hotel_id = hm.hotel_id
      AND upper(r.code) IN ('OWNER', 'OWNER_0', 'HOTEL_OWNER')
    ORDER BY (upper(r.code) <> 'OWNER')   -- prefer the exact 'OWNER' code
    LIMIT 1
) hr ON true
WHERE hm.is_active = true
  AND lower(hm.role) = 'owner'
  AND NOT EXISTS (
    SELECT 1 FROM public.hotel_member_roles x WHERE x.hotel_member_id = hm.id
  )
ON CONFLICT DO NOTHING;
