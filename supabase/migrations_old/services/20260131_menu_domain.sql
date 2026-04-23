-- ============================================================
-- MENU DOMAIN — FULL PRODUCTION GRADE SCHEMA (FINAL)
--
-- Supports:
--   • Menu categories
--   • Food items
--   • Dietary metadata (veg, jain, allergens, spice)
--   • Availability by day & time
--   • Internal kitchen notes
--   • Inline editing
--
-- Fully aligned with Owner & Kitchen admin screens
-- ============================================================


-- ============================================================
-- 1. MENU CATEGORIES (CANONICAL)
-- ============================================================
CREATE TABLE IF NOT EXISTS menu_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  hotel_id UUID NOT NULL
    REFERENCES hotels(id)
    ON DELETE CASCADE,

  key TEXT NOT NULL,               -- ALL_DAY, BREAKFAST, DINNER
  name TEXT NOT NULL,              -- All-day, Breakfast, Dinner

  display_order INT DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),

  CONSTRAINT menu_categories_hotel_key_uniq
    UNIQUE (hotel_id, key)
);


-- ============================================================
-- 2. MENU ITEMS (FOOD CATALOG)
-- ============================================================
CREATE TABLE IF NOT EXISTS menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  hotel_id UUID NOT NULL
    REFERENCES hotels(id)
    ON DELETE CASCADE,

  item_key TEXT NOT NULL,          -- stable external key
  name TEXT NOT NULL,

  category_id UUID
    REFERENCES menu_categories(id),

  price NUMERIC(10,2) NOT NULL,
  image_url TEXT,

  is_veg BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,

  display_order INT DEFAULT 0,

  -- Flexible dietary & UI metadata
  metadata JSONB NOT NULL DEFAULT '{}',
  -- Example:
  -- {
  --   "veg": true,
  --   "jain": false,
  --   "vegan": false,
  --   "spice_level": "medium",
  --   "allergens": ["nuts"]
  -- }

  -- Internal kitchen-only notes (NOT shown to guests)
  internal_notes TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),

  CONSTRAINT menu_items_hotel_itemkey_uniq
    UNIQUE (hotel_id, item_key)
);


-- ============================================================
-- 3. MENU ITEM AVAILABILITY (DAY + TIME WINDOW)
-- ============================================================
CREATE TABLE IF NOT EXISTS menu_item_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  menu_item_id UUID NOT NULL
    REFERENCES menu_items(id)
    ON DELETE CASCADE,

  day_of_week INT NOT NULL
    CHECK (day_of_week BETWEEN 1 AND 7),
    -- 1 = Monday, 7 = Sunday

  start_time TIME NOT NULL,
  end_time TIME NOT NULL,

  hide_outside_window BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMP NOT NULL DEFAULT now(),

  CONSTRAINT menu_item_day_unique
    UNIQUE (menu_item_id, day_of_week)
);


-- ============================================================
-- 4. INDEXES (PERFORMANCE & FILTERING)
-- ============================================================

-- Categories
CREATE INDEX IF NOT EXISTS idx_menu_categories_hotel
  ON menu_categories (hotel_id);

CREATE INDEX IF NOT EXISTS idx_menu_categories_active
  ON menu_categories (hotel_id, active);

-- Menu items
CREATE INDEX IF NOT EXISTS idx_menu_items_hotel
  ON menu_items (hotel_id);

CREATE INDEX IF NOT EXISTS idx_menu_items_category
  ON menu_items (category_id);

CREATE INDEX IF NOT EXISTS idx_menu_items_active
  ON menu_items (hotel_id, active);

-- Availability
CREATE INDEX IF NOT EXISTS idx_menu_item_availability_item
  ON menu_item_availability (menu_item_id);

-- Optional: enable later if metadata filtering grows
-- CREATE INDEX idx_menu_items_metadata
--   ON menu_items USING GIN (metadata);


-- ============================================================
-- 5. SAFETY & MIGRATION NOTES
-- ============================================================

-- • category_id is nullable for backward compatibility
-- • internal_notes is optional and kitchen-only
-- • metadata remains extensible for dietary flags
--
-- Future (run later, NOT now):
--   ALTER TABLE menu_items
--   ALTER COLUMN category_id SET NOT NULL;


-- ============================================================
-- END OF MENU DOMAIN SCHEMA — FINAL
-- ============================================================

-- ============================================================
-- 6. MIGRATION SAFETY (Auto-upgrade existing table)
-- ============================================================
DO $$
BEGIN
    -- Ensure columns exist if table was already created
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'menu_items') THEN
        ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
        ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS internal_notes TEXT;
        ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES menu_categories(id);
        ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT now();
        ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_url TEXT;
        
        -- Optional: Drop old columns if you want strict adherence, but safer to keep for now
        -- ALTER TABLE menu_items DROP COLUMN IF EXISTS category; 
    END IF;
END $$;

INSERT INTO menu_categories (hotel_id, key, name, display_order)
  ('139c6002-bdd7-4924-9db4-16f14e283d89', 'KIDS',      'Kids Menu',   8)
ON CONFLICT (hotel_id, key) DO NOTHING;

-- ============================================================
-- RPC: create_menu_item
-- Purpose: Create a menu item with availability (transactional)
-- Access: OWNER / ADMIN / KITCHEN_MANAGER
-- ============================================================

CREATE OR REPLACE FUNCTION create_menu_item(
    p_hotel_id UUID,
    p_name TEXT,
    p_category_id UUID,
    p_price NUMERIC,
    p_is_veg BOOLEAN,
    p_active BOOLEAN,
    p_metadata JSONB,
    p_internal_notes TEXT,
    p_availability_days INTEGER[],
    p_start_time TIME,
    p_end_time TIME,
    p_hide_outside BOOLEAN,
    p_image_url TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_item_id UUID;
    v_item_key TEXT;
BEGIN
    -- --------------------------------------------------------
    -- 0. AUTHORIZATION (role-table aware)
    -- --------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1
        FROM hotel_members hm
        JOIN hotel_member_roles hmr
          ON hmr.hotel_member_id = hm.id
        JOIN hotel_roles r
          ON r.id = hmr.role_id
        WHERE hm.hotel_id = p_hotel_id
          AND hm.user_id = auth.uid()
          AND r.code IN ('OWNER', 'ADMIN', 'KITCHEN_MANAGER')
    ) THEN
        RAISE EXCEPTION USING
            MESSAGE = 'Unauthorized menu item creation',
            ERRCODE = 'P0001';
    END IF;

    -- --------------------------------------------------------
    -- 1. BASIC VALIDATION
    -- --------------------------------------------------------
    IF p_name IS NULL OR trim(p_name) = '' THEN
        RAISE EXCEPTION USING
            MESSAGE = 'Item name cannot be empty',
            ERRCODE = 'P0002';
    END IF;

    IF p_price < 0 THEN
        RAISE EXCEPTION USING
            MESSAGE = 'Price must be non-negative',
            ERRCODE = 'P0002';
    END IF;

    IF p_start_time >= p_end_time THEN
        RAISE EXCEPTION USING
            MESSAGE = 'Start time must be before end time',
            ERRCODE = 'P0002';
    END IF;

    IF p_availability_days IS NOT NULL
       AND EXISTS (
           SELECT 1
           FROM unnest(p_availability_days) d
           WHERE d < 1 OR d > 7
       ) THEN
        RAISE EXCEPTION USING
            MESSAGE = 'Availability days must be between 1 (Mon) and 7 (Sun)',
            ERRCODE = 'P0002';
    END IF;

    -- --------------------------------------------------------
    -- 2. CATEGORY VALIDATION (hotel-scoped & active)
    -- --------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1
        FROM menu_categories mc
        WHERE mc.id = p_category_id
          AND mc.hotel_id = p_hotel_id
          AND mc.active = true
    ) THEN
        RAISE EXCEPTION USING
            MESSAGE = 'Invalid or inactive menu category',
            ERRCODE = 'P0003';
    END IF;

    -- --------------------------------------------------------
    -- 3. GENERATE ITEM KEY (system-owned)
    -- --------------------------------------------------------
    v_item_key :=
        UPPER(
          REGEXP_REPLACE(
            TRIM(p_name),
            '[^a-zA-Z0-9]+',
            '_',
            'g'
          )
        );

    -- --------------------------------------------------------
    -- 4. DUPLICATE KEY PROTECTION (per hotel)
    -- --------------------------------------------------------
    IF EXISTS (
        SELECT 1
        FROM menu_items
        WHERE hotel_id = p_hotel_id
          AND item_key = v_item_key
    ) THEN
        RAISE EXCEPTION USING
            MESSAGE = format('Menu item with name "%s" already exists', p_name),
            ERRCODE = 'P0004';
    END IF;

    -- --------------------------------------------------------
    -- 5. INSERT MENU ITEM
    -- --------------------------------------------------------
    INSERT INTO menu_items (
        hotel_id,
        item_key,
        name,
        category_id,
        price,
        is_veg,
        active,
        active,
        metadata,
        internal_notes,
        image_url
    )
    VALUES (
        p_hotel_id,
        v_item_key,
        p_name,
        p_category_id,
        p_price,
        p_is_veg,
        p_active,
        p_active,
        COALESCE(p_metadata, '{"veg":false,"jain":false,"vegan":false}'::jsonb),
        p_internal_notes,
        p_image_url
    )
    RETURNING id INTO v_item_id;

    -- --------------------------------------------------------
    -- 6. INSERT AVAILABILITY (optional)
    -- --------------------------------------------------------
    IF p_availability_days IS NOT NULL
       AND array_length(p_availability_days, 1) > 0 THEN

        INSERT INTO menu_item_availability (
            menu_item_id,
            day_of_week,
            start_time,
            end_time,
            hide_outside_window
        )
        SELECT
            v_item_id,
            d.day,
            p_start_time,
            p_end_time,
            p_hide_outside
        FROM unnest(p_availability_days) AS d(day);

    END IF;

    -- --------------------------------------------------------
    -- 7. RETURN CREATED ITEM ID
    -- --------------------------------------------------------
    RETURN v_item_id;
END;
$$;


-- ============================================================
-- PERMISSIONS
-- ============================================================
GRANT EXECUTE ON FUNCTION create_menu_item TO authenticated;


-- ============================================================
-- RPC: update_menu_item
-- Purpose: Full edit of menu item + availability
-- Access: OWNER / ADMIN / KITCHEN_MANAGER
-- ============================================================

CREATE OR REPLACE FUNCTION update_menu_item(
    p_item_id UUID,
    p_hotel_id UUID,
    p_name TEXT,
    p_category_id UUID,
    p_price NUMERIC,
    p_is_veg BOOLEAN,
    p_active BOOLEAN,
    p_metadata JSONB,
    p_internal_notes TEXT,
    p_availability_days INTEGER[],
    p_start_time TIME,
    p_end_time TIME,
    p_hide_outside BOOLEAN,
    p_image_url TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- --------------------------------------------------------
    -- 0. AUTHORIZATION
    -- --------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1
        FROM hotel_members hm
        JOIN hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
        JOIN hotel_roles r ON r.id = hmr.role_id
        JOIN menu_items mi ON mi.hotel_id = hm.hotel_id
        WHERE mi.id = p_item_id
          AND hm.hotel_id = p_hotel_id
          AND hm.user_id = auth.uid()
          AND r.code IN ('OWNER', 'ADMIN', 'KITCHEN_MANAGER')
    ) THEN
        RAISE EXCEPTION USING
            MESSAGE = 'Unauthorized menu item update',
            ERRCODE = 'P1001';
    END IF;

    -- --------------------------------------------------------
    -- 1. VALIDATION
    -- --------------------------------------------------------
    IF p_name IS NULL OR trim(p_name) = '' THEN
        RAISE EXCEPTION USING
            MESSAGE = 'Item name cannot be empty',
            ERRCODE = 'P1002';
    END IF;

    IF p_price < 0 THEN
        RAISE EXCEPTION USING
            MESSAGE = 'Price must be non-negative',
            ERRCODE = 'P1002';
    END IF;

    IF p_start_time >= p_end_time THEN
        RAISE EXCEPTION USING
            MESSAGE = 'Start time must be before end time',
            ERRCODE = 'P1002';
    END IF;

    IF p_availability_days IS NOT NULL
       AND EXISTS (
           SELECT 1 FROM unnest(p_availability_days) d
           WHERE d < 1 OR d > 7
       ) THEN
        RAISE EXCEPTION USING
            MESSAGE = 'Availability days must be between 1 and 7',
            ERRCODE = 'P1002';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM menu_categories
        WHERE id = p_category_id
          AND hotel_id = p_hotel_id
          AND active = true
    ) THEN
        RAISE EXCEPTION USING
            MESSAGE = 'Invalid or inactive category',
            ERRCODE = 'P1003';
    END IF;

    -- --------------------------------------------------------
    -- 2. UPDATE MENU ITEM (NO item_key change)
    -- --------------------------------------------------------
    UPDATE menu_items
    SET
        name = p_name,
        category_id = p_category_id,
        price = p_price,
        is_veg = p_is_veg,
        active = p_active,
        metadata = COALESCE(
          '{"veg":false,"jain":false,"vegan":false}'::jsonb || p_metadata,
          '{"veg":false,"jain":false,"vegan":false}'::jsonb
        ),
        internal_notes = p_internal_notes,
        image_url = p_image_url,
        updated_at = now()
    WHERE id = p_item_id
      AND hotel_id = p_hotel_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            MESSAGE = 'Menu item not found',
            ERRCODE = 'P1004';
    END IF;

    -- --------------------------------------------------------
    -- 3. REPLACE AVAILABILITY
    -- --------------------------------------------------------
    DELETE FROM menu_item_availability
    WHERE menu_item_id = p_item_id;

    IF p_availability_days IS NOT NULL
       AND array_length(p_availability_days, 1) > 0 THEN

        INSERT INTO menu_item_availability (
            menu_item_id,
            day_of_week,
            start_time,
            end_time,
            hide_outside_window
        )
        SELECT
            p_item_id,
            d.day,
            p_start_time,
            p_end_time,
            p_hide_outside
        FROM unnest(p_availability_days) AS d(day);

    END IF;
END;
$$;

REVOKE ALL ON FUNCTION update_menu_item FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_menu_item TO authenticated;


-- ============================================================
-- RPC: patch_menu_item
-- Purpose: Inline update of menu item fields
-- Access: OWNER / ADMIN / KITCHEN_MANAGER
-- ============================================================

CREATE OR REPLACE FUNCTION patch_menu_item(
    p_item_id UUID,
    p_hotel_id UUID,
    p_price NUMERIC DEFAULT NULL,
    p_active BOOLEAN DEFAULT NULL,
    p_category_id UUID DEFAULT NULL,
    p_is_veg BOOLEAN DEFAULT NULL,
    p_metadata JSONB DEFAULT NULL,
    p_internal_notes TEXT DEFAULT NULL,
    p_image_url TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- --------------------------------------------------------
    -- 0. AUTHORIZATION
    -- --------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1
        FROM hotel_members hm
        JOIN hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
        JOIN hotel_roles r ON r.id = hmr.role_id
        JOIN menu_items mi ON mi.hotel_id = hm.hotel_id
        WHERE mi.id = p_item_id
          AND hm.hotel_id = p_hotel_id
          AND hm.user_id = auth.uid()
          AND r.code IN ('OWNER', 'ADMIN', 'KITCHEN_MANAGER')
    ) THEN
        RAISE EXCEPTION USING
            MESSAGE = 'Unauthorized menu item update',
            ERRCODE = 'P2001';
    END IF;

    -- --------------------------------------------------------
    -- 1. FIELD VALIDATION (ONLY IF PROVIDED)
    -- --------------------------------------------------------
    IF p_price IS NOT NULL AND p_price < 0 THEN
        RAISE EXCEPTION USING
            MESSAGE = 'Price must be non-negative',
            ERRCODE = 'P2002';
    END IF;

    IF p_category_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM menu_categories
        WHERE id = p_category_id
          AND hotel_id = p_hotel_id
          AND active = true
    ) THEN
        RAISE EXCEPTION USING
            MESSAGE = 'Invalid or inactive category',
            ERRCODE = 'P2003';
    END IF;

    -- --------------------------------------------------------
    -- 2. PATCH UPDATE
    -- --------------------------------------------------------
    UPDATE menu_items
    SET
        price = COALESCE(p_price, price),
        active = COALESCE(p_active, active),
        category_id = COALESCE(p_category_id, category_id),
        is_veg = COALESCE(p_is_veg, is_veg),
        metadata = CASE
            WHEN p_metadata IS NULL THEN metadata
            ELSE metadata || p_metadata
        END,
        internal_notes = COALESCE(p_internal_notes, internal_notes),
        image_url = COALESCE(p_image_url, image_url),
        updated_at = now()
    WHERE id = p_item_id
      AND hotel_id = p_hotel_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            MESSAGE = 'Menu item not found',
            ERRCODE = 'P2004';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION patch_menu_item FROM PUBLIC;
GRANT EXECUTE ON FUNCTION patch_menu_item TO authenticated;


-- ============================================================
-- 7. MENU IMAGES STORAGE (Merged from 20260201_menu_images.sql)
-- ============================================================

-- Create storage bucket for menu images
INSERT INTO storage.buckets (id, name, public)
VALUES ('menu-images', 'menu-images', true)
ON CONFLICT (id) DO NOTHING;

-- Public read
DROP POLICY IF EXISTS "Public read menu images" ON storage.objects;
CREATE POLICY "Public read menu images"
ON storage.objects
FOR SELECT
USING (bucket_id = 'menu-images');

-- Authenticated upload — scoped by hotel path
DROP POLICY IF EXISTS "Upload menu images (scoped)" ON storage.objects;
CREATE POLICY "Upload menu images (scoped)"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'menu-images'
  AND name LIKE 'hotels/%/menu/%'
);

-- Authenticated update — same scope
DROP POLICY IF EXISTS "Update menu images (scoped)" ON storage.objects;
CREATE POLICY "Update menu images (scoped)"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'menu-images'
  AND name LIKE 'hotels/%/menu/%'
);

-- Authenticated delete — same scope
DROP POLICY IF EXISTS "Delete menu images (scoped)" ON storage.objects;
CREATE POLICY "Delete menu images (scoped)"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'menu-images'
  AND name LIKE 'hotels/%/menu/%'
);
