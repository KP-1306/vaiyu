-- ============================================================
-- VAiyu – Walk-in tax folio integration
-- ============================================================
-- Audit gap closed: the walk-in UI displayed a hardcoded 12% surcharge
-- on the booking summary, but `create_walkin_v2` only posted a
-- ROOM_CHARGE folio entry — no TAX line was ever inserted. That meant
-- the displayed total was decorative; folio totals, GST reports, and
-- checkout reconciliation would silently miss the tax leg.
--
-- Design:
--   • hotels.tax_percentage gets a default of 12 and existing NULLs are
--     backfilled to 12 to match what the UI has been showing all along.
--   • create_walkin_v2 reads tax_percentage + tax_inclusive once per
--     call. For tax-exclusive hotels (the common case in India), it
--     inserts a TAX folio entry per room equal to NET × pct/100, posted
--     after the ROOM_CHARGE and any discount ADJUSTMENT.
--   • For tax-inclusive hotels (rare), the TAX line is intentionally
--     skipped in this iteration — the rate already includes tax and
--     extracting it would change the meaning of booking_rooms.amount_total.
--     A follow-up can split the inclusive rate into pretax + tax once we
--     decide how to represent that in the schema.
-- ============================================================

-- ─── 1. Sane defaults for tax_percentage ───────────────────
ALTER TABLE public.hotels
  ALTER COLUMN tax_percentage SET DEFAULT 12;

UPDATE public.hotels
   SET tax_percentage = 12
 WHERE tax_percentage IS NULL;


-- ─── 2. Replace create_walkin_v2 with tax-aware version ─────
-- Body identical to migration 20260427000002 (discount cap) plus:
--   - declares v_tax_pct, v_tax_inclusive, v_tax_amount
--   - loads hotel tax config once at start
--   - inserts a TAX folio entry per room when applicable
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
  v_tax_pct NUMERIC(5,2);          -- NEW: hotels.tax_percentage
  v_tax_inclusive BOOLEAN;          -- NEW: hotels.tax_inclusive
  v_tax_amount NUMERIC(12,2);       -- NEW: per-room TAX line amount
BEGIN
  IF p_room_selections IS NULL OR jsonb_array_length(p_room_selections) = 0 THEN
    RAISE EXCEPTION 'At least one room selection is required';
  END IF;
  v_rooms_count := jsonb_array_length(p_room_selections);

  IF coalesce(trim(p_guest_details->>'full_name'),'') = '' THEN
    RAISE EXCEPTION 'Guest name required';
  END IF;

  -- NEW: load hotel tax config once. NULL → 12 (back-compat with the
  -- frontend's previous hardcoded 12%); set 0 explicitly to disable.
  SELECT COALESCE(tax_percentage, 12), COALESCE(tax_inclusive, false)
    INTO v_tax_pct, v_tax_inclusive
    FROM public.hotels
   WHERE id = p_hotel_id;

  -- Pre-scan for any positive discount → triggers RBAC gate AND cap fetch.
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

  IF p_checkin_date = CURRENT_DATE THEN
    v_checkin_ts := now();
  ELSE
    v_checkin_ts := (p_checkin_date || ' 14:00:00')::timestamptz;
  END IF;
  v_checkout_ts := (p_checkout_date || ' 11:00:00')::timestamptz;

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

      -- NEW: TAX folio entry. Exclusive-tax hotels only — inclusive rates
      -- already bake in tax, so a TAX line would double-count in the
      -- folio total. Tax is computed on the discounted (net) base, which
      -- matches Indian GST practice for hotel services.
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
      v_stay_id, 'COMPLETED', p_actor_id,
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
$$;
