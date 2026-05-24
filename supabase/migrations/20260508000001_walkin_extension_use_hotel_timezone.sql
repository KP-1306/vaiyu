-- 20260508000001_walkin_extension_use_hotel_timezone.sql
--
-- Fix: scheduled_checkin_at / scheduled_checkout_at were being constructed by
-- concatenating a hardcoded "14:00:00" / "11:00:00" with the date and casting
-- to timestamptz. Without an explicit timezone, Postgres uses the session's
-- TimeZone (UTC in Supabase), so the literal "11:00:00" landed as 11:00 UTC
-- (= 16:30 IST), not 11:00 IST. Symptom: "Overdue · 4h late" instead of the
-- correct ~10h for a guest scheduled to leave at noon IST.
--
-- This migration:
--   1. Reads the hotel's `timezone` and `default_checkin_time` /
--      `default_checkout_time` (all already on `hotels`, no schema change).
--   2. Constructs timestamps as `(date || ' ' || time)::timestamp AT TIME ZONE tz`
--      — Postgres applies the IANA rules (incl. DST for non-IST zones).
--   3. COALESCEs to `Asia/Kolkata` / `14:00` / `11:00` for safety on hotels
--      where the columns are somehow NULL.
--
-- Touches two RPCs that share the same bug:
--   • create_walkin_v2 (walk-in checkin + checkout)
--   • request_stay_extension (extension requested checkout)
--
-- Body of each function is preserved verbatim except for the timestamp lines
-- and the addition of a hotel-config lookup. Local-only — prod has older
-- function versions and will be brought current as a separate deployment.

CREATE OR REPLACE FUNCTION public.create_walkin_v2(p_hotel_id uuid, p_guest_details jsonb, p_room_selections jsonb, p_checkin_date date, p_checkout_date date, p_adults integer DEFAULT 1, p_children integer DEFAULT 0, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_guest_id UUID;
  v_booking_id UUID;
  v_booking_room_id UUID;
  v_stay_id UUID;
  v_booking_code TEXT;
  v_checkin_ts TIMESTAMPTZ;
  v_checkout_ts TIMESTAMPTZ;
  v_room_id UUID;
  v_room_type_id UUID;
  v_amount_per_night NUMERIC(12,2);
  v_discount_per_night NUMERIC(12,2);
  v_discount_reason TEXT;
  v_discount_note TEXT;
  v_gross_total NUMERIC(12,2);
  v_discount_total NUMERIC(12,2);
  v_net_total NUMERIC(12,2);
  v_nights INT;
  v_stay_ids UUID[] := '{}';
  v_rooms_count INT;
  v_first_room_id UUID;
  v_first_room_type_id UUID;
  v_folio_id UUID;
  v_room_charge_id UUID;
  v_adjustment_id UUID;
  v_can_discount BOOLEAN := FALSE;
  v_any_discount BOOLEAN := FALSE;
  v_max_discount_pct INT;
  v_discount_pct NUMERIC(5,2);
  v_tax_pct NUMERIC(5,2);
  v_tax_inclusive BOOLEAN;
  v_tax_amount NUMERIC(12,2);
  v_actor_member_id UUID;
  v_hotel_tz TEXT;                  -- NEW: hotel's IANA timezone
  v_hotel_checkin_time TIME;        -- NEW: hotel's standard checkin time
  v_hotel_checkout_time TIME;       -- NEW: hotel's standard checkout time
BEGIN
  IF p_room_selections IS NULL OR jsonb_array_length(p_room_selections) = 0 THEN
    RAISE EXCEPTION 'At least one room selection is required';
  END IF;
  v_rooms_count := jsonb_array_length(p_room_selections);

  IF coalesce(trim(p_guest_details->>'full_name'),'') = '' THEN
    RAISE EXCEPTION 'Guest name required';
  END IF;

  IF p_actor_id IS NOT NULL THEN
    SELECT id
      INTO v_actor_member_id
      FROM public.hotel_members
     WHERE user_id = p_actor_id
       AND hotel_id = p_hotel_id
     LIMIT 1;
  END IF;

  -- CHANGED: also fetch timezone + default checkin/checkout times alongside
  -- tax config — single hotels lookup for everything we need.
  SELECT COALESCE(tax_percentage, 12),
         COALESCE(tax_inclusive, false),
         COALESCE(timezone, 'Asia/Kolkata'),
         COALESCE(default_checkin_time, '14:00:00'::time),
         COALESCE(default_checkout_time, '11:00:00'::time)
    INTO v_tax_pct, v_tax_inclusive,
         v_hotel_tz, v_hotel_checkin_time, v_hotel_checkout_time
    FROM public.hotels
   WHERE id = p_hotel_id;

  SELECT BOOL_OR(COALESCE((sel->>'discount_per_night')::NUMERIC, 0) > 0)
  INTO v_any_discount
  FROM jsonb_array_elements(p_room_selections) AS sel;

  IF v_any_discount THEN
    SELECT public.vaiyu_is_hotel_finance_manager(p_hotel_id) INTO v_can_discount;
    IF v_can_discount IS NOT TRUE THEN
      RAISE EXCEPTION 'Discount requires a manager or finance-manager role for this hotel';
    END IF;

    SELECT max_discount_pct INTO v_max_discount_pct
      FROM public.pricing_settings WHERE hotel_id = p_hotel_id;
  END IF;

  -- CHANGED: timestamps now constructed in the hotel's timezone, not UTC.
  IF p_checkin_date = CURRENT_DATE THEN
    v_checkin_ts := now();
  ELSE
    v_checkin_ts := ((p_checkin_date::text || ' ' || v_hotel_checkin_time::text)::timestamp
                     AT TIME ZONE v_hotel_tz);
  END IF;
  v_checkout_ts := ((p_checkout_date::text || ' ' || v_hotel_checkout_time::text)::timestamp
                    AT TIME ZONE v_hotel_tz);

  IF v_checkout_ts <= v_checkin_ts THEN
    RAISE EXCEPTION 'Checkout must be after checkin';
  END IF;
  v_nights := GREATEST(1, (p_checkout_date - p_checkin_date));

  IF (
    SELECT COUNT(DISTINCT room_id)
    FROM jsonb_to_recordset(p_room_selections) AS r(room_id UUID)
  ) != v_rooms_count THEN
    RAISE EXCEPTION 'Duplicate rooms selected';
  END IF;

  SELECT room_id, room_type_id
  INTO v_first_room_id, v_first_room_type_id
  FROM jsonb_to_recordset(p_room_selections) AS r(room_id UUID, room_type_id UUID)
  LIMIT 1;

  SELECT room_type_id
  INTO v_first_room_type_id
  FROM rooms
  WHERE id = v_first_room_id
  AND hotel_id = p_hotel_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid room % or does not belong to hotel', v_first_room_id;
  END IF;

  v_guest_id := public.upsert_guest_v2(p_guest_details);

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_hotel_id::text || ':' || v_guest_id::text, 0)
  );

  v_booking_code := 'W-' || to_char(now(), 'YYMMDDHH24MISS') || '-' || substring(gen_random_uuid()::text, 1, 4);

  INSERT INTO bookings (
    hotel_id, guest_id, guest_name, phone, email,
    status, source, code,
    scheduled_checkin_at, scheduled_checkout_at,
    adults, children, adults_total, children_total,
    rooms_total, room_id, room_type_id
  ) VALUES (
    p_hotel_id, v_guest_id,
    p_guest_details->>'full_name', p_guest_details->>'mobile', p_guest_details->>'email',
    'CONFIRMED', 'walk_in', v_booking_code,
    v_checkin_ts, v_checkout_ts,
    p_adults, p_children, p_adults, p_children,
    v_rooms_count, v_first_room_id, v_first_room_type_id
  ) RETURNING id INTO v_booking_id;

  FOR v_room_id, v_amount_per_night, v_discount_per_night, v_discount_reason, v_discount_note IN
    SELECT r.room_id, r.amount_per_night,
           COALESCE(r.discount_per_night, 0),
           r.discount_reason, r.discount_note
    FROM jsonb_to_recordset(p_room_selections)
      AS r(
        room_id UUID,
        room_type_id UUID,
        amount_per_night NUMERIC,
        discount_per_night NUMERIC,
        discount_reason TEXT,
        discount_note TEXT
      )
  LOOP
    IF v_discount_per_night < 0 THEN
      RAISE EXCEPTION 'discount_per_night cannot be negative';
    END IF;
    IF v_discount_per_night > 0 AND (v_amount_per_night IS NULL OR v_discount_per_night > v_amount_per_night) THEN
      RAISE EXCEPTION 'discount_per_night (%) cannot exceed amount_per_night (%)',
        v_discount_per_night, v_amount_per_night;
    END IF;
    IF v_discount_per_night > 0 AND COALESCE(v_discount_reason, '') = '' THEN
      RAISE EXCEPTION 'discount_reason is required when discount_per_night > 0';
    END IF;

    IF v_discount_per_night > 0 AND v_amount_per_night > 0 AND v_max_discount_pct IS NOT NULL THEN
      v_discount_pct := (v_discount_per_night / v_amount_per_night) * 100;
      IF v_discount_pct > v_max_discount_pct THEN
        RAISE EXCEPTION 'discount_exceeds_cap: % pct > % pct cap configured for this hotel',
          ROUND(v_discount_pct, 2), v_max_discount_pct;
      END IF;
    END IF;

    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_hotel_id::text || ':' || v_room_id::text, 0)
    );

    SELECT room_type_id
    INTO v_room_type_id
    FROM rooms
    WHERE id = v_room_id AND hotel_id = p_hotel_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Room % does not belong to hotel', v_room_id;
    END IF;

    v_gross_total := CASE
      WHEN v_amount_per_night IS NOT NULL AND v_amount_per_night > 0
        THEN v_amount_per_night * v_nights
      ELSE NULL
    END;
    v_discount_total := v_discount_per_night * v_nights;
    v_net_total := CASE
      WHEN v_gross_total IS NOT NULL THEN GREATEST(0, v_gross_total - v_discount_total)
      ELSE NULL
    END;

    INSERT INTO booking_rooms (
      booking_id, hotel_id, room_type_id, room_id, status, amount_total
    ) VALUES (
      v_booking_id, p_hotel_id, v_room_type_id, v_room_id, 'CHECKED_IN', v_net_total
    ) RETURNING id INTO v_booking_room_id;

    INSERT INTO stays (
      hotel_id, guest_id, room_id, booking_id, booking_room_id,
      booking_code, status, source,
      scheduled_checkin_at, scheduled_checkout_at, actual_checkin_at
    ) VALUES (
      p_hotel_id, v_guest_id, v_room_id, v_booking_id, v_booking_room_id,
      v_booking_code, 'inhouse', 'walk_in',
      v_checkin_ts, v_checkout_ts, now()
    ) RETURNING id INTO v_stay_id;

    v_stay_ids := array_append(v_stay_ids, v_stay_id);

    IF v_gross_total IS NOT NULL THEN
      SELECT id INTO v_folio_id FROM folios WHERE booking_id = v_booking_id LIMIT 1;
      IF v_folio_id IS NULL THEN
        INSERT INTO folios (booking_id, hotel_id, status, currency)
        VALUES (v_booking_id, p_hotel_id, 'OPEN', 'INR')
        RETURNING id INTO v_folio_id;
      END IF;

      INSERT INTO folio_entries (
        hotel_id, booking_id, folio_id, entry_type, amount, description, reference_id
      ) VALUES (
        p_hotel_id, v_booking_id, v_folio_id, 'ROOM_CHARGE',
        v_gross_total,
        'Room ' || v_nights || ' night' || CASE WHEN v_nights = 1 THEN '' ELSE 's' END
          || ' @ ' || v_amount_per_night::TEXT,
        v_booking_room_id
      ) RETURNING id INTO v_room_charge_id;

      IF v_discount_total > 0 THEN
        INSERT INTO folio_entries (
          hotel_id, booking_id, folio_id, entry_type, amount, description, reference_id
        ) VALUES (
          p_hotel_id, v_booking_id, v_folio_id, 'ADJUSTMENT',
          -v_discount_total,
          'Discount: ' || v_discount_reason
            || CASE WHEN COALESCE(v_discount_note,'') = '' THEN '' ELSE ' — ' || v_discount_note END,
          v_booking_room_id
        ) RETURNING id INTO v_adjustment_id;

        INSERT INTO pricing_adjustments (
          hotel_id, booking_id, booking_room_id, folio_entry_id,
          reason_code, note,
          nights, gross_per_night, discount_per_night, total_discount,
          applied_by
        ) VALUES (
          p_hotel_id, v_booking_id, v_booking_room_id, v_adjustment_id,
          v_discount_reason, NULLIF(TRIM(v_discount_note), ''),
          v_nights, v_amount_per_night, v_discount_per_night, v_discount_total,
          p_actor_id
        );
      END IF;

      IF v_tax_pct > 0 AND NOT v_tax_inclusive AND v_net_total > 0 THEN
        v_tax_amount := ROUND(v_net_total * v_tax_pct / 100, 2);
        IF v_tax_amount > 0 THEN
          INSERT INTO folio_entries (
            hotel_id, booking_id, folio_id, entry_type, amount, description, reference_id
          ) VALUES (
            p_hotel_id, v_booking_id, v_folio_id, 'TAX',
            v_tax_amount,
            'Tax @ ' || v_tax_pct::TEXT || '% on ' || v_net_total::TEXT,
            v_booking_room_id
          );
        END IF;
      END IF;
    END IF;

    INSERT INTO checkin_events (stay_id, event_type, actor_id, meta)
    VALUES (
      v_stay_id, 'COMPLETED', v_actor_member_id,
      jsonb_build_object(
        'method', 'walk_in', 'actor_id', p_actor_id, 'device', 'kiosk',
        'hotel_id', p_hotel_id, 'room_id', v_room_id,
        'booking_room_id', v_booking_room_id, 'rooms_total', v_rooms_count,
        'amount_gross', v_gross_total,
        'amount_discount', v_discount_total,
        'amount_net', v_net_total,
        'amount_tax', v_tax_amount,
        'tax_pct', v_tax_pct,
        'tax_inclusive', v_tax_inclusive,
        'discount_reason', v_discount_reason
      )
    );
  END LOOP;

  UPDATE bookings
  SET status = 'CHECKED_IN', checked_in_at = now()
  WHERE id = v_booking_id;

  RETURN jsonb_build_object(
    'stay_ids', to_jsonb(v_stay_ids),
    'booking_id', v_booking_id,
    'booking_code', v_booking_code,
    'rooms_checked_in', v_rooms_count,
    'folio_id', v_folio_id,
    'status', 'SUCCESS'
  );
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'One or more selected rooms are currently busy or checked-in';
  WHEN OTHERS THEN
    RAISE;
END;
$function$;


-- ── request_stay_extension: same fix, single line ──────────────────────────

CREATE OR REPLACE FUNCTION public.request_stay_extension(p_stay_id uuid, p_requested_checkout_date date, p_guest_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stay public.stays%ROWTYPE;
  v_request_id UUID;
  v_requested_ts TIMESTAMPTZ;
  v_additional_nights INT;
  v_caller_uid UUID := auth.uid();
  v_is_staff BOOLEAN := FALSE;
  v_is_guest BOOLEAN := FALSE;
  v_source TEXT;
  v_hotel_tz TEXT;                  -- NEW
  v_hotel_checkout_time TIME;       -- NEW
BEGIN
  SELECT * INTO v_stay FROM public.stays WHERE id = p_stay_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stay % not found', p_stay_id; END IF;
  IF v_stay.status NOT IN ('arriving', 'inhouse') THEN
    RAISE EXCEPTION 'Cannot extend a % stay', v_stay.status;
  END IF;

  v_is_staff := public.vaiyu_is_hotel_member(v_stay.hotel_id);
  IF NOT v_is_staff THEN
    SELECT EXISTS (
      SELECT 1 FROM public.guest_user_map gum
      WHERE gum.user_id = v_caller_uid AND gum.guest_id = v_stay.guest_id
    ) INTO v_is_guest;
    IF NOT v_is_guest THEN
      RAISE EXCEPTION 'Only the guest or hotel staff can request extension for this stay';
    END IF;
  END IF;
  v_source := CASE WHEN v_is_staff THEN 'staff' ELSE 'guest' END;

  -- NEW: read hotel timezone + standard checkout time
  SELECT COALESCE(timezone, 'Asia/Kolkata'),
         COALESCE(default_checkout_time, '11:00:00'::time)
    INTO v_hotel_tz, v_hotel_checkout_time
    FROM public.hotels
   WHERE id = v_stay.hotel_id;

  -- CHANGED: construct in hotel's timezone, not UTC.
  v_requested_ts := ((p_requested_checkout_date::text || ' ' || v_hotel_checkout_time::text)::timestamp
                     AT TIME ZONE v_hotel_tz);

  IF v_requested_ts <= v_stay.scheduled_checkout_at THEN
    RAISE EXCEPTION 'Requested checkout date must be after current scheduled checkout';
  END IF;
  v_additional_nights := GREATEST(1, (p_requested_checkout_date - v_stay.scheduled_checkout_at::DATE));

  UPDATE public.stay_extension_requests
  SET status = 'cancelled',
      staff_note = COALESCE(staff_note, '') || ' [auto-cancelled — replaced by new request]',
      reviewed_at = NOW()
  WHERE stay_id = p_stay_id AND status = 'pending';

  INSERT INTO public.stay_extension_requests (
    hotel_id, stay_id, booking_id, guest_id,
    current_checkout_at, requested_checkout_at, additional_nights,
    status, guest_note,
    requested_by_user, requested_by_source
  ) VALUES (
    v_stay.hotel_id, v_stay.id, v_stay.booking_id, v_stay.guest_id,
    v_stay.scheduled_checkout_at, v_requested_ts, v_additional_nights,
    'pending', NULLIF(TRIM(p_guest_note), ''),
    v_caller_uid, v_source
  ) RETURNING id INTO v_request_id;

  RETURN v_request_id;
END $function$;
