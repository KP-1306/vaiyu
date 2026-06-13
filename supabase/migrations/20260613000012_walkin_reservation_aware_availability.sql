-- Reservation-aware walk-in availability + over-commit guard.
--
-- GAP (confirmed in the overbooking audit): walk-in availability counted only
-- active stays (arriving/inhouse). Confirmed advance/OTA reservations are
-- type-level (booking_rooms with room_id NULL until check-in) and create NO stay
-- until check-in, so they were invisible — a walk-in could be placed into a room
-- type already committed to an arriving guest. Data stayed safe (the
-- stays_no_room_overlap exclusion constraint prevents two physical stays per
-- room), but the hotel could OVER-COMMIT a type, surfacing as a check-in failure
-- for the reserved guest.
--
-- Fix:
--   1. get_room_type_availability(hotel, checkin_date, checkout_date) — single
--      source of truth for free inventory per type = total rooms − overlapping
--      active stays − overlapping type-level reservations (reservations whose
--      booking_room has not yet become an active stay, to avoid double-count).
--   2. create_walkin_v3 — thin wrapper that, under a per-(hotel,type) advisory
--      lock (race-safe: concurrent walk-ins serialize), blocks a walk-in that
--      would exceed free inventory unless p_override=true AND the actor is a
--      manager/finance-manager. Then delegates to the untouched create_walkin_v2
--      in the SAME transaction (the xact advisory lock persists through it).
--
-- create_walkin_v2 is deliberately left unchanged (highest-blast-radius RPC).

-- ════════════════════════════════════════════════════════════════════════
-- 1. Availability helper (membership-guarded; counts stays + type reservations)
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_room_type_availability(
    p_hotel_id uuid,
    p_checkin_date date,
    p_checkout_date date
)
RETURNS TABLE(room_type_id uuid, total int, committed int, free int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
    v_tz   text;
    v_ci   time;
    v_co   time;
    v_range tstzrange;
BEGIN
    IF NOT (public.vaiyu_is_hotel_member(p_hotel_id) OR public.is_platform_admin()) THEN
        RAISE EXCEPTION 'Not authorized for this hotel';
    END IF;

    SELECT COALESCE(timezone, 'Asia/Kolkata'),
           COALESCE(default_checkin_time, '14:00:00'::time),
           COALESCE(default_checkout_time, '11:00:00'::time)
      INTO v_tz, v_ci, v_co
      FROM public.hotels WHERE id = p_hotel_id;

    v_range := tstzrange(
        (p_checkin_date::text  || ' ' || v_ci::text)::timestamp AT TIME ZONE v_tz,
        (p_checkout_date::text || ' ' || v_co::text)::timestamp AT TIME ZONE v_tz,
        '[)');

    RETURN QUERY
    WITH types AS (
        -- Total physical rooms of the type (occupancy is subtracted below via
        -- stays). Operational status (vacant/occupied/…) is transient, not an
        -- inventory flag, so it is intentionally not filtered here — matching the
        -- walk-in availability screen's room list.
        SELECT rt.id AS rtid,
               (SELECT count(*) FROM public.rooms r
                 WHERE r.hotel_id = p_hotel_id AND r.room_type_id = rt.id)::int AS total
        FROM public.room_types rt
        WHERE rt.hotel_id = p_hotel_id AND rt.is_active
    ),
    occupied AS (   -- overlapping active stays, by the stay's room type
        SELECT r.room_type_id AS rtid, count(*)::int AS n
        FROM public.stays s
        JOIN public.rooms r ON r.id = s.room_id
        WHERE r.hotel_id = p_hotel_id
          AND s.status IN ('arriving','inhouse')
          AND tstzrange(s.scheduled_checkin_at, s.scheduled_checkout_at, '[)') && v_range
        GROUP BY r.room_type_id
    ),
    reserved AS (   -- overlapping type-level reservations not yet turned into a stay
        SELECT br.room_type_id AS rtid, count(*)::int AS n
        FROM public.booking_rooms br
        JOIN public.bookings b ON b.id = br.booking_id
        WHERE b.hotel_id = p_hotel_id
          AND br.room_type_id IS NOT NULL
          AND upper(b.status) IN ('CONFIRMED','CREATED','PRE_CHECKED_IN','PARTIALLY_CHECKED_IN')
          AND tstzrange(b.scheduled_checkin_at, b.scheduled_checkout_at, '[)') && v_range
          AND NOT EXISTS (
              SELECT 1 FROM public.stays s2
              WHERE s2.booking_room_id = br.id AND s2.status IN ('arriving','inhouse')
          )
        GROUP BY br.room_type_id
    )
    SELECT t.rtid,
           t.total,
           (COALESCE(o.n,0) + COALESCE(rv.n,0)),
           GREATEST(t.total - COALESCE(o.n,0) - COALESCE(rv.n,0), 0)
    FROM types t
    LEFT JOIN occupied o ON o.rtid = t.rtid
    LEFT JOIN reserved rv ON rv.rtid = t.rtid;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.get_room_type_availability(uuid, date, date)
  TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════
-- 2. Walk-in wrapper: reservation-aware over-commit guard + manager override.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_walkin_v3(
    p_hotel_id uuid,
    p_guest_details jsonb,
    p_room_selections jsonb,
    p_checkin_date date,
    p_checkout_date date,
    p_adults integer DEFAULT 1,
    p_children integer DEFAULT 0,
    p_actor_id uuid DEFAULT NULL,
    p_override boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_sel_type uuid;
    v_sel_count int;
    v_free int;
    v_had_conflict boolean := false;
BEGIN
    -- Per-type capacity guard. Lock per (hotel,type) in a stable order (sorted by
    -- type) so concurrent walk-ins serialize without deadlock; the xact lock is
    -- held through the delegated create_walkin_v2 below.
    FOR v_sel_type, v_sel_count IN
        SELECT r.room_type_id, count(*)::int
        FROM jsonb_to_recordset(p_room_selections) AS s(room_id uuid)
        JOIN public.rooms r ON r.id = s.room_id AND r.hotel_id = p_hotel_id
        WHERE r.room_type_id IS NOT NULL
        GROUP BY r.room_type_id
        ORDER BY r.room_type_id
    LOOP
        PERFORM pg_advisory_xact_lock(
            hashtextextended(p_hotel_id::text || ':walkin_type:' || v_sel_type::text, 0));

        SELECT a.free INTO v_free
        FROM public.get_room_type_availability(p_hotel_id, p_checkin_date, p_checkout_date) a
        WHERE a.room_type_id = v_sel_type;
        v_free := COALESCE(v_free, 0);

        IF v_sel_count > v_free THEN
            IF NOT p_override THEN
                RAISE EXCEPTION
                  'reservation_conflict: room type % has only % room(s) free for these dates but % requested',
                  v_sel_type, v_free, v_sel_count
                  USING ERRCODE = 'check_violation';
            END IF;
            v_had_conflict := true;
        END IF;
    END LOOP;

    -- Overriding a real conflict is a deliberate manager action.
    IF v_had_conflict AND NOT public.vaiyu_is_hotel_finance_manager(p_hotel_id) THEN
        RAISE EXCEPTION
          'Overriding a reservation conflict requires a manager or finance-manager role';
    END IF;

    -- Delegate the actual creation (booking + folio + stays + charges) unchanged.
    RETURN public.create_walkin_v2(
        p_hotel_id, p_guest_details, p_room_selections,
        p_checkin_date, p_checkout_date, p_adults, p_children, p_actor_id);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.create_walkin_v3(uuid, jsonb, jsonb, date, date, integer, integer, uuid, boolean)
  TO authenticated, service_role;
