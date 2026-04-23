-- ============================================================
-- RPC: Get Full Hotel Onboarding State
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_hotel_onboarding_state(p_hotel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_has_access boolean;
    v_result jsonb;
BEGIN
    -- Verify caller is authenticated
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- Security Check: The user must either be:
    -- 1. An active Platform Admin
    -- 2. An active member of the hotel
    -- 3. The creator in onboarding phase
    
    SELECT EXISTS (
        SELECT 1 FROM public.platform_admins pa
        WHERE pa.user_id = auth.uid()
        AND pa.is_active = true
    ) INTO v_has_access;

    IF NOT v_has_access THEN
        SELECT EXISTS (
            SELECT 1 FROM public.hotel_members hm
            WHERE hm.hotel_id = p_hotel_id 
            AND hm.user_id = auth.uid()
            AND hm.is_active = true
            AND hm.status = 'active'
        ) INTO v_has_access;
    END IF;

    IF NOT v_has_access THEN
        SELECT EXISTS (
            SELECT 1 FROM public.hotel_audit_logs
            WHERE hotel_id = p_hotel_id
            AND user_id = auth.uid()
            AND action = 'HOTEL_CREATED'
        ) INTO v_has_access;
    END IF;

    IF NOT v_has_access THEN
        RAISE EXCEPTION 'Insufficient permissions to view this hotel state';
    END IF;

    -- Validate existence to prevent returning null hotels
    PERFORM 1 FROM public.hotels WHERE id = p_hotel_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Hotel not found';
    END IF;

    -- Aggregate State
    SELECT jsonb_build_object(
        'hotel', (SELECT to_jsonb(h) FROM public.hotels h WHERE h.id = p_hotel_id),
        'room_types', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', rt.id,
                'name', rt.name,
                'base_occupancy', rt.base_occupancy,
                'max_occupancy', rt.max_occupancy
            )) 
            FROM public.room_types rt 
            WHERE rt.hotel_id = p_hotel_id
        ), '[]'::jsonb),
        'rooms', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', r.id,
                'room_type_id', r.room_type_id,
                'number', r.number,
                'floor', r.floor,
                'wing', r.wing,
                'status', r.status,
                'is_out_of_order', r.is_out_of_order
            )) 
            FROM public.rooms r 
            WHERE r.hotel_id = p_hotel_id
        ), '[]'::jsonb),
        'roles', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', hr.id,
                'name', hr.name,
                'description', hr.description
            )) 
            FROM public.hotel_roles hr 
            WHERE hr.hotel_id = p_hotel_id
        ), '[]'::jsonb),
        'invites', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', hi.id,
                'email', hi.email,
                'invite_metadata', hi.invite_metadata,
                'role_name', hr.name
            )) 
            FROM public.hotel_invites hi 
            LEFT JOIN public.hotel_roles hr ON hr.id = hi.role_id
            WHERE hi.hotel_id = p_hotel_id
        ), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_hotel_onboarding_state(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_hotel_onboarding_state(uuid) FROM anon;
