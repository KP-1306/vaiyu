CREATE OR REPLACE FUNCTION lookup_guest_profile(
    p_hotel_id UUID,
    p_mobile TEXT,
    p_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_phone TEXT;
    v_guest RECORD;
BEGIN
    -- Normalize phone
    v_clean_phone := regexp_replace(p_mobile, '[^0-9]', '', 'g');

    -- Handle India country code (91XXXXXXXXXX -> XXXXXXXXXX)
    IF length(v_clean_phone) = 12 AND left(v_clean_phone,2) = '91' THEN
        v_clean_phone := right(v_clean_phone,10);
    END IF;

    -------------------------------------------------
    -- Stage 1 : Mobile lookup (strong identity)
    -------------------------------------------------
    IF length(v_clean_phone) = 10 THEN
        SELECT * INTO v_guest
        FROM guests
        WHERE hotel_id = p_hotel_id
        AND mobile_normalized = v_clean_phone
        ORDER BY created_at DESC
        LIMIT 1;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'found', true,
                'match_type', 'mobile',
                'guest', jsonb_build_object(
                    'id', v_guest.id,
                    'full_name', v_guest.full_name,
                    'email', v_guest.email,
                    'mobile', v_guest.mobile,
                    'nationality', v_guest.nationality,
                    'address', v_guest.address
                )
            );
        END IF;
    END IF;

    -------------------------------------------------
    -- Stage 2 : Email fallback
    -------------------------------------------------
    IF COALESCE(trim(p_email),'') <> '' THEN
        SELECT * INTO v_guest
        FROM guests
        WHERE hotel_id = p_hotel_id
        AND lower(email) = lower(trim(p_email))
        ORDER BY created_at DESC
        LIMIT 1;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'found', true,
                'match_type', 'email',
                'guest', jsonb_build_object(
                    'id', v_guest.id,
                    'full_name', v_guest.full_name,
                    'email', v_guest.email,
                    'mobile', v_guest.mobile,
                    'nationality', v_guest.nationality,
                    'address', v_guest.address
                )
            );
        END IF;
    END IF;

    RETURN jsonb_build_object('found', false);
END;
$$;

GRANT EXECUTE ON FUNCTION lookup_guest_profile(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION lookup_guest_profile(UUID, TEXT, TEXT) TO anon;
ALTER FUNCTION lookup_guest_profile(UUID, TEXT, TEXT) OWNER TO postgres;
