-- Guest Arrival ETA share.
--
-- The upcoming-stay card shows the hotel's policy check-in time, not when the
-- guest will actually arrive — Uttarakhand arrivals vary by many hours (hill
-- roads, Delhi traffic). This lets the guest answer the question every front
-- desk asks by phone ("kitne baje tak pahunchenge?") with one tap:
--   • guest card: "When will you arrive?" → time picker → RPC below
--   • arrivals board: ETA chip on the booking row (realtime — the board's
--     existing postgres_changes subscription on bookings delivers the update,
--     enabled by the member SELECT policy from 20260612000004)
--
-- v1 semantics: ETA is a time-of-day on the SCHEDULED ARRIVAL DATE, interpreted
-- in the hotel's timezone. A guest arriving a different day should change the
-- booking, not the ETA. Clearing is allowed (p_eta_time NULL).

-- ─── 1. bookings.expected_arrival_at ─────────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS expected_arrival_at timestamptz;

COMMENT ON COLUMN public.bookings.expected_arrival_at IS
  'Guest-shared ETA for arrival day (set via set_guest_arrival_eta; time-of-day on the scheduled check-in date, hotel timezone). Shown as a chip on the arrivals board.';

-- ─── 2. RPC: set_guest_arrival_eta ───────────────────────────────────────────
-- SECURITY DEFINER with explicit ownership + lifecycle guards (the repo's
-- standard pattern: guests have no UPDATE policy on bookings; the RPC is the
-- only write path and validates everything).
CREATE OR REPLACE FUNCTION public.set_guest_arrival_eta(
  p_booking_id uuid,
  p_eta_time   text  -- 'HH:MM' 24h, or NULL to clear
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_booking  public.bookings;
  v_tz       text;
  v_eta      timestamptz;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Ownership: only the booking's guest may set their ETA.
  IF v_booking.guest_id IS DISTINCT FROM public.current_guest_id() THEN
    RAISE EXCEPTION 'not_your_booking' USING ERRCODE = '42501';
  END IF;

  -- Lifecycle: ETA only makes sense before check-in. Same status set the
  -- guest active-bookings view uses for its pre-arrival branch.
  IF v_booking.status NOT IN ('CONFIRMED','PRE_CHECKED_IN','PARTIALLY_CHECKED_IN') THEN
    RAISE EXCEPTION 'eta_only_before_checkin' USING ERRCODE = 'P0001';
  END IF;

  IF p_eta_time IS NULL OR btrim(p_eta_time) = '' THEN
    v_eta := NULL;  -- clear
  ELSE
    IF p_eta_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'invalid_eta_time_format' USING ERRCODE = '22007';
    END IF;
    SELECT COALESCE(h.timezone, 'Asia/Kolkata') INTO v_tz
      FROM public.hotels h WHERE h.id = v_booking.hotel_id;
    -- Time-of-day on the scheduled arrival date, in the hotel's timezone.
    v_eta := (
      ((v_booking.scheduled_checkin_at AT TIME ZONE v_tz)::date)::text
      || ' ' || p_eta_time
    )::timestamp AT TIME ZONE v_tz;
  END IF;

  UPDATE public.bookings
     SET expected_arrival_at = v_eta,
         updated_at = now()
   WHERE id = p_booking_id;

  RETURN jsonb_build_object('ok', true, 'expected_arrival_at', v_eta);
END;
$$;

REVOKE ALL ON FUNCTION public.set_guest_arrival_eta(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_guest_arrival_eta(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.set_guest_arrival_eta(uuid, text) IS
  'Guest shares/clears their arrival ETA (HH:MM on the scheduled check-in date, hotel timezone). Ownership via current_guest_id(); pre-arrival statuses only.';

-- ─── 3. v_arrival_dashboard_rows: append expected_arrival_at ─────────────────
-- Same append precedent as 20260612000004 (adults_total): bookings is already
-- joined; new column goes last so CREATE OR REPLACE VIEW is legal.
CREATE OR REPLACE VIEW "public"."v_arrival_dashboard_rows" AS
 SELECT "a"."booking_id",
    "a"."hotel_id",
    "a"."booking_code",
    "a"."booking_status",
    "a"."guest_name",
    "a"."phone",
    "a"."scheduled_checkin_at",
    "a"."scheduled_checkout_at",
    "a"."room_numbers",
    "a"."rooms_total",
    "a"."rooms_checked_in",
    "a"."rooms_unassigned",
    "a"."rooms_dirty",
    "a"."rooms_clean",
    "a"."inhouse_rooms",
    "a"."active_stay_id",
    "a"."arrival_operational_state",
    "a"."rooms_ready_for_arrival",
    "a"."primary_action",
    "a"."minutes_since_scheduled_arrival",
    "a"."urgency_level",
    "a"."eligible_for_bulk_checkin",
    COALESCE("p"."payment_pending", false) AS "payment_pending",
    COALESCE("p"."pending_amount", (0)::numeric) AS "pending_amount",
    "l"."arrival_badge",
    COALESCE("l"."vip_flag", false) AS "vip_flag",
    "hk"."cleaning_minutes_remaining",
    COALESCE("p"."total_amount", (0)::numeric) AS "total_amount",
    COALESCE("p"."paid_amount", (0)::numeric) AS "paid_amount",
    "b"."adults_total",
    "b"."children_total",
    "b"."expected_arrival_at"
   FROM (((("public"."v_owner_arrivals_dashboard" "a"
     LEFT JOIN "public"."v_arrival_payment_state" "p" ON (("p"."booking_id" = "a"."booking_id")))
     LEFT JOIN "public"."v_arrival_guest_labels" "l" ON (("l"."booking_id" = "a"."booking_id")))
     LEFT JOIN "public"."bookings" "b" ON (("b"."id" = "a"."booking_id")))
     LEFT JOIN ( SELECT "br"."booking_id",
            "min"("h"."minutes_remaining") AS "cleaning_minutes_remaining"
           FROM ("public"."booking_rooms" "br"
             JOIN "public"."v_arrival_housekeeping_eta" "h" ON (("h"."room_id" = "br"."room_id")))
          GROUP BY "br"."booking_id") "hk" ON (("hk"."booking_id" = "a"."booking_id")));

-- ─── 4. v_guest_active_bookings: append expected_arrival_at ──────────────────
-- Full reproduction of the 20260505000003 definition with the new column
-- appended last on BOTH union branches (pre-arrival branch reads it from the
-- booking; in-house branch returns NULL — ETA is meaningless after check-in).
CREATE OR REPLACE VIEW "public"."v_guest_active_bookings" AS
 SELECT "b"."id" AS "booking_id",
    "b"."hotel_id",
    "b"."code" AS "booking_code",
    "b"."status" AS "booking_status",
    "h"."name" AS "hotel_name",
    "h"."slug" AS "hotel_slug",
    "h"."city" AS "hotel_city",
    "h"."phone" AS "hotel_phone",
    "h"."wa_display_number" AS "hotel_whatsapp",
    "h"."email" AS "hotel_email",
    NULL::"uuid" AS "primary_stay_id",
    COALESCE("rs"."room_numbers", 'Unassigned'::"text") AS "room_numbers_display",
    COALESCE("rs"."room_ids", '{}'::"uuid"[]) AS "room_ids",
    COALESCE("rs"."room_types", '{}'::"text"[]) AS "room_types",
    COALESCE("rs"."room_count", (0)::bigint) AS "room_count",
    '[]'::"jsonb" AS "rooms_detail",
    'arriving'::"public"."stay_status" AS "status",
    "b"."scheduled_checkin_at" AS "checkin_min",
    "b"."scheduled_checkin_at" AS "checkin_max",
    "b"."scheduled_checkout_at" AS "checkout_min",
    "b"."scheduled_checkout_at" AS "checkout_max",
    false AS "has_mixed_schedule",
    COALESCE("ceil"((EXTRACT(epoch FROM ("b"."scheduled_checkout_at" - "b"."scheduled_checkin_at")) / (86400)::numeric)), (0)::numeric) AS "total_nights",
    "b"."scheduled_checkin_at" AS "check_in",
    "b"."scheduled_checkout_at" AS "check_out",
    COALESCE("ps"."total_amount", (0)::numeric) AS "total_amount",
    COALESCE("ps"."paid_amount", (0)::numeric) AS "paid_amount",
    (COALESCE("ps"."total_amount", (0)::numeric) - COALESCE("ps"."paid_amount", (0)::numeric)) AS "outstanding_balance",
    "b"."guest_id",
    "b"."updated_at" AS "last_updated",
    "pt"."token" AS "precheckin_token",
    "pt"."expires_at" AS "precheckin_expires_at",
    "pt"."used_at" AS "precheckin_used_at",
    "b"."expected_arrival_at"
   FROM (((("public"."bookings" "b"
     JOIN "public"."hotels" "h" ON (("h"."id" = "b"."hotel_id")))
     LEFT JOIN LATERAL ( SELECT "string_agg"("r"."number", ', '::"text" ORDER BY "r"."number") AS "room_numbers",
            "array_agg"(DISTINCT "r"."id") AS "room_ids",
            "array_agg"(DISTINCT "rt"."name") AS "room_types",
            "count"(DISTINCT "r"."id") AS "room_count"
           FROM (("public"."booking_rooms" "br"
             JOIN "public"."rooms" "r" ON (("r"."id" = "br"."room_id")))
             LEFT JOIN "public"."room_types" "rt" ON (("rt"."id" = "r"."room_type_id")))
          WHERE ("br"."booking_id" = "b"."id")) "rs" ON (true))
     LEFT JOIN LATERAL ( SELECT "pt_1"."token",
            "pt_1"."expires_at",
            "pt_1"."used_at"
           FROM "public"."precheckin_tokens" "pt_1"
          WHERE ("pt_1"."booking_id" = "b"."id")
          ORDER BY "pt_1"."created_at" DESC
         LIMIT 1) "pt" ON (true))
     LEFT JOIN LATERAL ( SELECT "ps_1"."total_amount",
            "ps_1"."paid_amount"
           FROM "public"."v_arrival_payment_state" "ps_1"
          WHERE ("ps_1"."booking_id" = "b"."id")
         LIMIT 1) "ps" ON (true))
  WHERE (("b"."status" = ANY (ARRAY['CONFIRMED'::"text", 'PRE_CHECKED_IN'::"text", 'PARTIALLY_CHECKED_IN'::"text"])) AND ("b"."guest_id" = "public"."current_guest_id"()) AND (NOT (EXISTS ( SELECT 1
           FROM "public"."stays" "s"
          WHERE ("s"."booking_id" = "b"."id")))))
UNION ALL
 SELECT "s"."booking_id",
    "s"."hotel_id",
    "b"."code" AS "booking_code",
    "b"."status" AS "booking_status",
    "h"."name" AS "hotel_name",
    "h"."slug" AS "hotel_slug",
    "h"."city" AS "hotel_city",
    "h"."phone" AS "hotel_phone",
    "h"."wa_display_number" AS "hotel_whatsapp",
    "h"."email" AS "hotel_email",
    COALESCE(("array_agg"("s"."id" ORDER BY "s"."created_at") FILTER (WHERE ("s"."status" = 'inhouse'::"public"."stay_status")))[1], ("array_agg"("s"."id" ORDER BY "s"."created_at"))[1]) AS "primary_stay_id",
    "string_agg"(DISTINCT "r"."number", ', '::"text" ORDER BY "r"."number") AS "room_numbers_display",
    "array_agg"(DISTINCT "r"."id") AS "room_ids",
    "array_remove"("array_agg"(DISTINCT "rt"."name"), NULL::"text") AS "room_types",
    "count"(DISTINCT "s"."id") AS "room_count",
    COALESCE("rooms"."rooms_detail", '[]'::"jsonb") AS "rooms_detail",
    'inhouse'::"public"."stay_status" AS "status",
    "min"("s"."scheduled_checkin_at") AS "checkin_min",
    "max"("s"."scheduled_checkin_at") AS "checkin_max",
    "min"("s"."scheduled_checkout_at") AS "checkout_min",
    "max"("s"."scheduled_checkout_at") AS "checkout_max",
    (("min"("s"."scheduled_checkin_at") <> "max"("s"."scheduled_checkin_at")) OR ("min"("s"."scheduled_checkout_at") <> "max"("s"."scheduled_checkout_at"))) AS "has_mixed_schedule",
    COALESCE("ceil"((EXTRACT(epoch FROM ("max"("s"."scheduled_checkout_at") - "min"("s"."scheduled_checkin_at"))) / (86400)::numeric)), (0)::numeric) AS "total_nights",
    "min"("s"."scheduled_checkin_at") AS "check_in",
    "max"("s"."scheduled_checkout_at") AS "check_out",
    COALESCE("ps"."total_amount", (0)::numeric) AS "total_amount",
    COALESCE("ps"."paid_amount", (0)::numeric) AS "paid_amount",
    (COALESCE("ps"."total_amount", (0)::numeric) - COALESCE("ps"."paid_amount", (0)::numeric)) AS "outstanding_balance",
    "s"."guest_id",
    "max"("s"."updated_at") AS "last_updated",
    "max"("pt"."token") AS "precheckin_token",
    "max"("pt"."expires_at") AS "precheckin_expires_at",
    "max"("pt"."used_at") AS "precheckin_used_at",
    NULL::timestamptz AS "expected_arrival_at"
   FROM ((((((("public"."stays" "s"
     JOIN "public"."bookings" "b" ON (("b"."id" = "s"."booking_id")))
     JOIN "public"."hotels" "h" ON (("h"."id" = "s"."hotel_id")))
     JOIN "public"."rooms" "r" ON (("r"."id" = "s"."room_id")))
     LEFT JOIN "public"."room_types" "rt" ON (("rt"."id" = "r"."room_type_id")))
     LEFT JOIN LATERAL ( SELECT "pt_1"."token",
            "pt_1"."expires_at",
            "pt_1"."used_at"
           FROM "public"."precheckin_tokens" "pt_1"
          WHERE ("pt_1"."booking_id" = "s"."booking_id")
          ORDER BY "pt_1"."created_at" DESC
         LIMIT 1) "pt" ON (true))
     LEFT JOIN LATERAL ( SELECT "ps_1"."total_amount",
            "ps_1"."paid_amount"
           FROM "public"."v_arrival_payment_state" "ps_1"
          WHERE ("ps_1"."booking_id" = "s"."booking_id")
         LIMIT 1) "ps" ON (true))
     LEFT JOIN ( SELECT "t"."booking_id",
            "t"."guest_id",
            "jsonb_agg"("t"."room_obj" ORDER BY "t"."room_number") AS "rooms_detail"
           FROM ( SELECT DISTINCT "s2"."booking_id",
                    "s2"."guest_id",
                    "r2"."number" AS "room_number",
                    "jsonb_build_object"('id', "s2"."id", 'room_id', "r2"."id", 'number', "r2"."number", 'status', "s2"."status", 'type', "rt2"."name", 'check_in', "s2"."scheduled_checkin_at", 'check_out', "s2"."scheduled_checkout_at") AS "room_obj"
                   FROM (("public"."stays" "s2"
                     JOIN "public"."rooms" "r2" ON (("r2"."id" = "s2"."room_id")))
                     LEFT JOIN "public"."room_types" "rt2" ON (("rt2"."id" = "r2"."room_type_id")))
                  WHERE ("s2"."status" = 'inhouse'::"public"."stay_status")) "t"
          GROUP BY "t"."booking_id", "t"."guest_id") "rooms" ON ((("rooms"."booking_id" = "s"."booking_id") AND ("rooms"."guest_id" = "s"."guest_id"))))
  WHERE (("s"."status" = 'inhouse'::"public"."stay_status") AND ("s"."guest_id" = "public"."current_guest_id"()))
  GROUP BY "s"."booking_id", "s"."hotel_id", "b"."code", "b"."status", "h"."id", "h"."name", "h"."slug", "h"."city", "h"."phone", "h"."wa_display_number", "h"."email", "s"."guest_id", "ps"."total_amount", "ps"."paid_amount", "rooms"."rooms_detail";

GRANT SELECT ON public.v_arrival_dashboard_rows, public.v_guest_active_bookings TO anon, authenticated, service_role;
