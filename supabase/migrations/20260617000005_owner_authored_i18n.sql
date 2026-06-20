-- =====================================================================
-- Owner-authored content localization (Phase 2a — names)
-- =====================================================================
-- Adds an OPTIONAL per-row localized-name override to owner-authored
-- catalog rows (menu items, services, room types) plus FROZEN snapshot
-- columns on the two transactional snapshots that already freeze the
-- English label (food_order_items.item_name, tickets.title).
--
-- Design contract — additive & non-disruptive:
--   * Every column is jsonb NOT NULL DEFAULT '{}'::jsonb, added with
--     IF NOT EXISTS. Existing rows get '{}'. Nothing reads these until
--     the application read paths are wired; render falls back to the
--     existing name/label whenever the override is empty, so current
--     behaviour (English + the canonical key-based Hindi already shipped)
--     is byte-identical until an owner explicitly supplies Hindi.
--   * Keys are clamped to the supported language set {en, hi} and values
--     must be strings, enforced by an IMMUTABLE validator usable in CHECK.
--   * No MACHINE TRANSLATION. These columns only ever hold owner-supplied
--     (or owner-confirmed offline-transliterated) text.
--
-- Reversible: dropping the columns + validator restores the prior schema.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Validator — keys ⊆ {en, hi}, all values are strings, object shape.
--    IMMUTABLE so it can back a CHECK constraint. '{}' is valid (no keys).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."va_i18n_keys_valid"("p" "jsonb")
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT "p" IS NOT NULL
     AND "jsonb_typeof"("p") = 'object'
     AND NOT EXISTS (
       SELECT 1
       FROM "jsonb_each"("p") AS e
       WHERE e."key" NOT IN ('en', 'hi')
          OR "jsonb_typeof"(e."value") <> 'string'
     );
$$;

ALTER FUNCTION "public"."va_i18n_keys_valid"("jsonb") OWNER TO "postgres";

COMMENT ON FUNCTION "public"."va_i18n_keys_valid"("jsonb") IS
  'True when the jsonb is an object whose keys are a subset of {en,hi} and whose values are all strings. Backs the *_i18n CHECK constraints. ''{}'' is valid.';

-- ---------------------------------------------------------------------
-- 1. menu_items.name_i18n — owner-authored dish-name override
-- ---------------------------------------------------------------------
ALTER TABLE "public"."menu_items"
  ADD COLUMN IF NOT EXISTS "name_i18n" "jsonb" NOT NULL DEFAULT '{}'::"jsonb";

ALTER TABLE "public"."menu_items"
  DROP CONSTRAINT IF EXISTS "menu_items_name_i18n_valid";
ALTER TABLE "public"."menu_items"
  ADD CONSTRAINT "menu_items_name_i18n_valid"
  CHECK ("public"."va_i18n_keys_valid"("name_i18n"));

COMMENT ON COLUMN "public"."menu_items"."name_i18n" IS
  'Optional owner-supplied localized display names, e.g. {"hi":"पनीर टिक्का"}. Empty = render the English "name" as authored. Never machine-translated.';

-- ---------------------------------------------------------------------
-- 2. services.name_i18n — owner-authored service-label override
--    (base display column is "label"; "label_en" already holds the
--    canonical English for system services.)
-- ---------------------------------------------------------------------
ALTER TABLE "public"."services"
  ADD COLUMN IF NOT EXISTS "name_i18n" "jsonb" NOT NULL DEFAULT '{}'::"jsonb";

ALTER TABLE "public"."services"
  DROP CONSTRAINT IF EXISTS "services_name_i18n_valid";
ALTER TABLE "public"."services"
  ADD CONSTRAINT "services_name_i18n_valid"
  CHECK ("public"."va_i18n_keys_valid"("name_i18n"));

COMMENT ON COLUMN "public"."services"."name_i18n" IS
  'Optional owner-supplied localized service labels. Empty = canonical key localization (foodMenu:service.<key>.title) or the as-authored "label". Never machine-translated.';

-- NOTE: deliberately NO room_types.name_i18n column (yet). Room-type names
-- are already localized for guests by the localizeRoomType() transliteration
-- dictionary (shipped Phase 1), and there is no owner room-type editor to
-- write an override into — adding the column now would be unused dead schema.
-- The owner-supplied room-type override is a documented triggered-deferral:
-- add this column + an editor + guest read-resolution together WHEN a hotel
-- needs a custom room-type name the dictionary cannot render.

-- ---------------------------------------------------------------------
-- 3. food_order_items.item_name_i18n — FROZEN snapshot taken at order
--    time, mirroring the existing frozen "item_name" English copy.
-- ---------------------------------------------------------------------
ALTER TABLE "public"."food_order_items"
  ADD COLUMN IF NOT EXISTS "item_name_i18n" "jsonb" NOT NULL DEFAULT '{}'::"jsonb";

ALTER TABLE "public"."food_order_items"
  DROP CONSTRAINT IF EXISTS "food_order_items_item_name_i18n_valid";
ALTER TABLE "public"."food_order_items"
  ADD CONSTRAINT "food_order_items_item_name_i18n_valid"
  CHECK ("public"."va_i18n_keys_valid"("item_name_i18n"));

COMMENT ON COLUMN "public"."food_order_items"."item_name_i18n" IS
  'Frozen-at-order-time copy of menu_items.name_i18n, so guest order history shows the localized name as it was when ordered. Mirrors the frozen English "item_name". Empty = fall back to "item_name".';

-- NOTE: deliberately NO tickets.title_i18n column. The guest request
-- surfaces (v_guest_tickets, get_ticket_details) render the LIVE service
-- label (services.label), not the frozen tickets.title — so the localized
-- service name is resolved live from services.name_i18n (+ canonical key
-- localization) at read time, exactly as the FoodMenu services tab does.
-- A frozen ticket-title snapshot would be unused dead schema, so it is
-- omitted. (Food orders DO freeze item_name_i18n above, because the guest
-- food-order views read the frozen food_order_items.item_name, and dish
-- names have no canonical dictionary.)
