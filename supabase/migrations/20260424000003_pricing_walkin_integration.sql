-- ============================================================
-- VAiyu Pricing Module – Walk-in flow integration
-- ============================================================
-- Scope: **walk-in path only**. Pre-checkin / reservations are
-- intentionally NOT touched in this migration and still read
-- `rate_plan_prices` directly.
--
-- What this migration does
-- 1. Adds `v_effective_room_price` view that resolves the price a
--    guest should actually see: pricing_current_rates.override_price
--    when an unexpired override exists, otherwise MIN(rate_plan_prices).
-- 2. Replaces `create_walkin_v2` with a version that:
--      - accepts an optional `amount_per_night` per room selection,
--      - persists `booking_rooms.amount_total = amount_per_night × nights`
--        so the rate is locked in at check-in (guest is insulated from
--        later pricing changes),
--      - lazily creates the folio + inserts a ROOM_CHARGE folio_entry
--        per booking_room, matching the established service-order
--        pattern used by trg_food_to_folio / trg_payment_to_folio.
-- ============================================================

-- ─── 1. Effective-price view ────────────────────────────────
-- COALESCE order (most-specific first):
--   per-room-type override  →  property-wide override  →  base plan price.
-- Expired overrides (expires_at < now()) are ignored.

CREATE OR REPLACE VIEW public.v_effective_room_price AS
WITH base AS (
  SELECT
    rt.hotel_id,
    rt.id AS room_type_id,
    (SELECT MIN(price) FROM public.rate_plan_prices rpp WHERE rpp.room_type_id = rt.id)
      AS base_price
  FROM public.room_types rt
)
SELECT
  base.hotel_id,
  base.room_type_id,
  base.base_price,
  COALESCE(
    per_type.override_price,
    property_wide.override_price,
    base.base_price
  ) AS effective_price,
  (per_type.override_price IS NOT NULL OR property_wide.override_price IS NOT NULL)
    AS is_overridden,
  COALESCE(per_type.rule_id, property_wide.rule_id) AS rule_id,
  COALESCE(per_type.applied_at, property_wide.applied_at) AS applied_at,
  CASE
    WHEN per_type.override_price     IS NOT NULL THEN 'room_type'
    WHEN property_wide.override_price IS NOT NULL THEN 'property'
    ELSE NULL
  END AS override_scope
FROM base
LEFT JOIN public.pricing_current_rates per_type
  ON per_type.hotel_id     = base.hotel_id
 AND per_type.room_type_id = base.room_type_id
 AND (per_type.expires_at IS NULL OR per_type.expires_at > NOW())
LEFT JOIN public.pricing_current_rates property_wide
  ON property_wide.hotel_id     = base.hotel_id
 AND property_wide.room_type_id IS NULL
 AND (property_wide.expires_at IS NULL OR property_wide.expires_at > NOW());

COMMENT ON VIEW public.v_effective_room_price IS
  'Effective room price per (hotel_id, room_type_id): per-type override wins over property-wide override wins over MIN(rate_plan_prices). Used by walk-in availability.';

GRANT SELECT ON public.v_effective_room_price TO authenticated, anon, service_role;


-- ─── 2. create_walkin_v2 with price lock-in + folio ─────────
-- Backwards-compatible: if `amount_per_night` is omitted on a selection
-- the RPC skips the persistence/folio write for that room (old UI code
-- keeps working). The walk-in UI passes it now — see Availability.tsx.

CREATE OR REPLACE FUNCTION "public"."create_walkin_v2"(
  "p_hotel_id" "uuid",
  "p_guest_details" "jsonb",
  "p_room_selections" "jsonb",
  "p_checkin_date" "date",
  "p_checkout_date" "date",
  "p_adults" integer DEFAULT 1,
  "p_children" integer DEFAULT 0,
  "p_actor_id" "uuid" DEFAULT NULL::"uuid"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
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
  v_room_total NUMERIC(12,2);
  v_nights INT;
  v_stay_ids UUID[] := '{}';
  v_rooms_count INT;
  v_first_room_id UUID;
  v_first_room_type_id UUID;
  v_folio_id UUID;
BEGIN
  -- ── 1. Validate Input ──
  IF p_room_selections IS NULL OR jsonb_array_length(p_room_selections) = 0 THEN
    RAISE EXCEPTION 'At least one room selection is required';
  END IF;
  v_rooms_count := jsonb_array_length(p_room_selections);

  IF coalesce(trim(p_guest_details->>'full_name'),'') = '' THEN
    RAISE EXCEPTION 'Guest name required';
  END IF;

  -- ── 2. Compute & Validate Timestamps ──
  IF p_checkin_date = CURRENT_DATE THEN
    v_checkin_ts := now();
  ELSE
    v_checkin_ts := (p_checkin_date || ' 14:00:00')::timestamptz;
  END IF;

  v_checkout_ts := (p_checkout_date || ' 11:00:00')::timestamptz;

  IF v_checkout_ts <= v_checkin_ts THEN
    RAISE EXCEPTION 'Checkout must be after checkin';
  END IF;

  -- Nights used for ROOM_CHARGE total. Using date diff (not hour diff) to
  -- stay consistent with how the UI computes `nights` in stayDetails.
  v_nights := GREATEST(1, (p_checkout_date - p_checkin_date));

  -- ── 3. Room Validation & Pre-loop Safety ──
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

  -- ── 4. Create/Upsert Guest ──
  v_guest_id := public.upsert_guest_v2(p_guest_details);

  -- ── 5. Guest Idempotency Lock ──
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_hotel_id::text || ':' || v_guest_id::text, 0)
  );

  -- ── 6. Create Booking ──
  v_booking_code := 'W-' || to_char(now(), 'YYMMDDHH24MISS') || '-' || substring(gen_random_uuid()::text, 1, 4);

  INSERT INTO bookings (
    hotel_id, guest_id, guest_name, phone, email,
    status, source, code,
    scheduled_checkin_at, scheduled_checkout_at,
    adults, children,
    adults_total, children_total,
    rooms_total,
    room_id, room_type_id
  ) VALUES (
    p_hotel_id, v_guest_id,
    p_guest_details->>'full_name', p_guest_details->>'mobile', p_guest_details->>'email',
    'CONFIRMED', 'walk_in', v_booking_code,
    v_checkin_ts, v_checkout_ts,
    p_adults, p_children,
    p_adults, p_children,
    v_rooms_count,
    v_first_room_id, v_first_room_type_id
  ) RETURNING id INTO v_booking_id;

  -- ── 7. Process Each Room (Loop) ──
  FOR v_room_id, v_amount_per_night IN
    SELECT r.room_id, r.amount_per_night
    FROM jsonb_to_recordset(p_room_selections)
      AS r(room_id UUID, room_type_id UUID, amount_per_night NUMERIC)
  LOOP
    -- 7a. Room Advisory Lock
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_hotel_id::text || ':' || v_room_id::text, 0)
    );

    -- 7b. Validate room, lock it, resolve room_type_id
    SELECT room_type_id
    INTO v_room_type_id
    FROM rooms
    WHERE id = v_room_id
    AND hotel_id = p_hotel_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Room % does not belong to hotel', v_room_id;
    END IF;

    -- 7c. Compute room total (NULL amount_per_night → no price persistence)
    v_room_total := CASE
      WHEN v_amount_per_night IS NOT NULL AND v_amount_per_night > 0
        THEN v_amount_per_night * v_nights
      ELSE NULL
    END;

    -- 7d. Create booking_room (with locked-in total if available)
    INSERT INTO booking_rooms (
      booking_id, hotel_id, room_type_id, room_id, status, amount_total
    ) VALUES (
      v_booking_id, p_hotel_id, v_room_type_id, v_room_id, 'CHECKED_IN', v_room_total
    ) RETURNING id INTO v_booking_room_id;

    -- 7e. Create stay
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

    -- 7f. Lazily create folio + ROOM_CHARGE entry
    -- Mirrors trg_food_to_folio pattern (one folio per booking, multiple entries).
    IF v_room_total IS NOT NULL THEN
      SELECT id INTO v_folio_id
      FROM folios
      WHERE booking_id = v_booking_id
      LIMIT 1;

      IF v_folio_id IS NULL THEN
        INSERT INTO folios (booking_id, hotel_id, status, currency)
        VALUES (v_booking_id, p_hotel_id, 'OPEN', 'INR')
        RETURNING id INTO v_folio_id;
      END IF;

      INSERT INTO folio_entries (
        hotel_id, booking_id, folio_id, entry_type, amount, description, reference_id
      ) VALUES (
        p_hotel_id, v_booking_id, v_folio_id, 'ROOM_CHARGE',
        v_room_total,
        'Room ' || v_nights || ' night' || CASE WHEN v_nights = 1 THEN '' ELSE 's' END
          || ' @ ' || v_amount_per_night::TEXT,
        v_booking_room_id
      );
    END IF;

    -- 7g. Log event per room
    INSERT INTO checkin_events (stay_id, event_type, actor_id, meta)
    VALUES (
      v_stay_id, 'COMPLETED', p_actor_id,
      jsonb_build_object(
        'method', 'walk_in',
        'actor_id', p_actor_id,
        'device', 'kiosk',
        'hotel_id', p_hotel_id,
        'room_id', v_room_id,
        'booking_room_id', v_booking_room_id,
        'rooms_total', v_rooms_count,
        'amount_total', v_room_total
      )
    );
  END LOOP;

  -- ── 8. Transition Booking to CHECKED_IN ──
  UPDATE bookings
  SET
    status = 'CHECKED_IN',
    checked_in_at = now()
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
$$;

ALTER FUNCTION "public"."create_walkin_v2"(
  "p_hotel_id" "uuid",
  "p_guest_details" "jsonb",
  "p_room_selections" "jsonb",
  "p_checkin_date" "date",
  "p_checkout_date" "date",
  "p_adults" integer,
  "p_children" integer,
  "p_actor_id" "uuid"
) OWNER TO "postgres";
