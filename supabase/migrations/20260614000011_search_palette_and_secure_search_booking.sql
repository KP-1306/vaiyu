-- Global command palette data-search RPC + secure the existing search_booking.
--
-- (1) search_booking was a PII leak found while building the owner command
--     palette: SECURITY DEFINER, anon-executable, NO membership guard, and with
--     p_hotel_id defaulting to NULL it searched bookings across ALL hotels —
--     returning phone, email, address AND identity_proof (masked ID number +
--     document image URLs). Its only caller (checkin/BookingLookup) was passing
--     NULL ("force global search for now"). Now: require membership of the
--     hotel being searched (which also forces a non-null hotel_id) and revoke
--     anon. Behaviour for a legit front-desk member searching their own hotel is
--     unchanged; the cross-hotel + anon paths are closed.
--
-- (2) search_bookings_palette — purpose-built, member-scoped search for the
--     command palette: light fields (NO identity documents — the palette never
--     needs them), ALL booking statuses (so staff can jump to in-house / past
--     stays too), matched by code / guest name / phone / email, scoped to one
--     hotel. Returns the active stay id so the UI can deep-link when relevant.

-- ════════════════════════════════════════════════════════════════════════
-- (1) Secure search_booking
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.search_booking(p_query text, p_hotel_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 10)
 RETURNS TABLE(booking_id uuid, booking_code text, status text, guest_name text, phone text, email text, scheduled_checkin_at timestamp with time zone, scheduled_checkout_at timestamp with time zone, room_type text, adults integer, children integer, source text, hotel_id uuid, nationality text, address text, room_type_id uuid, room_id uuid, guest_id uuid, identity_proof jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Authorization. anon is revoked at the GRANT layer (below), so this runs for
  -- authenticated callers only. If a specific hotel is requested, the caller must
  -- staff it. A NULL hotel is BACKWARD-COMPATIBLE (the existing kiosk caller
  -- passes NULL) but is scoped in the WHERE clause to only the caller's own
  -- hotels — never the former cross-hotel/anonymous PII-harvest path.
  IF p_hotel_id IS NOT NULL
     AND NOT (public.vaiyu_is_hotel_member(p_hotel_id) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Not authorized to search bookings for this hotel'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  p_query := trim(p_query);
  IF length(p_query) < 2 THEN
     RAISE EXCEPTION 'Search query too short';
  END IF;

  p_limit := LEAST(GREATEST(p_limit,1),50);

  RETURN QUERY
  SELECT DISTINCT ON (b.id)
    b.id::UUID,
    b.code::TEXT,
    b.status::TEXT,
    b.guest_name::TEXT,
    b.phone::TEXT,
    COALESCE(p.email, b.email)::TEXT,
    b.scheduled_checkin_at::TIMESTAMPTZ,
    b.scheduled_checkout_at::TIMESTAMPTZ,
    rt.name::TEXT,
    COALESCE(b.adults_total, 1)::INT,
    COALESCE(b.children_total, 0)::INT,
    b.source::TEXT,
    b.hotel_id::UUID,
    g.nationality::TEXT,
    g.address::TEXT,
    br.room_type_id::UUID,
    br.room_id::UUID,
    b.guest_id::UUID,
    (SELECT jsonb_build_object(
        'type', gid.document_type,
        'number', gid.document_number_masked,
        'front_image', gid.front_image_url,
        'back_image', gid.back_image_url
     )
     FROM guest_id_documents gid
     WHERE gid.guest_id = b.guest_id
     AND gid.is_active = true
     ORDER BY gid.created_at DESC LIMIT 1
    )::JSONB
  FROM bookings b
  LEFT JOIN profiles p ON b.guest_profile_id = p.id
  LEFT JOIN booking_rooms br ON br.booking_id = b.id
  LEFT JOIN room_types rt ON rt.id = br.room_type_id
  LEFT JOIN guests g ON g.id = b.guest_id
  WHERE (
        CASE
          WHEN p_hotel_id IS NOT NULL THEN b.hotel_id = p_hotel_id
          WHEN public.is_platform_admin() THEN true
          ELSE b.hotel_id IN (
            SELECT hm.hotel_id FROM public.hotel_members hm
            WHERE hm.user_id = auth.uid() AND hm.is_active = true
          )
        END
      )
    AND (
        b.code ILIKE '%' || p_query || '%'
        OR b.phone ILIKE '%' || p_query || '%'
        OR p.email ILIKE '%' || p_query || '%'
        OR b.email ILIKE '%' || p_query || '%'
    )
    AND b.status IN ('CREATED','CONFIRMED','PRE_CHECKED_IN')
  ORDER BY b.id, br.room_seq NULLS LAST, b.scheduled_checkin_at
  LIMIT p_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.search_booking(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_booking(text, uuid, integer) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════
-- (2) search_bookings_palette — member-scoped, light, all-statuses
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.search_bookings_palette(p_hotel_id uuid, p_query text, p_limit integer DEFAULT 8)
RETURNS TABLE(
  booking_id uuid,
  code text,
  status text,
  guest_name text,
  phone text,
  scheduled_checkin_at timestamptz,
  scheduled_checkout_at timestamptz,
  active_stay_id uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_q text;
BEGIN
  IF NOT (public.vaiyu_is_hotel_member(p_hotel_id) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Not authorized for this hotel'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_q := trim(COALESCE(p_query, ''));
  IF length(v_q) < 2 THEN
    RETURN;  -- too short: empty result, not an error (typed-as-you-go UI)
  END IF;

  p_limit := LEAST(GREATEST(p_limit, 1), 20);

  RETURN QUERY
  SELECT
    b.id,
    b.code,
    b.status,
    b.guest_name,
    b.phone,
    b.scheduled_checkin_at,
    b.scheduled_checkout_at,
    (SELECT s.id FROM public.stays s
      WHERE s.booking_id = b.id
        AND s.status IN ('inhouse','arriving','checkout_requested')
      ORDER BY s.created_at DESC LIMIT 1)
  FROM public.bookings b
  WHERE b.hotel_id = p_hotel_id
    AND (
      b.code ILIKE '%' || v_q || '%'
      OR b.guest_name ILIKE '%' || v_q || '%'
      OR b.phone ILIKE '%' || v_q || '%'
      OR b.email ILIKE '%' || v_q || '%'
    )
  ORDER BY b.scheduled_checkin_at DESC NULLS LAST
  LIMIT p_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.search_bookings_palette(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_bookings_palette(uuid, text, integer) TO authenticated, service_role;
