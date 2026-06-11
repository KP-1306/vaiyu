-- Walk-in: complimentary-stay model + folio-always integrity fix.
--
-- Problem (raised 2026-06-11): a walk-in for a room with NO configured rate
-- failed with "Walk-in succeeded but booking/folio id missing" and showed
-- NET TOTAL ₹0. Trace:
--   Availability collapses "no rate" (effective_price NULL) into 0 via `?? 0`
--   → frontend sends amount_per_night = 0 → create_walkin_v2 computes
--   v_gross_total = NULL (the `ELSE NULL` branch) → the ENTIRE folio block is
--   gated behind `IF v_gross_total IS NOT NULL` → folio never created →
--   v_folio_id NULL → returns "folio_id": null → frontend guard throws.
--   The booking + checked-in stay were already inserted, so each failed click
--   left an orphan CHECKED_IN booking with no folio (room shown occupied).
--
-- The defect is conflating two different ₹0s: (a) a room with no rate set
-- (missing data — a silent revenue leak if allowed through), and (b) a
-- deliberate complimentary stay (comp / staff / owner-guest). This migration
-- separates them:
--
--   1. Folio is ALWAYS created (hoisted, unconditional) — every checked-in
--      stay needs a folio for later food orders / incidentals / checkout.
--   2. An unpriced room that is NOT marked complimentary is REJECTED with an
--      actionable error. Because a RAISE rolls back the whole plpgsql txn,
--      no orphan booking is created for future failures.
--   3. A complimentary stay is a first-class, manager-authorized, audited,
--      report-segmented state. Comp rides in the existing per-room jsonb
--      (is_complimentary / comp_reason) → NO signature change, no overload.
--
-- Comp accounting: a comped room WITH a rack rate records ROOM_CHARGE +gross
-- then ADJUSTMENT −gross (net 0) plus a pricing_adjustments row so finance
-- sees the giveaway value; a comped room WITH no rate records ROOM_CHARGE ₹0
-- 'Complimentary: <reason>'. Comp net = 0 → no tax. Comp bypasses the
-- discount cap (a comp is a policy decision, not a discretionary discount).
--
-- Backwards compatible: additive columns (defaults), same RPC signature, the
-- priced path is byte-for-byte the canonical 20260508000001 behaviour.

BEGIN;

-- ─── 1. bookings: complimentary flags (additive) ────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS is_complimentary   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS comp_reason        text,
  ADD COLUMN IF NOT EXISTS comp_authorized_by uuid;

COMMENT ON COLUMN public.bookings.is_complimentary IS
  'True only when EVERY room on the booking is comped. Partial comps are visible via pricing_adjustments(reason_code complimentary/staff_stay/owner_guest).';
COMMENT ON COLUMN public.bookings.comp_authorized_by IS
  'auth.uid() of the manager/finance-manager who authorized the complimentary stay.';

-- ─── 2. Extend pricing_adjustments.reason_code CHECK with comp codes ─────
ALTER TABLE public.pricing_adjustments
  DROP CONSTRAINT IF EXISTS chk_pricing_adjustments_reason;
ALTER TABLE public.pricing_adjustments
  ADD CONSTRAINT chk_pricing_adjustments_reason
    CHECK (reason_code IN (
      'manager_discretion',
      'loyalty',
      'service_recovery',
      'price_match',
      'corporate',
      'long_stay',
      'other',
      -- new: complimentary-stay reason codes
      'complimentary',
      'staff_stay',
      'owner_guest'
    ));

-- ─── 3. create_walkin_v2: comp-aware, folio-always ──────────────────────
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
  v_is_comp BOOLEAN;                -- NEW: per-room comp flag
  v_comp_reason TEXT;               -- NEW: per-room comp reason code
  v_gross_total NUMERIC(12,2);
  v_discount_total NUMERIC(12,2);
  v_net_total NUMERIC(12,2);
  v_room_amount_total NUMERIC(12,2);-- NEW: booking_rooms.amount_total (0 for comp)
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
  v_any_comp BOOLEAN := FALSE;      -- NEW
  v_all_comp BOOLEAN := FALSE;      -- NEW
  v_booking_comp_reason TEXT;       -- NEW: booking-level comp reason
  v_gross_waived NUMERIC(12,2) := 0;-- NEW: total rack value given away (audit)
  v_max_discount_pct INT;
  v_discount_pct NUMERIC(5,2);
  v_tax_pct NUMERIC(5,2);
  v_tax_inclusive BOOLEAN;
  v_tax_amount NUMERIC(12,2);
  v_actor_member_id UUID;
  v_hotel_tz TEXT;
  v_hotel_checkin_time TIME;
  v_hotel_checkout_time TIME;
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

  SELECT COALESCE(tax_percentage, 12),
         COALESCE(tax_inclusive, false),
         COALESCE(timezone, 'Asia/Kolkata'),
         COALESCE(default_checkin_time, '14:00:00'::time),
         COALESCE(default_checkout_time, '11:00:00'::time)
    INTO v_tax_pct, v_tax_inclusive,
         v_hotel_tz, v_hotel_checkin_time, v_hotel_checkout_time
    FROM public.hotels
   WHERE id = p_hotel_id;

  -- Pre-scan selections for discount + comp intent.
  SELECT BOOL_OR(COALESCE((sel->>'discount_per_night')::NUMERIC, 0) > 0)
    INTO v_any_discount
    FROM jsonb_array_elements(p_room_selections) AS sel;

  SELECT BOOL_OR(COALESCE((sel->>'is_complimentary')::boolean, false)),
         BOOL_AND(COALESCE((sel->>'is_complimentary')::boolean, false)),
         MAX(NULLIF(TRIM(sel->>'comp_reason'), ''))
    INTO v_any_comp, v_all_comp, v_booking_comp_reason
    FROM jsonb_array_elements(p_room_selections) AS sel;

  -- Manager gate: discounts AND comps both require finance-manager authority.
  IF (v_any_discount OR v_any_comp) THEN
    SELECT public.vaiyu_is_hotel_finance_manager(p_hotel_id) INTO v_can_discount;
    IF v_can_discount IS NOT TRUE THEN
      IF v_any_comp THEN
        RAISE EXCEPTION 'Complimentary stays require a manager or finance-manager role for this hotel';
      ELSE
        RAISE EXCEPTION 'Discount requires a manager or finance-manager role for this hotel';
      END IF;
    END IF;
    -- Discount cap is read only for discounts; comp bypasses the cap.
    IF v_any_discount THEN
      SELECT max_discount_pct INTO v_max_discount_pct
        FROM public.pricing_settings WHERE hotel_id = p_hotel_id;
    END IF;
  END IF;

  IF v_any_comp AND v_booking_comp_reason IS NULL THEN
    RAISE EXCEPTION 'comp_reason is required for a complimentary stay';
  END IF;

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

  -- CHANGED: folio created unconditionally (integrity invariant — every
  -- checked-in stay has a folio, even a ₹0 comp). Fresh booking → no folio yet,
  -- but guard with ON CONFLICT (ux_booking_folio UNIQUE on booking_id) to match
  -- the canonical's defensive idempotent pattern, then resolve the id either way.
  INSERT INTO folios (booking_id, hotel_id, status, currency)
  VALUES (v_booking_id, p_hotel_id, 'OPEN', 'INR')
  ON CONFLICT (booking_id) DO NOTHING;
  SELECT id INTO v_folio_id FROM public.folios WHERE booking_id = v_booking_id;

  FOR v_room_id, v_amount_per_night, v_discount_per_night, v_discount_reason, v_discount_note, v_is_comp, v_comp_reason IN
    SELECT r.room_id, r.amount_per_night,
           COALESCE(r.discount_per_night, 0),
           r.discount_reason, r.discount_note,
           COALESCE(r.is_complimentary, false),
           NULLIF(TRIM(r.comp_reason), '')
    FROM jsonb_to_recordset(p_room_selections)
      AS r(
        room_id UUID,
        room_type_id UUID,
        amount_per_night NUMERIC,
        discount_per_night NUMERIC,
        discount_reason TEXT,
        discount_note TEXT,
        is_complimentary BOOLEAN,
        comp_reason TEXT
      )
  LOOP
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

    -- Reset per-room derived values each iteration.
    v_gross_total := CASE
      WHEN v_amount_per_night IS NOT NULL AND v_amount_per_night > 0
        THEN v_amount_per_night * v_nights
      ELSE NULL
    END;
    v_discount_total := 0;
    v_net_total := NULL;
    v_tax_amount := NULL;

    IF v_is_comp THEN
      -- ── Complimentary room ────────────────────────────────────────────
      -- Full waive. Discount fields ignored. booking_rooms.amount_total = 0.
      v_comp_reason := COALESCE(v_comp_reason, v_booking_comp_reason);
      IF v_comp_reason IS NULL THEN
        RAISE EXCEPTION 'comp_reason is required for a complimentary room';
      END IF;
      v_room_amount_total := 0;
    ELSIF v_gross_total IS NOT NULL THEN
      -- ── Priced room (canonical behaviour) ─────────────────────────────
      IF v_discount_per_night < 0 THEN
        RAISE EXCEPTION 'discount_per_night cannot be negative';
      END IF;
      IF v_discount_per_night > 0 AND v_discount_per_night > v_amount_per_night THEN
        RAISE EXCEPTION 'discount_per_night (%) cannot exceed amount_per_night (%)',
          v_discount_per_night, v_amount_per_night;
      END IF;
      IF v_discount_per_night > 0 AND COALESCE(v_discount_reason, '') = '' THEN
        RAISE EXCEPTION 'discount_reason is required when discount_per_night > 0';
      END IF;
      IF v_discount_per_night > 0 AND v_max_discount_pct IS NOT NULL THEN
        v_discount_pct := (v_discount_per_night / v_amount_per_night) * 100;
        IF v_discount_pct > v_max_discount_pct THEN
          RAISE EXCEPTION 'discount_exceeds_cap: % pct > % pct cap configured for this hotel',
            ROUND(v_discount_pct, 2), v_max_discount_pct;
        END IF;
      END IF;
      v_discount_total := v_discount_per_night * v_nights;
      v_net_total := GREATEST(0, v_gross_total - v_discount_total);
      v_room_amount_total := v_net_total;
    ELSE
      -- ── Unpriced & not comp → reject (rolls back the whole txn) ────────
      RAISE EXCEPTION 'no_rate_configured: room % has no rate — set a rate or mark the stay complimentary', v_room_id;
    END IF;

    INSERT INTO booking_rooms (
      booking_id, hotel_id, room_type_id, room_id, status, amount_total
    ) VALUES (
      v_booking_id, p_hotel_id, v_room_type_id, v_room_id, 'CHECKED_IN', v_room_amount_total
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

    IF v_is_comp THEN
      -- Comp folio entries. If a rack rate exists, record the charge and an
      -- equal waive so finance sees the giveaway; else a ₹0 comp line.
      IF v_gross_total IS NOT NULL THEN
        INSERT INTO folio_entries (
          hotel_id, booking_id, folio_id, entry_type, amount, description, reference_id
        ) VALUES (
          p_hotel_id, v_booking_id, v_folio_id, 'ROOM_CHARGE',
          v_gross_total,
          'Room ' || v_nights || ' night' || CASE WHEN v_nights = 1 THEN '' ELSE 's' END
            || ' @ ' || v_amount_per_night::TEXT,
          v_booking_room_id
        ) RETURNING id INTO v_room_charge_id;

        INSERT INTO folio_entries (
          hotel_id, booking_id, folio_id, entry_type, amount, description, reference_id
        ) VALUES (
          p_hotel_id, v_booking_id, v_folio_id, 'ADJUSTMENT',
          -v_gross_total,
          'Complimentary: ' || v_comp_reason,
          v_booking_room_id
        ) RETURNING id INTO v_adjustment_id;

        INSERT INTO pricing_adjustments (
          hotel_id, booking_id, booking_room_id, folio_entry_id,
          reason_code, note,
          nights, gross_per_night, discount_per_night, total_discount,
          applied_by
        ) VALUES (
          p_hotel_id, v_booking_id, v_booking_room_id, v_adjustment_id,
          v_comp_reason, 'Complimentary stay',
          v_nights, v_amount_per_night, v_amount_per_night, v_gross_total,
          p_actor_id
        );

        v_gross_waived := v_gross_waived + v_gross_total;
      ELSE
        INSERT INTO folio_entries (
          hotel_id, booking_id, folio_id, entry_type, amount, description, reference_id
        ) VALUES (
          p_hotel_id, v_booking_id, v_folio_id, 'ROOM_CHARGE',
          0,
          'Complimentary: ' || v_comp_reason,
          v_booking_room_id
        );
      END IF;
    ELSE
      -- Priced folio entries (canonical).
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
        'amount_net', COALESCE(v_net_total, v_room_amount_total),
        'amount_tax', v_tax_amount,
        'tax_pct', v_tax_pct,
        'tax_inclusive', v_tax_inclusive,
        'discount_reason', v_discount_reason,
        'is_complimentary', v_is_comp,
        'comp_reason', CASE WHEN v_is_comp THEN v_comp_reason ELSE NULL END
      )
    );
  END LOOP;

  UPDATE bookings
  SET status = 'CHECKED_IN',
      checked_in_at = now(),
      is_complimentary = v_all_comp,
      comp_reason = CASE WHEN v_any_comp THEN v_booking_comp_reason ELSE NULL END,
      comp_authorized_by = CASE WHEN v_any_comp THEN p_actor_id ELSE NULL END
  WHERE id = v_booking_id;

  -- Audit the complimentary authorization once per booking.
  IF v_any_comp THEN
    INSERT INTO va_audit_logs (action, actor, hotel_id, entity, entity_id, meta)
    VALUES (
      'walkin.comp_checkin',
      p_actor_id::text,
      p_hotel_id,
      'booking',
      v_booking_id,
      jsonb_build_object(
        'booking_code', v_booking_code,
        'comp_reason', v_booking_comp_reason,
        'rooms_count', v_rooms_count,
        'fully_complimentary', v_all_comp,
        'gross_waived', v_gross_waived
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'stay_ids', to_jsonb(v_stay_ids),
    'booking_id', v_booking_id,
    'booking_code', v_booking_code,
    'rooms_checked_in', v_rooms_count,
    'folio_id', v_folio_id,
    'is_complimentary', v_all_comp,
    'status', 'SUCCESS'
  );
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'One or more selected rooms are currently busy or checked-in';
  WHEN OTHERS THEN
    RAISE;
END;
$function$;

ALTER FUNCTION public.create_walkin_v2(uuid, jsonb, jsonb, date, date, integer, integer, uuid) OWNER TO postgres;
GRANT ALL ON FUNCTION public.create_walkin_v2(uuid, jsonb, jsonb, date, date, integer, integer, uuid) TO anon, authenticated, service_role;

COMMIT;
