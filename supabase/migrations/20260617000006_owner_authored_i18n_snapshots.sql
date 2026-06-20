-- =====================================================================
-- Owner-authored content localization (Phase 2b — reads & food snapshot)
-- =====================================================================
-- Two concerns, both additive and non-disruptive:
--
--   (A) FOOD ORDERS freeze the localized dish name at order time, mirroring
--       how the English item_name is already frozen. Done with a BEFORE
--       INSERT trigger — NOT by editing create_food_order — so the live
--       ordering path is byte-for-byte unchanged and every insert path is
--       covered uniformly. Dish names have no canonical dictionary, so the
--       frozen owner override is the only Hindi source for dishes.
--
--   (B) SERVICE REQUESTS render the LIVE service label on guest surfaces
--       (v_guest_tickets, get_ticket_details both join services), so we
--       resolve the localized service name LIVE from services.name_i18n
--       (+ the canonical foodMenu:service.<key>.title localization in the
--       client), exactly as the FoodMenu services tab does. We therefore
--       expose services.key and services.name_i18n on those two surfaces;
--       there is no frozen tickets.title_i18n (it would be dead schema).
--
-- Reversible; depends on 20260617000005 (the *_i18n columns).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. food_order_items.item_name_i18n — frozen snapshot from menu_items
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."va_snapshot_food_item_i18n"()
RETURNS "trigger"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
  -- Respect an explicitly-provided value; otherwise freeze the menu item's
  -- current localized names. Never block the insert.
  IF NEW."item_name_i18n" IS NULL OR NEW."item_name_i18n" = '{}'::"jsonb" THEN
    SELECT COALESCE("mi"."name_i18n", '{}'::"jsonb")
      INTO NEW."item_name_i18n"
      FROM "public"."menu_items" "mi"
      WHERE "mi"."id" = NEW."menu_item_id";
    IF NEW."item_name_i18n" IS NULL THEN
      NEW."item_name_i18n" := '{}'::"jsonb";
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."va_snapshot_food_item_i18n"() OWNER TO "postgres";

DROP TRIGGER IF EXISTS "trg_snapshot_food_item_i18n" ON "public"."food_order_items";
CREATE TRIGGER "trg_snapshot_food_item_i18n"
  BEFORE INSERT ON "public"."food_order_items"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."va_snapshot_food_item_i18n"();

-- ---------------------------------------------------------------------
-- 2. get_ticket_details — expose services.key + services.name_i18n so the
--    guest request tracker can localize the live service label exactly
--    like the menu (override -> canonical key -> as-authored). Read-only
--    function; only adds two fields to the `service` object.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."get_ticket_details"("p_display_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'id', t.id,
    'display_id', t.display_id,
    'status', t.status,
    'created_at', t.created_at,
    'completed_at', t.completed_at,
    'description', t.description,
    'stay_id', t.stay_id,
    'current_assignee_id', t.current_assignee_id,
    'booking_code', st.booking_code,
    'sla_started_at', tss.sla_started_at,
    'service', jsonb_build_object(
      'key', s.key,
      'label', s.label,
      'name_i18n', COALESCE(s.name_i18n, '{}'::jsonb),
      'sla_minutes', s.sla_minutes,
      'description_en', s.description_en
    ),
    'room', CASE WHEN r.id IS NOT NULL THEN jsonb_build_object('number', r.number) ELSE null END,
    'zone', CASE WHEN z.id IS NOT NULL THEN jsonb_build_object('id', z.id, 'name', z.name) ELSE null END,
    'attachments', (
       SELECT coalesce(jsonb_agg(jsonb_build_object('file_path', file_path, 'created_at', created_at)), '[]'::jsonb)
       FROM ticket_attachments ta
       WHERE ta.ticket_id = t.id
    )
  ) INTO v_result
  FROM tickets t
  JOIN services s ON s.id = t.service_id
  LEFT JOIN stays st ON st.id = t.stay_id
  LEFT JOIN rooms r ON r.id = t.room_id
  LEFT JOIN hotel_zones z ON z.id = t.zone_id
  LEFT JOIN ticket_sla_state tss ON tss.ticket_id = t.id
  WHERE t.display_id = p_display_id;

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. v_guest_tickets — expose service_key + service_name_i18n (live) so
--    the My Requests list can localize the service name the same way.
--    Definition reproduced verbatim from the baseline with two added
--    columns; security model unchanged (self-scopes via current_guest_id()).
-- ---------------------------------------------------------------------
-- New columns (service_key, service_name_i18n) are APPENDED at the end:
-- CREATE OR REPLACE VIEW can only add trailing columns, never reorder or
-- insert. Original columns keep their exact order/names.
CREATE OR REPLACE VIEW "public"."v_guest_tickets" AS
 SELECT "t"."id",
    "t"."display_id",
    "t"."status",
    "t"."reason_code",
    "t"."created_at",
    "t"."completed_at",
    "t"."cancelled_at",
    "t"."description",
    "t"."stay_id",
    "r"."number" AS "room_number",
    "s"."label" AS "service_name",
    "s"."sla_minutes",
    "tss"."sla_started_at",
    "z"."name" AS "zone_name",
        CASE
            WHEN ("t"."zone_id" IS NOT NULL) THEN "z"."name"
            ELSE "concat"('Room ', "r"."number")
        END AS "location_label",
    "st"."booking_code",
    "s"."key" AS "service_key",
    "s"."name_i18n" AS "service_name_i18n"
   FROM ((((("public"."tickets" "t"
     JOIN "public"."stays" "st" ON ((("st"."id" = "t"."stay_id") AND (("st"."guest_id" = "public"."current_guest_id"()) OR (EXISTS ( SELECT 1
           FROM "public"."stay_guests" "sg"
          WHERE (("sg"."stay_id" = "st"."id") AND ("sg"."guest_id" = "public"."current_guest_id"()))))))))
     JOIN "public"."services" "s" ON (("s"."id" = "t"."service_id")))
     LEFT JOIN "public"."ticket_sla_state" "tss" ON (("tss"."ticket_id" = "t"."id")))
     LEFT JOIN "public"."rooms" "r" ON (("r"."id" = "st"."room_id")))
     LEFT JOIN "public"."hotel_zones" "z" ON (("z"."id" = "t"."zone_id")))
  WHERE ("t"."status" = ANY (ARRAY['NEW'::"text", 'IN_PROGRESS'::"text", 'BLOCKED'::"text", 'COMPLETED'::"text", 'CANCELLED'::"text"]))
  ORDER BY "t"."created_at" DESC;

-- ---------------------------------------------------------------------
-- 4. v_guest_food_orders — surface item_name_i18n in the per-order items
--    json so guest order history can localize the frozen item names.
--    Reproduced verbatim from the baseline with one added field; security
--    model unchanged (self-scopes via current_guest_id()).
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW "public"."v_guest_food_orders" AS
 SELECT "fo"."id" AS "order_id",
    "fo"."display_id",
    "fo"."status",
    "fo"."created_at",
    "fo"."updated_at",
    "fo"."total_amount",
    "fo"."currency",
    "fo"."special_instructions",
    "r"."number" AS "room_number",
    "st"."booking_code",
    "sla"."sla_target_at",
    (EXTRACT(epoch FROM (("sla"."sla_target_at")::timestamp with time zone - "now"())) / (60)::numeric) AS "sla_minutes_remaining",
    "sla"."breached" AS "sla_breached",
    "items"."items",
    "items"."total_items"
   FROM (((("public"."food_orders" "fo"
     LEFT JOIN "public"."stays" "st" ON (("st"."id" = "fo"."stay_id")))
     LEFT JOIN "public"."rooms" "r" ON (("r"."id" = "fo"."room_id")))
     LEFT JOIN "public"."food_order_sla_state" "sla" ON (("sla"."food_order_id" = "fo"."id")))
     LEFT JOIN LATERAL ( SELECT "count"(*) AS "total_items",
            COALESCE("jsonb_agg"("jsonb_build_object"('name', "food_order_items"."item_name", 'name_i18n', "food_order_items"."item_name_i18n", 'quantity', "food_order_items"."quantity", 'price', "food_order_items"."total_price")) FILTER (WHERE ("food_order_items"."id" IS NOT NULL)), '[]'::"jsonb") AS "items"
           FROM "public"."food_order_items"
          WHERE ("food_order_items"."food_order_id" = "fo"."id")) "items" ON (true))
  WHERE (("st"."guest_id" = "public"."current_guest_id"()) OR (EXISTS ( SELECT 1
           FROM "public"."stay_guests" "sg"
          WHERE (("sg"."stay_id" = "st"."id") AND ("sg"."guest_id" = "public"."current_guest_id"())))))
  GROUP BY "fo"."id", "fo"."display_id", "fo"."status", "fo"."created_at", "fo"."updated_at", "fo"."total_amount", "fo"."currency", "fo"."special_instructions", "r"."number", "st"."booking_code", "sla"."sla_target_at", "sla"."breached", "items"."items", "items"."total_items";
