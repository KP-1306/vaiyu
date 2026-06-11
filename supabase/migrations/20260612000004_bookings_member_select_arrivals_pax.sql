-- Guest Details Drawer (arrivals board) — two enablers.
--
-- 1) bookings member SELECT. bookings has RLS enabled but only guest-scoped
--    SELECT policies (verified in pg_policy: "Guests can see their stays" /
--    "Guests can view own bookings" / "Guests see their own bookings"). Staff
--    surfaces have only ever read bookings through owner views and SECURITY
--    DEFINER RPCs, so a direct client read by staff returns 0 rows. The drawer
--    reads the booking row directly (email, special_requests, pax, guest_id),
--    so members need a tenant-scoped SELECT. Same shape as
--    leads_select_for_members. Side effect (intended): the arrivals board's
--    existing realtime subscription on bookings starts delivering events to
--    staff — postgres_changes respects SELECT RLS.
--
-- 2) Real guest count for the arrivals board. The Rooms/Guests cell showed
--    rooms_total * 2 (hardcoded in OwnerArrivals.tsx) because the view exposes
--    no pax fields, while bookings.adults_total/children_total hold the real
--    values (create_walkin_v2 writes them; online bookings default 1/0).
--    Expose them so the UI can stop fabricating. Columns are appended last —
--    legal for CREATE OR REPLACE VIEW.

-- ─── 1. bookings: tenant-scoped member SELECT ────────────────────────────────
DROP POLICY IF EXISTS bookings_select_for_members ON public.bookings;
CREATE POLICY bookings_select_for_members ON public.bookings
  FOR SELECT TO authenticated
  USING (public.vaiyu_is_hotel_member(hotel_id));

-- ─── 2. v_arrival_dashboard_rows: append real pax columns ────────────────────
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
    "b"."children_total"
   FROM (((("public"."v_owner_arrivals_dashboard" "a"
     LEFT JOIN "public"."v_arrival_payment_state" "p" ON (("p"."booking_id" = "a"."booking_id")))
     LEFT JOIN "public"."v_arrival_guest_labels" "l" ON (("l"."booking_id" = "a"."booking_id")))
     LEFT JOIN "public"."bookings" "b" ON (("b"."id" = "a"."booking_id")))
     LEFT JOIN ( SELECT "br"."booking_id",
            "min"("h"."minutes_remaining") AS "cleaning_minutes_remaining"
           FROM ("public"."booking_rooms" "br"
             JOIN "public"."v_arrival_housekeeping_eta" "h" ON (("h"."room_id" = "br"."room_id")))
          GROUP BY "br"."booking_id") "hk" ON (("hk"."booking_id" = "a"."booking_id")));
