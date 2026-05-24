-- ============================================================
-- VAiyu Pricing – Walk-in enforcement + front-desk discounts
-- ============================================================
-- Scope:
--   1. pricing_adjustments table — structured audit of every discount
--      (reason, note, who-applied, gross, discount). Enables finance
--      reports like "discounts granted this month by reason code".
--   2. create_walkin_v2 extended to accept per-room discount fields:
--      the RPC posts a ROOM_CHARGE folio_entry at gross amount, an
--      ADJUSTMENT folio_entry for the discount, and a pricing_adjustments
--      row linking them.
-- ============================================================

-- ─── 1. pricing_adjustments (front-desk discounts audit) ────
CREATE TABLE IF NOT EXISTS public.pricing_adjustments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id          UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  booking_id        UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  booking_room_id   UUID NULL REFERENCES public.booking_rooms(id) ON DELETE SET NULL,
  folio_entry_id    UUID NULL REFERENCES public.folio_entries(id) ON DELETE SET NULL,
  -- Reason code drives finance reports. Free-form `note` captures specifics
  -- (guest name, case number, approver name) that don't belong in the code.
  reason_code       TEXT NOT NULL,
  note              TEXT NULL,
  -- Gross-per-night & discount-per-night are captured so reports can compare
  -- "what was quoted" vs "what was charged" without reconstructing from
  -- folio math.
  nights            INT NOT NULL CHECK (nights >= 1),
  gross_per_night   NUMERIC(12,2) NOT NULL CHECK (gross_per_night >= 0),
  discount_per_night NUMERIC(12,2) NOT NULL CHECK (discount_per_night >= 0),
  total_discount    NUMERIC(12,2) NOT NULL CHECK (total_discount >= 0),
  applied_by        UUID NULL,         -- auth.uid() of staff; NULL for guest-portal flows
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_pricing_adjustments_reason
    CHECK (reason_code IN (
      'manager_discretion',
      'loyalty',
      'service_recovery',
      'price_match',
      'corporate',
      'long_stay',
      'other'
    ))
);

CREATE INDEX IF NOT EXISTS idx_pricing_adjustments_hotel_created
  ON public.pricing_adjustments(hotel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pricing_adjustments_booking
  ON public.pricing_adjustments(booking_id);

COMMENT ON TABLE public.pricing_adjustments IS
  'Audit trail for discretionary discounts applied at check-in. One row per discounted booking_room. Folio linkage via folio_entry_id.';

ALTER TABLE public.pricing_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pricing_adjustments_owner_rw ON public.pricing_adjustments;
DO $$
DECLARE v_has_helper BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'user_is_hotel_owner')
    INTO v_has_helper;
  IF v_has_helper THEN
    EXECUTE $p$
      CREATE POLICY pricing_adjustments_owner_rw ON public.pricing_adjustments
        FOR ALL TO authenticated
        USING  (public.user_is_hotel_owner(hotel_id))
        WITH CHECK (public.user_is_hotel_owner(hotel_id));
    $p$;
  ELSE
    EXECUTE $p$
      CREATE POLICY pricing_adjustments_owner_rw ON public.pricing_adjustments
        FOR ALL TO authenticated USING (true) WITH CHECK (true);
    $p$;
  END IF;
END $$;


-- ─── 2. create_walkin_v2 with discount support ─────────────
-- Added jsonb fields on each room selection:
--   amount_per_night   (existing)
--   discount_per_night (optional, default 0)
--   discount_reason    (optional; required when discount > 0)
--   discount_note      (optional)
-- Booking-level behavior:
--   ROOM_CHARGE folio entry posted at gross (amount_per_night × nights).
--   ADJUSTMENT folio entry posted at -(discount_per_night × nights).
--   pricing_adjustments row links both for audit/reporting.
--   booking_rooms.amount_total = NET (gross - total discount).

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
BEGIN
  -- ── 1. Validate Input ──
  IF p_room_selections IS NULL OR jsonb_array_length(p_room_selections) = 0 THEN
    RAISE EXCEPTION 'At least one room selection is required';
  END IF;
  v_rooms_count := jsonb_array_length(p_room_selections);

  IF coalesce(trim(p_guest_details->>'full_name'),'') = '' THEN
    RAISE EXCEPTION 'Guest name required';
  END IF;

  -- ── 2. Timestamps ──
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

  -- ── 3. Duplicate + first-room validation ──
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

  -- ── 4. Upsert guest ──
  v_guest_id := public.upsert_guest_v2(p_guest_details);

  -- ── 5. Guest idempotency lock ──
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_hotel_id::text || ':' || v_guest_id::text, 0)
  );

  -- ── 6. Create booking ──
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

  -- ── 7. Process each room ──
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
    -- Validate discount
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

    -- Room advisory lock + row validation
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

    -- Compute gross / discount / net totals
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

    -- booking_room with NET total (what the guest actually pays for this room)
    INSERT INTO booking_rooms (
      booking_id, hotel_id, room_type_id, room_id, status, amount_total
    ) VALUES (
      v_booking_id, p_hotel_id, v_room_type_id, v_room_id, 'CHECKED_IN', v_net_total
    ) RETURNING id INTO v_booking_room_id;

    -- stay
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

    -- Folio + entries
    IF v_gross_total IS NOT NULL THEN
      -- Lazy folio
      SELECT id INTO v_folio_id FROM folios WHERE booking_id = v_booking_id LIMIT 1;
      IF v_folio_id IS NULL THEN
        INSERT INTO folios (booking_id, hotel_id, status, currency)
        VALUES (v_booking_id, p_hotel_id, 'OPEN', 'INR')
        RETURNING id INTO v_folio_id;
      END IF;

      -- ROOM_CHARGE at GROSS
      INSERT INTO folio_entries (
        hotel_id, booking_id, folio_id, entry_type, amount, description, reference_id
      ) VALUES (
        p_hotel_id, v_booking_id, v_folio_id, 'ROOM_CHARGE',
        v_gross_total,
        'Room ' || v_nights || ' night' || CASE WHEN v_nights = 1 THEN '' ELSE 's' END
          || ' @ ' || v_amount_per_night::TEXT,
        v_booking_room_id
      ) RETURNING id INTO v_room_charge_id;

      -- ADJUSTMENT entry for the discount (negative) + structured audit row
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
    END IF;

    -- Checkin event
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
        'amount_gross', v_gross_total,
        'amount_discount', v_discount_total,
        'amount_net', v_net_total,
        'discount_reason', v_discount_reason
      )
    );
  END LOOP;

  -- ── 8. Flip booking to CHECKED_IN ──
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
