-- Guest portal pax: stop fabricating party size on the guest stay screens.
--
-- Problem (verified in code, not guessed):
--   user_recent_stays exposes NO party-size column at all. The guest screens
--   read a non-existent `data.guests` and fall through to hardcoded constants:
--     - GuestNewStayDetails.tsx:  guests: data.guests   || 1  → always "1 Adult"
--     - GuestNewCheckout.tsx:     guests: active.guests || 2  → always "2 Adults"
--   So every guest sees a fixed, fabricated number regardless of how many people
--   actually booked — a solo traveller sees "2 Adults" at checkout, a family of
--   four sees "1 Adult" on their stay page. Same class of defect as the parked
--   Rewards page: a fake number presented as fact.
--
-- Authoritative source already exists and is already trusted by staff:
--   bookings.adults_total / bookings.children_total (DEFAULT 1 / 0; written by
--   create_walkin_v2, defaulted on online bookings). The arrivals board and the
--   GuestDetailsDrawer already read exactly these via v_arrival_dashboard_rows
--   (migration 20260612000004). The guest portal is the one surface not wired
--   to them.
--
-- Fix: surface adults_total / children_total down the guest view chain
--   (v_guest_stay_hero_base → v_guest_stay_hero → user_recent_stays) by joining
--   the stay's bookings row. stays.booking_id is reliably populated by every
--   stay-creation path (walk-in create_walkin_v2, online arrival check-in), so
--   the join mirrors the arrivals board's own join (bookings.id = booking_id).
--   It is a PK join → at most one match → no row fan-out. LEFT JOIN keeps stays
--   with a missing/legacy booking visible (pax NULL → UI shows the truthful
--   minimum of 1 adult, the same DEFAULT the column carries).
--
-- Security: these views are owner-run (no security_invoker; verified — only
--   baseline defines them, no later flip). The WHERE clause in v_guest_stay_hero
--   already restricts rows to the calling guest's own stays; the bookings join
--   only adds two non-sensitive integer counts, no new PII. New columns are
--   appended last, so CREATE OR REPLACE VIEW is legal for all three.

-- ─── 1. v_guest_stay_hero_base: join bookings, append pax counts ──────────────
CREATE OR REPLACE VIEW "public"."v_guest_stay_hero_base" AS
 SELECT "s"."id" AS "stay_id",
    "s"."guest_id",
    "s"."hotel_id",
    "s"."booking_code",
    "s"."is_vip",
    "s"."is_active",
    "h"."name" AS "hotel_name",
    "h"."slug" AS "hotel_slug",
    "h"."city" AS "hotel_city",
    "h"."phone" AS "hotel_phone",
    "h"."wa_display_number" AS "hotel_whatsapp",
    "h"."email" AS "hotel_email",
    "r"."id" AS "room_id",
    "r"."number" AS "room_number",
    "rt"."name" AS "room_type",
    "s"."status" AS "stay_status",
        CASE
            WHEN ("s"."status" = 'arriving'::"public"."stay_status") THEN 'UPCOMING'::"text"
            WHEN ("s"."status" = 'inhouse'::"public"."stay_status") THEN 'ACTIVE'::"text"
            WHEN ("s"."status" = 'checked_out'::"public"."stay_status") THEN 'COMPLETED'::"text"
            WHEN ("s"."status" = 'cancelled'::"public"."stay_status") THEN 'CANCELLED'::"text"
            WHEN ("s"."status" = 'no_show'::"public"."stay_status") THEN 'NO_SHOW'::"text"
            ELSE 'OTHER'::"text"
        END AS "lifecycle_phase",
        CASE
            WHEN ("s"."status" = 'arriving'::"public"."stay_status") THEN ('Your upcoming stay at '::"text" || "h"."name")
            WHEN ("s"."status" = 'inhouse'::"public"."stay_status") THEN ('Your stay at '::"text" || "h"."name")
            WHEN ("s"."status" = 'checked_out'::"public"."stay_status") THEN ('Your recent stay at '::"text" || "h"."name")
            WHEN ("s"."status" = 'cancelled'::"public"."stay_status") THEN ('Cancelled stay at '::"text" || "h"."name")
            ELSE ('Stay at '::"text" || "h"."name")
        END AS "hero_title",
    "s"."scheduled_checkin_at",
    "s"."scheduled_checkout_at",
    "s"."actual_checkin_at",
    "s"."actual_checkout_at",
    COALESCE("s"."actual_checkin_at", "s"."scheduled_checkin_at") AS "display_checkin_at",
        CASE
            WHEN ("s"."status" = 'checked_out'::"public"."stay_status") THEN COALESCE("s"."actual_checkout_at", "s"."scheduled_checkout_at")
            ELSE "s"."scheduled_checkout_at"
        END AS "display_checkout_at",
        CASE
            WHEN (("s"."status" = 'inhouse'::"public"."stay_status") AND ("s"."actual_checkin_at" IS NOT NULL)) THEN 'Checked-in'::"text"
            ELSE 'Check-in'::"text"
        END AS "checkin_label",
        CASE
            WHEN ("s"."status" = 'inhouse'::"public"."stay_status") THEN 'Checkout'::"text"
            ELSE 'Check-out'::"text"
        END AS "checkout_label",
    ("s"."status" = 'arriving'::"public"."stay_status") AS "can_checkin",
    ("s"."status" = 'inhouse'::"public"."stay_status") AS "can_request_service",
    ("s"."status" = 'inhouse'::"public"."stay_status") AS "can_express_checkout",
    ("s"."status" = 'inhouse'::"public"."stay_status") AS "can_order_food",
    ("s"."status" = ANY (ARRAY['inhouse'::"public"."stay_status", 'checked_out'::"public"."stay_status"])) AS "can_view_bill",
    ("s"."status" = 'checked_out'::"public"."stay_status") AS "can_download_invoice",
    ("s"."status" = 'checked_out'::"public"."stay_status") AS "can_book_again",
    ("s"."status" = 'arriving'::"public"."stay_status") AS "can_modify_booking",
    ("s"."status" = 'arriving'::"public"."stay_status") AS "can_cancel_booking",
        CASE
            WHEN ("s"."status" = 'inhouse'::"public"."stay_status") THEN 'success'::"text"
            WHEN ("s"."status" = 'arriving'::"public"."stay_status") THEN 'warning'::"text"
            WHEN ("s"."status" = 'checked_out'::"public"."stay_status") THEN 'neutral'::"text"
            WHEN ("s"."status" = 'cancelled'::"public"."stay_status") THEN 'error'::"text"
            WHEN ("s"."status" = 'no_show'::"public"."stay_status") THEN 'error'::"text"
            ELSE 'neutral'::"text"
        END AS "badge_variant",
        CASE
            WHEN ("s"."status" = 'inhouse'::"public"."stay_status") THEN '✓ Checked-in'::"text"
            WHEN ("s"."status" = 'arriving'::"public"."stay_status") THEN 'Upcoming'::"text"
            WHEN ("s"."status" = 'checked_out'::"public"."stay_status") THEN '✓ Completed'::"text"
            WHEN ("s"."status" = 'cancelled'::"public"."stay_status") THEN 'Cancelled'::"text"
            WHEN ("s"."status" = 'no_show'::"public"."stay_status") THEN 'No Show'::"text"
            ELSE NULL::"text"
        END AS "badge_text",
    "s"."created_at",
    "s"."updated_at",
    "bk"."adults_total",
    "bk"."children_total"
   FROM (((("public"."stays" "s"
     JOIN "public"."hotels" "h" ON (("h"."id" = "s"."hotel_id")))
     JOIN "public"."rooms" "r" ON (("r"."id" = "s"."room_id")))
     LEFT JOIN "public"."room_types" "rt" ON (("rt"."id" = "r"."room_type_id")))
     LEFT JOIN "public"."bookings" "bk" ON (("bk"."id" = "s"."booking_id")));

-- ─── 2. v_guest_stay_hero: pass the pax columns through ───────────────────────
CREATE OR REPLACE VIEW "public"."v_guest_stay_hero" AS
 SELECT "stay_id",
    "guest_id",
    "hotel_id",
    "booking_code",
    "is_vip",
    "is_active",
    "hotel_name",
    "hotel_slug",
    "hotel_city",
    "hotel_phone",
    "hotel_whatsapp",
    "hotel_email",
    "room_id",
    "room_number",
    "room_type",
    "stay_status",
    "lifecycle_phase",
    "hero_title",
    "scheduled_checkin_at",
    "scheduled_checkout_at",
    "actual_checkin_at",
    "actual_checkout_at",
    "display_checkin_at",
    "display_checkout_at",
    "checkin_label",
    "checkout_label",
    "can_checkin",
    "can_request_service",
    "can_express_checkout",
    "can_order_food",
    "can_view_bill",
    "can_download_invoice",
    "can_book_again",
    "can_modify_booking",
    "can_cancel_booking",
    "badge_variant",
    "badge_text",
    "created_at",
    "updated_at",
    "adults_total",
    "children_total"
   FROM "public"."v_guest_stay_hero_base" "h"
  WHERE (("guest_id" = "public"."current_guest_id"()) OR (EXISTS ( SELECT 1
           FROM "public"."stay_guests" "sg"
          WHERE (("sg"."stay_id" = "h"."stay_id") AND ("sg"."guest_id" = "public"."current_guest_id"())))));

-- ─── 3. user_recent_stays: expose the pax columns to the guest client ─────────
CREATE OR REPLACE VIEW "public"."user_recent_stays" AS
 SELECT "stay_id" AS "id",
    "guest_id",
    "hotel_id",
    "booking_code",
    "is_vip",
    "is_active",
    "stay_status" AS "status",
    "lifecycle_phase",
    "lifecycle_phase" AS "stay_phase",
    "hero_title",
    "hotel_name",
    "hotel_slug",
    "hotel_city",
    "hotel_phone",
    "hotel_whatsapp",
    "hotel_email",
    "room_id",
    "room_number",
    "room_type",
    "scheduled_checkin_at" AS "check_in",
    "scheduled_checkout_at" AS "check_out",
    "actual_checkin_at",
    "actual_checkout_at",
    "display_checkin_at",
    "display_checkout_at",
    "checkin_label",
    "checkout_label",
    "can_checkin",
    "can_request_service",
    "can_express_checkout",
    "can_order_food",
    "can_view_bill",
    "can_download_invoice",
    "can_book_again",
    "can_modify_booking",
    "can_cancel_booking",
    "badge_variant",
    "badge_text",
    NULL::numeric AS "bill_total",
    "created_at",
    "updated_at",
    "adults_total",
    "children_total"
   FROM "public"."v_guest_stay_hero";
