-- Tighten the onboarding RPCs to platform-admin only.
--
-- Onboarding is a VAiyu-operated flow (the platform onboards the hotel and adds the
-- owner during it — the owner is not yet a member and never runs /onboard). So both
-- create + mark should require a platform admin, superseding the looser guards from
-- 20260623000004 (create: any authenticated; mark: admin/member/creator). The route
-- itself is also moved behind PlatformAdminGate in the frontend.
--
-- Both operator accounts (ajitkumarpes@, kbisht786@) are active platform_admins, so
-- this does not lock the operators out. Grants stay to authenticated+service_role
-- because PostgREST invokes RPCs as the authenticated role; is_platform_admin() does
-- the real enforcement (same pattern as approve_owner_application).

-- ════════════════════════════════════════════════════════════════════════
-- create_hotel_onboarding — platform admin only.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_hotel_onboarding(payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    new_hotel_id uuid;
    owner_role_id uuid;
    owner_member_id uuid;
    v_owner_user_id uuid;
BEGIN
    -- Authorization: onboarding is platform-staff operated.
    IF NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Not authorized: platform admin required'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF payload->>'name' IS NULL OR payload->>'slug' IS NULL THEN
        RAISE EXCEPTION 'Hotel name and slug are required';
    END IF;

    v_owner_user_id := (payload->>'owner_user_id')::uuid;

    -- 1. Insert Hotel Core
    INSERT INTO public.hotels (
        name, slug, description, phone, email, address,
        city, state, country, postal_code,
        latitude, longitude, legal_name, gst_number,
        logo_path, cover_image_path, brand_color,
        onboarding_started_at
    )
    VALUES (
        payload->>'name',
        payload->>'slug',
        payload->>'description',
        payload->>'phone',
        payload->>'email',
        payload->>'address',
        payload->>'city',
        payload->>'state',
        payload->>'country',
        payload->>'postal_code',
        (payload->>'latitude')::numeric,
        (payload->>'longitude')::numeric,
        payload->>'legal_name',
        payload->>'gst_number',
        payload->>'logo_path',
        payload->>'cover_image_path',
        payload->>'brand_color',
        now()
    )
    RETURNING id INTO new_hotel_id;

    -- 2. Insert Guest Info Extensions from Onboarding Step 1
    INSERT INTO public.hotel_guest_info (
        hotel_id,
        wifi_ssid,
        wifi_password,
        breakfast_start,
        breakfast_end,
        notes
    )
    VALUES (
        new_hotel_id,
        payload->>'wifi_ssid',
        payload->>'wifi_password',
        CAST(NULLIF(payload->>'breakfast_start', '') AS time),
        CAST(NULLIF(payload->>'breakfast_end', '') AS time),
        payload->>'guest_notes'
    );

    -- 3. Audit (kept before the mark call for ordering parity with prior version)
    INSERT INTO public.hotel_audit_logs (
        hotel_id, user_id, action, entity_type, entity_id, changes, created_at
    )
    VALUES (
        new_hotel_id,
        auth.uid(),
        'HOTEL_CREATED',
        'hotels',
        new_hotel_id,
        jsonb_build_object(
            'name', payload->>'name',
            'slug', payload->>'slug',
            'owner_user_id', v_owner_user_id,
            'wifi_ssid', payload->>'wifi_ssid'
        ),
        now()
    );

    PERFORM public.mark_onboarding_step_complete(
        new_hotel_id,
        'hotel_details'
    );

    RETURN new_hotel_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_hotel_onboarding(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_hotel_onboarding(jsonb) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════
-- mark_onboarding_step_complete — platform admin only.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.mark_onboarding_step_complete(p_hotel_id uuid, p_step hotel_onboarding_step)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Authorization: onboarding is platform-staff operated (also covers create's
    -- internal call, which runs as the platform-admin operator).
    IF NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Not authorized: platform admin required'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    PERFORM 1 FROM public.hotels
    WHERE id = p_hotel_id
    FOR UPDATE;

    INSERT INTO public.hotel_onboarding_progress (
        hotel_id,
        step_name,
        completed_by
    )
    VALUES (
        p_hotel_id,
        p_step,
        auth.uid()
    )
    ON CONFLICT (hotel_id, step_name)
    DO UPDATE SET completed_at = now();

    UPDATE public.hotels
    SET lifecycle_status = 'CONFIGURING',
        onboarding_started_at = COALESCE(onboarding_started_at, now()),
        onboarding_due_at = COALESCE(onboarding_due_at, now() + (onboarding_sla_days || ' days')::interval)
    WHERE id = p_hotel_id
      AND lifecycle_status = 'DRAFT';

    IF public.are_required_onboarding_steps_complete(p_hotel_id) THEN
        UPDATE public.hotels
        SET lifecycle_status = 'READY_FOR_REVIEW',
            is_setup_complete = true
        WHERE id = p_hotel_id;
    END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_onboarding_step_complete(uuid, hotel_onboarding_step) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_onboarding_step_complete(uuid, hotel_onboarding_step) TO authenticated, service_role;
