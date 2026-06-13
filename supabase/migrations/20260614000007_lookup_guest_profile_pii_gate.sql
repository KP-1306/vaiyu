-- Close the lookup_guest_profile PII-enumeration leak (auth sweep follow-up — 2026-06-14).
--
-- lookup_guest_profile is SECURITY DEFINER and anon-callable, and returned full
-- guest PII (full_name, email, mobile, nationality, ADDRESS) for any phone/email.
-- `guests` is a GLOBAL identity table (unique on mobile_normalized / email across
-- all hotels — there is NO hotel_id column; upsert_guest_v2 dedups globally), so
-- the leak is not cross-tenant scoping — it is that an ANONYMOUS caller could
-- harvest any person's PII by guessing/harvesting phone numbers.
--
-- Callers (verified):
--   • WalkInDetails.tsx, GuestKYC.tsx — front-desk STAFF (authenticated members)
--     pre-filling a guest at check-in → legitimately authorized.
--   • PreCheckin.tsx — the GUEST pre-checkin form (anon). Its own details are
--     pre-filled from the booking via the precheckin token (validatePrecheckinToken),
--     NOT from this lookup; the lookup is only a cross-guest "type any phone →
--     autofill" convenience — exactly the leak vector, and redundant for the
--     legitimate case.
--
-- Fix: disclose PII only to an authenticated member of the hotel performing the
-- lookup (or a platform admin). Anonymous / non-member callers get {found:false}
-- — no PII and no found/not-found signal (no enumeration). The anon EXECUTE grant
-- is intentionally KEPT so the guest pre-checkin flow degrades gracefully (a
-- silent "no autofill" rather than a permission error); the body guard is the
-- control. Zero legitimate UX loss: the guest still gets booking-based pre-fill.

CREATE OR REPLACE FUNCTION public.lookup_guest_profile(p_hotel_id uuid, p_mobile text, p_email text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_clean_phone TEXT;
    v_guest RECORD;
BEGIN
    -- Authorization gate: PII only for staff of the hotel doing the lookup, or a
    -- platform admin. Everyone else (anon / non-member, incl. the guest form)
    -- gets a blank, enumeration-safe result.
    IF NOT (public.vaiyu_is_hotel_member(p_hotel_id) OR public.is_platform_admin()) THEN
        RETURN jsonb_build_object('found', false);
    END IF;

    -- Normalize phone
    v_clean_phone := regexp_replace(p_mobile, '[^0-9]', '', 'g');

    -- Handle India country code (91XXXXXXXXXX -> XXXXXXXXXX)
    IF length(v_clean_phone) = 12 AND left(v_clean_phone,2) = '91' THEN
        v_clean_phone := right(v_clean_phone,10);
    END IF;

    -------------------------------------------------
    -- Stage 1 : Mobile lookup (strong identity)
    -- guests is a global identity table; access is gated above by hotel-staff
    -- membership, so the lookup itself is intentionally global (chain-wide).
    -------------------------------------------------
    IF length(v_clean_phone) = 10 THEN
        SELECT * INTO v_guest
        FROM guests
        WHERE mobile_normalized = v_clean_phone
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
        WHERE lower(email) = lower(trim(p_email))
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
$function$;
