-- Migration: Hotel Settings Update RPC (Onboarding Proxy)
-- Date: 2026-03-04
-- Purpose: Safely update hotel fields during the onboarding flow.
-- Since the hotel may not have an OWNER yet (if provisioned by platform), 
-- frontend RLS blocks direct `.update()` calls. This backend RPC proxies the action securely.

BEGIN;

CREATE OR REPLACE FUNCTION public.update_hotel_settings_onboarding(
    p_hotel_id uuid,
    payload jsonb,
    p_action text DEFAULT 'HOTEL_UPDATED'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_has_access boolean;
    v_rowcount integer;
BEGIN
    SET LOCAL statement_timeout = '10s';

    -- Require authentication
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- Protect against empty payload
    IF payload IS NULL OR payload = '{}'::jsonb THEN
        RAISE EXCEPTION 'Payload cannot be empty';
    END IF;

    -- Prevent absurdly large payloads
    IF (SELECT count(*) FROM jsonb_object_keys(payload)) > 50 THEN
        RAISE EXCEPTION 'Payload is too large';
    END IF;

    -- Slug handling moved after row lock

    -- Validate existence and grab row lock in one operation
    PERFORM 1 FROM public.hotels WHERE id = p_hotel_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Hotel not found';
    END IF;


    -- Block restricted fields from being updated directly via this RPC
    IF payload ? 'plan' 
       OR payload ? 'plan_status' 
       OR payload ? 'status' 
       OR payload ? 'lifecycle_status' 
       OR payload ? 'go_live_at' THEN
        RAISE EXCEPTION 'Restricted core lifecycle fields cannot be updated via the onboarding settings RPC';
    END IF;

    -- Security Check: The user must either be:
    -- 1. An active Platform Admin
    -- 2. An active OWNER/ADMIN/MANAGER of the hotel
    -- 3. In the middle of an active onboarding session triggered by them
    
    -- Check Platform Admin
    SELECT EXISTS (
        SELECT 1 FROM public.platform_admins
        WHERE user_id = auth.uid()
        AND is_active = true
    ) INTO v_has_access;

    IF NOT v_has_access THEN
        -- Check Hotel Member
        SELECT EXISTS (
            SELECT 1
            FROM public.hotel_members hm
            JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
            JOIN public.hotel_roles hr ON hr.id = hmr.role_id
            WHERE hm.user_id = auth.uid()
            AND hm.hotel_id = p_hotel_id
            AND hr.code IN ('OWNER','ADMIN','MANAGER')
            AND hm.is_active = true
            AND hr.is_active = true
        ) INTO v_has_access;
    END IF;

    IF NOT v_has_access THEN
        -- Check if they are actively onboarding this specific hotel right now
        -- (They ran step 1, creating progress logs but aren't members yet)
        SELECT EXISTS (
            SELECT 1 
            FROM public.hotel_audit_logs
            WHERE hotel_id = p_hotel_id
            AND user_id = auth.uid()
            AND action = 'HOTEL_CREATED'
        ) INTO v_has_access;
    END IF;

    IF NOT v_has_access THEN
        RAISE EXCEPTION 'Insufficient permissions to update this hotel';
    END IF;

    -- Validate slug format, ensure uniqueness, and normalize
    IF payload ? 'slug' THEN
        -- Safely normalize first to gracefully handle spaces and uppercase from legacy data
        payload := jsonb_set(
            payload,
            '{slug}',
            to_jsonb(lower(trim(payload->>'slug')))
        );

        -- Format validation: only lowercase alphanumerics and hyphens
        IF payload->>'slug' = '' THEN
            RAISE EXCEPTION 'Slug cannot be empty';
        END IF;
        IF payload->>'slug' !~ '^[a-z0-9\-]+$' THEN
            RAISE EXCEPTION 'Invalid slug format';
        END IF;

        -- Ensure slug uniqueness (excluding current hotel)
        IF EXISTS (
            SELECT 1
            FROM public.hotels
            WHERE slug = payload->>'slug'
            AND id <> p_hotel_id
        ) THEN
            RAISE EXCEPTION 'Slug already exists';
        END IF;
    END IF;

    -- Dynamic Update Logic via JSONB
    UPDATE public.hotels
    SET 
        name = COALESCE((payload->>'name'), name),
        slug = CASE WHEN payload ? 'slug' THEN payload->>'slug' ELSE slug END,
        description = COALESCE((payload->>'description'), description),
        phone = COALESCE((payload->>'phone'), phone),
        email = COALESCE((payload->>'email'), email),
        address = COALESCE((payload->>'address'), address),
        city = COALESCE((payload->>'city'), city),
        state = COALESCE((payload->>'state'), state),
        country = COALESCE((payload->>'country'), country),
        postal_code = COALESCE((payload->>'postal_code'), postal_code),
        latitude = CASE WHEN payload ? 'latitude' AND payload->>'latitude' IS NOT NULL THEN (payload->>'latitude')::numeric ELSE latitude END,
        longitude = CASE WHEN payload ? 'longitude' AND payload->>'longitude' IS NOT NULL THEN (payload->>'longitude')::numeric ELSE longitude END,
        legal_name = COALESCE((payload->>'legal_name'), legal_name),
        gst_number = COALESCE((payload->>'gst_number'), gst_number),
        logo_path = COALESCE((payload->>'logo_path'), logo_path),
        cover_image_path = COALESCE((payload->>'cover_image_path'), cover_image_path),
        brand_color = COALESCE((payload->>'brand_color'), brand_color),
        
        default_checkin_time = COALESCE(NULLIF(payload->>'default_checkin_time', '')::time, default_checkin_time),
        default_checkout_time = COALESCE(NULLIF(payload->>'default_checkout_time', '')::time, default_checkout_time),
        timezone = COALESCE((payload->>'timezone'), timezone),
        currency_code = COALESCE((payload->>'currency_code'), currency_code),
        tax_percentage = CASE WHEN payload ? 'tax_percentage' AND payload->>'tax_percentage' IS NOT NULL THEN (payload->>'tax_percentage')::numeric ELSE tax_percentage END,
        service_charge_percentage = CASE WHEN payload ? 'service_charge_percentage' AND payload->>'service_charge_percentage' IS NOT NULL THEN (payload->>'service_charge_percentage')::numeric ELSE service_charge_percentage END,
        invoice_prefix = COALESCE((payload->>'invoice_prefix'), invoice_prefix),
        invoice_counter = CASE WHEN payload ? 'invoice_counter' AND payload->>'invoice_counter' IS NOT NULL THEN (payload->>'invoice_counter')::integer ELSE invoice_counter END,
        upi_id = CASE WHEN payload ? 'upi_id' THEN payload->>'upi_id' ELSE upi_id END,
        booking_url = CASE WHEN payload ? 'booking_url' THEN payload->>'booking_url' ELSE booking_url END,
        amenities = CASE 
            WHEN payload ? 'amenities' AND jsonb_typeof(payload->'amenities') = 'array' 
            THEN ARRAY(SELECT jsonb_array_elements_text(payload->'amenities')) 
            ELSE amenities 
        END,
        early_checkin_allowed = CASE WHEN payload ? 'early_checkin_allowed' THEN (payload->>'early_checkin_allowed')::boolean ELSE early_checkin_allowed END,
        late_checkout_allowed = CASE WHEN payload ? 'late_checkout_allowed' THEN (payload->>'late_checkout_allowed')::boolean ELSE late_checkout_allowed END,
        
        updated_at = now()
    WHERE id = p_hotel_id;

    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount = 0 THEN
        RAISE EXCEPTION 'Hotel update failed or no rows matched';
    END IF;

    -- Audit Log the Update
    INSERT INTO public.hotel_audit_logs (
        hotel_id, user_id, action, entity_type, entity_id, changes, created_at
    )
    VALUES (
        p_hotel_id,
        auth.uid(),
        p_action,
        'hotels',
        p_hotel_id,
        jsonb_build_object('updated_fields', payload),
        now()
    );

    RETURN p_hotel_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_hotel_settings_onboarding(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_hotel_settings_onboarding(uuid, jsonb, text) TO authenticated;

COMMIT;
