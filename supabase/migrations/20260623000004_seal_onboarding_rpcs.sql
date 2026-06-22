-- Authorization guards on the two onboarding RPCs missed by the 2026-06-14 sweep
-- (20260614000004 guarded activate_hotel + approve/reject in the same family).
--
-- Both are SECURITY DEFINER and were EXECUTE-granted to anon with no guard.
-- Proven exploitable on local:
--   • create_hotel_onboarding(jsonb)  — anon POST -> HTTP 200, creates a hotel that
--     lands in v_public_hotels (status defaults 'active'). Anon public-directory
--     injection (+ cascades child rows via insert/triggers).
--   • mark_onboarding_step_complete(uuid,step) — anon POST on ANY hotel -> HTTP 204,
--     flips lifecycle_status / is_setup_complete. Cross-tenant tamper.
--
-- Fix mirrors the audited live bodies with only the guard + REVOKE inserted.
-- mark_onboarding_step_complete reuses update_hotel_settings_onboarding's exact
-- 3-branch authorization (platform admin OR active OWNER/ADMIN/MANAGER member OR the
-- HOTEL_CREATED onboarding-creator) so the self-serve creator — who isn't a member
-- yet — stays authorized through every step.
--
-- NOTE the ordering dependency: create_hotel_onboarding PERFORMs
-- mark_onboarding_step_complete internally. The HOTEL_CREATED audit row (which the
-- creator branch keys on) is therefore written BEFORE that internal call, otherwise
-- the guard would reject create's own first step.

-- ════════════════════════════════════════════════════════════════════════
-- create_hotel_onboarding — require an authenticated caller; revoke anon.
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
    -- Authorization: hotel creation requires an authenticated user (the real
    -- /onboard caller always is). Blocks anonymous hotel injection.
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required'
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

    -- 3. Audit BEFORE marking the first step: mark_onboarding_step_complete's
    --    creator branch authorizes via this HOTEL_CREATED row.
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
-- mark_onboarding_step_complete — platform admin OR OWNER/ADMIN/MANAGER member
-- OR the onboarding-creator (HOTEL_CREATED). Revoke anon.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.mark_onboarding_step_complete(p_hotel_id uuid, p_step hotel_onboarding_step)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Authorization (mirrors update_hotel_settings_onboarding): blocks anon and
    -- any caller who is neither admin, a managing member, nor the creator.
    IF NOT (
        public.is_platform_admin()
        OR EXISTS (
            SELECT 1
            FROM public.hotel_members hm
            JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
            JOIN public.hotel_roles hr ON hr.id = hmr.role_id
            WHERE hm.user_id = auth.uid()
              AND hm.hotel_id = p_hotel_id
              AND hr.code IN ('OWNER','ADMIN','MANAGER')
              AND hm.is_active = true
              AND hr.is_active = true
        )
        OR EXISTS (
            SELECT 1
            FROM public.hotel_audit_logs
            WHERE hotel_id = p_hotel_id
              AND user_id = auth.uid()
              AND action = 'HOTEL_CREATED'
        )
    ) THEN
        RAISE EXCEPTION 'Not authorized to update onboarding for this hotel'
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
