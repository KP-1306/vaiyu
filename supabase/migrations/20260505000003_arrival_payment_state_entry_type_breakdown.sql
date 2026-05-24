-- ============================================================
-- VAiyu – v_arrival_payment_state: classify by entry_type
-- ============================================================
-- Bug: the prior view classified folio entries by sign — every
-- positive amount became "charge", every negative amount became
-- "payment". That worked back when folios held only food orders
-- (positive) and payments (negative). After the walk-in tax
-- migration (20260505000001), bookings now also carry:
--   • ROOM_CHARGE   = positive
--   • ADJUSTMENT    = negative for discounts
--   • TAX           = positive
-- The old view treated ADJUSTMENT (a discount) as a *payment
-- received*, which is why guest-facing dashboards showed
-- "Payments Received: −₹630" when nothing had been paid yet.
--
-- Fix: classify by entry_type, not sign. Existing column
-- semantics are preserved for old data (which only had food
-- charges + payments) — the math comes out the same. New breakdown
-- columns let the UI show proper labels (Room / Tax / Discount /
-- Food / Service / Payments) instead of dumping everything into a
-- "Food & Dining" bucket.
-- ============================================================

DROP VIEW IF EXISTS public.v_arrival_payment_state CASCADE;

CREATE VIEW public.v_arrival_payment_state AS
SELECT
  b.id AS booking_id,

  -- Net charges owed to the hotel (charges + adjustments). ADJUSTMENT
  -- entries flow in with their stored sign (negative for discounts), so
  -- this is the post-discount, pre-payment amount.
  COALESCE(SUM(fe.amount) FILTER (
    WHERE fe.entry_type IN ('ROOM_CHARGE','FOOD_CHARGE','SERVICE_CHARGE','TAX','ADJUSTMENT')
  ), 0)::numeric AS total_amount,

  -- Actual money received from the guest (PAYMENT positive, REFUND
  -- negative — net inflow). For OLD bookings whose payment legs were
  -- recorded as plain negative entries without a type, the same dataset
  -- generally had entry_type='PAYMENT', so behavior is unchanged.
  COALESCE(SUM(fe.amount) FILTER (
    WHERE fe.entry_type IN ('PAYMENT','REFUND')
  ), 0)::numeric AS paid_amount,

  -- Outstanding balance (what the guest still owes).
  (
    COALESCE(SUM(fe.amount) FILTER (
      WHERE fe.entry_type IN ('ROOM_CHARGE','FOOD_CHARGE','SERVICE_CHARGE','TAX','ADJUSTMENT')
    ), 0)
    -
    COALESCE(SUM(fe.amount) FILTER (
      WHERE fe.entry_type IN ('PAYMENT','REFUND')
    ), 0)
  )::numeric AS pending_amount,

  CASE
    WHEN (
      COALESCE(SUM(fe.amount) FILTER (
        WHERE fe.entry_type IN ('ROOM_CHARGE','FOOD_CHARGE','SERVICE_CHARGE','TAX','ADJUSTMENT')
      ), 0)
      -
      COALESCE(SUM(fe.amount) FILTER (
        WHERE fe.entry_type IN ('PAYMENT','REFUND')
      ), 0)
    ) > 0 THEN true
    ELSE false
  END AS payment_pending,

  -- ─── New breakdown columns (let the UI render proper labels) ───
  COALESCE(SUM(fe.amount) FILTER (WHERE fe.entry_type = 'ROOM_CHARGE'),    0)::numeric AS room_charges,
  COALESCE(SUM(fe.amount) FILTER (WHERE fe.entry_type = 'FOOD_CHARGE'),    0)::numeric AS food_charges,
  COALESCE(SUM(fe.amount) FILTER (WHERE fe.entry_type = 'SERVICE_CHARGE'), 0)::numeric AS service_charges,
  COALESCE(SUM(fe.amount) FILTER (WHERE fe.entry_type = 'TAX'),            0)::numeric AS tax_amount,
  -- Discounts are stored as negative ADJUSTMENT entries; expose the
  -- positive magnitude so the UI can render `−₹{discount_amount}`.
  COALESCE(-SUM(fe.amount) FILTER (WHERE fe.entry_type = 'ADJUSTMENT' AND fe.amount < 0), 0)::numeric AS discount_amount,
  -- Positive ADJUSTMENT entries (rare — fees / surcharges added by staff).
  COALESCE(SUM(fe.amount) FILTER (WHERE fe.entry_type = 'ADJUSTMENT' AND fe.amount > 0), 0)::numeric AS surcharge_amount

FROM public.bookings b
LEFT JOIN public.folio_entries fe ON fe.booking_id = b.id
GROUP BY b.id;

ALTER VIEW public.v_arrival_payment_state OWNER TO postgres;
GRANT SELECT ON public.v_arrival_payment_state TO anon, authenticated, service_role;

COMMENT ON VIEW public.v_arrival_payment_state IS
  'Per-booking folio rollup. total_amount = net charges (post-discount, pre-payment). paid_amount = net payments (PAYMENT − REFUND). Breakdown columns let UIs render proper line labels.';
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
    COALESCE("p"."paid_amount", (0)::numeric) AS "paid_amount"
   FROM ((("public"."v_owner_arrivals_dashboard" "a"
     LEFT JOIN "public"."v_arrival_payment_state" "p" ON (("p"."booking_id" = "a"."booking_id")))
     LEFT JOIN "public"."v_arrival_guest_labels" "l" ON (("l"."booking_id" = "a"."booking_id")))
     LEFT JOIN ( SELECT "br"."booking_id",
            "min"("h"."minutes_remaining") AS "cleaning_minutes_remaining"
           FROM ("public"."booking_rooms" "br"
             JOIN "public"."v_arrival_housekeeping_eta" "h" ON (("h"."room_id" = "br"."room_id")))
          GROUP BY "br"."booking_id") "hk" ON (("hk"."booking_id" = "a"."booking_id")));

CREATE OR REPLACE VIEW "public"."v_arrival_dashboard_summary" AS
 SELECT "hotel_id",
    "count"(*) AS "total_arrivals",
    "count"(*) FILTER (WHERE ("arrival_operational_state" = ANY (ARRAY['CHECKED_IN'::"text", 'PARTIALLY_ARRIVED'::"text"]))) AS "arrived",
    "count"(*) FILTER (WHERE "rooms_ready_for_arrival") AS "ready_to_checkin",
    "count"(*) FILTER (WHERE ("arrival_operational_state" = 'WAITING_ROOM_ASSIGNMENT'::"text")) AS "waiting_room_assignment",
    "count"(*) FILTER (WHERE "payment_pending") AS "payment_pending",
    "count"(*) FILTER (WHERE "vip_flag") AS "vip_today"
   FROM "public"."v_arrival_dashboard_rows"
  GROUP BY "hotel_id";


ALTER VIEW "public"."v_arrival_dashboard_summary" OWNER TO "postgres";

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
    "pt"."used_at" AS "precheckin_used_at"
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
    "max"("pt"."used_at") AS "precheckin_used_at"
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


ALTER VIEW "public"."v_guest_active_bookings" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_guest_active_bookings" IS 'Aggregated view of active journeys: Confirmed future bookings (bookings) and currently checked-in stays (stays).';


GRANT SELECT ON public.v_arrival_dashboard_rows, public.v_arrival_dashboard_summary, public.v_guest_active_bookings TO anon, authenticated, service_role;
