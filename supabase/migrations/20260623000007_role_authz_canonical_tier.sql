-- Canonicalize role-management authorization: recognize a manager/owner by TIER,
-- not by an incomplete hardcoded code list.
--
-- The repo already has the single source of truth role_code_to_legacy_tier(code)
-- (20260613000002): owner ← OWNER/OWNER_0/HOTEL_OWNER; manager ← MANAGER/
-- GENERAL_MANAGER/OPS_MANAGER/ADMIN/ADMINISTRATOR; else staff (incl. departmental
-- HOUSEKEEPING_MANAGER / KITCHEN_MANAGER). But the authz gates hardcode
-- `hr.code IN ('OWNER','ADMIN','MANAGER')`, which silently denies management-tier
-- roles whose code isn't in that triplet.
--
-- Live impact (prod): members assigned ADMINISTRATOR and GENERAL_MANAGER currently
-- can't invite staff / manage rooms; 20260623000006 also locked them out of
-- hotel_roles / hotel_member_roles writes (vaiyu_is_hotel_manager used the same
-- narrow list). This routes the role/staff/room-management gates through the tier
-- mapper so those members regain intended access.
--
-- NO FUNCTIONALITY IMPACTED: {OWNER,ADMIN,MANAGER} ⊂ the tier set, so this is
-- strictly additive for existing canonical managers; departmental *_MANAGER codes
-- map to 'staff' and are NOT elevated; platform-admin branch retained; the only
-- access removal in play is the already-shipped escalation fix (non-managers can't
-- WRITE hotel_roles/hotel_member_roles). OWNER_0 is no longer hardcoded anywhere —
-- it stays harmlessly inside role_code_to_legacy_tier (vestigial: 0 rows).
--
-- Kitchen RPCs use a different intentional list (incl. KITCHEN_MANAGER) and are
-- untouched; remaining baseline triplet sites are a separate audited sweep.

-- ════════════════════════════════════════════════════════════════════════
-- 1. vaiyu_is_hotel_manager → tier-based (fixes hotel_roles + hotel_member_roles)
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.vaiyu_is_hotel_manager(p_hotel_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    -- M2M role, classified by the canonical tier mapper.
    SELECT 1
    FROM public.hotel_members hm
    JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
    JOIN public.hotel_roles hr ON hr.id = hmr.role_id
    WHERE hm.hotel_id = p_hotel_id
      AND hm.user_id = auth.uid()
      AND hm.is_active = true
      AND hr.is_active = true
      AND public.role_code_to_legacy_tier(hr.code) IN ('owner','manager')
  )
  OR EXISTS (
    -- Legacy hotel_members.role fallback, same tier mapper (column unused today).
    SELECT 1
    FROM public.hotel_members hm
    WHERE hm.hotel_id = p_hotel_id
      AND hm.user_id = auth.uid()
      AND hm.is_active = true
      AND public.role_code_to_legacy_tier(hm.role) IN ('owner','manager')
  );
$function$;

REVOKE ALL ON FUNCTION public.vaiyu_is_hotel_manager(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vaiyu_is_hotel_manager(uuid) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════
-- 2. create_hotel_invite — same body, permission check via the helper.
--    (Mirrors the live body verbatim; ONLY the OWNER/ADMIN/MANAGER EXISTS is
--    swapped for vaiyu_is_hotel_manager.)
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_hotel_invite(p_hotel_id uuid, p_email text, p_role_id uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- Permission check: platform admin OR a hotel manager/owner (by canonical tier).
    IF NOT public.is_platform_admin() AND NOT public.vaiyu_is_hotel_manager(p_hotel_id) THEN
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
$function$;

-- ════════════════════════════════════════════════════════════════════════
-- 3. room_types + rooms "Staff can manage" → manager-by-tier via the helper.
--    (Strictly additive vs the live triplet policy; SELECT policies untouched.)
-- ════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Staff can manage room types" ON public.room_types;
CREATE POLICY "Staff can manage room types" ON public.room_types
  FOR ALL
  USING (public.is_platform_admin() OR public.vaiyu_is_hotel_manager(hotel_id))
  WITH CHECK (public.is_platform_admin() OR public.vaiyu_is_hotel_manager(hotel_id));

DROP POLICY IF EXISTS "Staff can manage rooms" ON public.rooms;
CREATE POLICY "Staff can manage rooms" ON public.rooms
  FOR ALL
  USING (public.is_platform_admin() OR public.vaiyu_is_hotel_manager(hotel_id))
  WITH CHECK (public.is_platform_admin() OR public.vaiyu_is_hotel_manager(hotel_id));
