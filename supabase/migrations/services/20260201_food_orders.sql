-- ============================================================
-- FOOD ORDER DOMAIN — FINAL PRODUCTION GRADE SCHEMA (LOCKED)
--
-- Design principles:
--   • Event-driven (events are source of truth)
--   • No BLOCK / UNBLOCK
--   • No SLA pause / resume / restart
--   • No SLA exemption
--   • Line items are first-class (snapshot-safe)
--   • SLA is monotonic and honest
-- ============================================================


-- ============================================================
-- 1. FOOD ORDERS (Order Head / Workflow Anchor)
-- ============================================================
CREATE TABLE food_orders (
  id UUID PRIMARY KEY,

  hotel_id UUID NOT NULL,
  stay_id UUID NOT NULL,
  room_id UUID,

  status TEXT NOT NULL CHECK (
    status IN (
      'CREATED',
      'ACCEPTED',
      'PREPARING',
      'READY',
      'DELIVERED',
      'CANCELLED'
    )
  ),

  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',

  cancelled_reason TEXT,
  cancelled_by TEXT CHECK (
    cancelled_by IN ('GUEST','KITCHEN','SYSTEM')
  ),

  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);


-- ============================================================
-- 2. FOOD ORDER ITEMS (LINE ITEMS — SNAPSHOT SAFE)
-- ============================================================
CREATE TABLE food_order_items (
  id UUID PRIMARY KEY,

  food_order_id UUID NOT NULL
    REFERENCES food_orders(id)
    ON DELETE CASCADE,

  -- Snapshot references (menu may change later)
  menu_item_id UUID NOT NULL,
  item_name TEXT NOT NULL,

  quantity INT NOT NULL CHECK (quantity > 0),

  unit_price NUMERIC(10,2) NOT NULL,
  total_price NUMERIC(10,2) NOT NULL,

  modifiers JSONB NOT NULL DEFAULT '{}',

  status TEXT NOT NULL CHECK (
    status IN (
      'PENDING',
      'PREPARING',
      'READY',
      'CANCELLED'
    )
  ),

  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()

  -- NOTE:
  -- We intentionally do NOT enforce:
  --   total_price = unit_price * quantity
  -- to allow modifiers / discounts.
);


-- ============================================================
-- 3. FOOD ORDER EVENTS (SOURCE OF TRUTH)
-- ============================================================
CREATE TABLE food_order_events (
  id UUID PRIMARY KEY,

  food_order_id UUID NOT NULL
    REFERENCES food_orders(id)
    ON DELETE CASCADE,

  event_type TEXT NOT NULL,

  actor_type TEXT NOT NULL CHECK (
    actor_type IN ('GUEST','KITCHEN','RUNNER','SYSTEM')
  ),

  actor_id UUID,

  payload JSONB NOT NULL DEFAULT '{}',

  created_at TIMESTAMP NOT NULL DEFAULT now()
);


-- ============================================================
-- 3a. EVENT TYPE CONSTRAINT (LOCKED TAXONOMY)
-- ============================================================
ALTER TABLE food_order_events
ADD CONSTRAINT food_order_events_event_type_check
CHECK (
  event_type IN (

    -- Order lifecycle (monotonic)
    'ORDER_CREATED',
    'ORDER_ACCEPTED',
    'ORDER_PREPARING',
    'ORDER_READY',
    'ORDER_DELIVERED',
    'ORDER_CANCELLED',

    -- Item-level lifecycle
    'ITEM_ADDED',
    'ITEM_STARTED',
    'ITEM_READY',
    'ITEM_CANCELLED',

    -- Delay / failure signalling (NO blocking semantics)
    'ORDER_DELAYED',
    'ORDER_FAILED',

    -- Assignment / responsibility
    'KITCHEN_ASSIGNED',
    'RUNNER_ASSIGNED',

    -- Communication
    'COMMENT_ADDED'
  )
);


-- ============================================================
-- 3b. TERMINAL EVENT SAFETY
-- Prevents double delivery / cancel
-- ============================================================
CREATE UNIQUE INDEX ux_food_order_single_terminal_event
ON food_order_events (food_order_id)
WHERE event_type IN ('ORDER_DELIVERED','ORDER_CANCELLED');


-- ============================================================
-- 4. FOOD ORDER SLA STATE (MONOTONIC, DERIVED)
-- ============================================================
CREATE TABLE food_order_sla_state (
  food_order_id UUID PRIMARY KEY
    REFERENCES food_orders(id)
    ON DELETE CASCADE,

  sla_started_at TIMESTAMP,       -- ORDER_ACCEPTED
  sla_target_at TIMESTAMP,        -- promised delivery time
  sla_completed_at TIMESTAMP,     -- ORDER_DELIVERED

  breached BOOLEAN NOT NULL DEFAULT false,
  breached_at TIMESTAMP,
  breach_reason TEXT,             -- KITCHEN_DELAY, SYSTEM_FAILURE

  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),

  CONSTRAINT food_order_sla_valid_lifecycle
    CHECK (
      NOT (sla_completed_at IS NOT NULL AND sla_started_at IS NULL)
    )
);

-- IMPORTANT:
--   • SLA never pauses
--   • SLA never resumes
--   • SLA never restarts
--   • SLA is never exempted


-- ============================================================
-- 5. FOOD ORDER ASSIGNMENTS (RESPONSIBILITY HISTORY)
-- ============================================================
CREATE TABLE food_order_assignments (
  id UUID PRIMARY KEY,

  food_order_id UUID NOT NULL
    REFERENCES food_orders(id)
    ON DELETE CASCADE,

  role TEXT NOT NULL CHECK (
    role IN ('KITCHEN','RUNNER')
  ),

  hotel_member_id UUID NOT NULL
    REFERENCES hotel_members(id),

  assigned_at TIMESTAMP NOT NULL DEFAULT now(),
  unassigned_at TIMESTAMP
);

CREATE UNIQUE INDEX ux_food_order_kitchen_assignment
ON food_order_assignments(food_order_id)
WHERE role = 'KITCHEN';

CREATE UNIQUE INDEX ux_food_order_runner_assignment
ON food_order_assignments(food_order_id)
WHERE role = 'RUNNER';


-- ============================================================
-- 6. FOOD ORDER PAYMENTS (OPTIONAL, EXTENSIBLE)
-- ============================================================
CREATE TABLE food_order_payments (
  id UUID PRIMARY KEY,

  food_order_id UUID NOT NULL
    REFERENCES food_orders(id)
    ON DELETE CASCADE,

  amount NUMERIC(10,2) NOT NULL,
  method TEXT,   -- CASH, ROOM_CHARGE, CARD, UPI (open for future)
  status TEXT NOT NULL CHECK (
    status IN ('PENDING','PAID','FAILED','REFUNDED')
  ),

  created_at TIMESTAMP NOT NULL DEFAULT now()
);


-- ============================================================
-- 7. OPTIONAL: SERVICE ESCALATION BRIDGE
-- Food failure → Service ticket
-- ============================================================
-- Uncomment only if not already present

-- ALTER TABLE tickets
-- ADD COLUMN food_order_id UUID
-- REFERENCES food_orders(id);


-- ============================================================
-- 8. INDEXES (PERFORMANCE & DASHBOARDS)
-- ============================================================
CREATE INDEX idx_food_orders_status
  ON food_orders(status);

CREATE INDEX idx_food_orders_stay
  ON food_orders(stay_id);

CREATE INDEX idx_food_order_items_order
  ON food_order_items(food_order_id);

CREATE INDEX idx_food_order_events_order
  ON food_order_events(food_order_id);

CREATE INDEX idx_food_order_sla_breached
  ON food_order_sla_state(breached);


-- ============================================================
-- END OF FOOD ORDER DOMAIN — FINAL & LOCKED
-- ============================================================

-- ============================================================
-- 9. HOTEL ROLES SEED (KITCHEN / MANAGER / RUNNER)
-- ============================================================
INSERT INTO hotel_roles (
  id,
  hotel_id,
  code,
  name,
  description,
  is_active,
  created_at,
  updated_at
)
VALUES (
  gen_random_uuid(),
  '139c6002-bdd7-4924-9db4-16f14e283d89',
  'KITCHEN',
  'Kitchen Staff',
  'Prepares food and manages kitchen orders',
  true,
  now(),
  now()
)
ON CONFLICT (hotel_id, code) DO NOTHING;

INSERT INTO hotel_roles (
  id,
  hotel_id,
  code,
  name,
  description,
  is_active,
  created_at,
  updated_at
)
VALUES (
  gen_random_uuid(),
  '139c6002-bdd7-4924-9db4-16f14e283d89',
  'KITCHEN_MANAGER',
  'Kitchen Manager',
  'Manages kitchen operations and food orders',
  true,
  now(),
  now()
)
ON CONFLICT (hotel_id, code) DO NOTHING;

INSERT INTO hotel_roles (
  id,
  hotel_id,
  code,
  name,
  description,
  is_active,
  created_at,
  updated_at
)
VALUES (
  gen_random_uuid(),
  '139c6002-bdd7-4924-9db4-16f14e283d89',
  'RUNNER',
  'Food Runner',
  'Delivers food orders to guest rooms',
  true,
  now(),
  now()
)
ON CONFLICT (hotel_id, code) DO NOTHING;


INSERT INTO hotel_roles (
  id,
  hotel_id,
  code,
  name,
  description,
  is_active,
  created_at,
  updated_at
)
VALUES (
  gen_random_uuid(),
  '139c6002-bdd7-4924-9db4-16f14e283d89',
  'ADMIN',
  'Administrator',
  'Administrative access across departments',
  true,
  now(),
  now()
)
ON CONFLICT (hotel_id, code) DO NOTHING;


-- ============================================================
-- 10. HOTEL MEMBER ↔ ROLE MAPPING (SEED)
-- ============================================================
INSERT INTO hotel_member_roles (
  hotel_member_id,
  role_id
)
SELECT m.id, r.id
FROM hotel_members m
JOIN hotel_roles r ON r.code = 'ADMIN' AND r.hotel_id = '139c6002-bdd7-4924-9db4-16f14e283d89'
WHERE m.id IN (
  '147b6e57-ce3c-483b-8b19-d2b1bb5fdb58',
  '18ced61e-1508-47f0-bb6d-a3e39e5fdb7d',
  '8e593253-ca12-40cc-9f35-53bb1146dfba',
  '9f9b8b4f-2b06-4c80-8a05-dd34ac89c451',
  'dde18a07-fccd-4255-805f-9ab03704c046',
  'f0a60133-439f-4ea2-9236-bde74feee105'
)
ON CONFLICT (hotel_member_id, role_id) DO NOTHING;

INSERT INTO hotel_member_roles (
  hotel_member_id,
  role_id
)
SELECT m.id, r.id
FROM hotel_members m
JOIN hotel_roles r ON r.code = 'KITCHEN' AND r.hotel_id = '139c6002-bdd7-4924-9db4-16f14e283d89'
WHERE m.id IN (
  '147b6e57-ce3c-483b-8b19-d2b1bb5fdb58',
  '18ced61e-1508-47f0-bb6d-a3e39e5fdb7d',
  '8e593253-ca12-40cc-9f35-53bb1146dfba',
  '9f9b8b4f-2b06-4c80-8a05-dd34ac89c451',
  'dde18a07-fccd-4255-805f-9ab03704c046',
  'f0a60133-439f-4ea2-9236-bde74feee105'
)
ON CONFLICT (hotel_member_id, role_id) DO NOTHING;

INSERT INTO hotel_member_roles (
  hotel_member_id,
  role_id
)
SELECT m.id, r.id
FROM hotel_members m
JOIN hotel_roles r ON r.code = 'RUNNER' AND r.hotel_id = '139c6002-bdd7-4924-9db4-16f14e283d89'
WHERE m.id IN (
  '8e593253-ca12-40cc-9f35-53bb1146dfba',
  '9f9b8b4f-2b06-4c80-8a05-dd34ac89c451',
  'dde18a07-fccd-4255-805f-9ab03704c046',
  'f0a60133-439f-4ea2-9236-bde74feee105'
)
ON CONFLICT (hotel_member_id, role_id) DO NOTHING;


-- ============================================================
-- 11. DISPLAY ID GENERATION (PUBLIC TRACKING)
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS food_order_display_id_seq START 1000;

ALTER TABLE food_orders
ADD COLUMN IF NOT EXISTS display_id TEXT UNIQUE;

-- Trigger to auto-generate
CREATE OR REPLACE FUNCTION generate_food_order_display_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.display_id IS NULL OR NEW.display_id = '' THEN
    NEW.display_id := 'ORD-' || nextval('food_order_display_id_seq');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_food_order_display_id
BEFORE INSERT ON food_orders
FOR EACH ROW
EXECUTE FUNCTION generate_food_order_display_id();


-- ============================================================
-- 12. REALTIME & PERMISSIONS
-- ============================================================

-- A. Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE food_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE food_order_items;
ALTER PUBLICATION supabase_realtime ADD TABLE food_order_assignments;
ALTER PUBLICATION supabase_realtime ADD TABLE food_order_sla_state;

-- B. Enable RLS
ALTER TABLE food_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_order_sla_state ENABLE ROW LEVEL SECURITY;

-- C. Public Tracking Policies (Anon Access by ID)
-- Food Orders
DROP POLICY IF EXISTS "Public view food orders" ON food_orders;
CREATE POLICY "Public view food orders" ON food_orders 
FOR SELECT USING (true);

-- Food Items
DROP POLICY IF EXISTS "Public view food items" ON food_order_items;
CREATE POLICY "Public view food items" ON food_order_items 
FOR SELECT USING (true);

-- SLA State
DROP POLICY IF EXISTS "Public view food sla" ON food_order_sla_state;
CREATE POLICY "Public view food sla" ON food_order_sla_state 
FOR SELECT USING (true);

-- Rooms (Public view needed for tracking page)
DO $$
BEGIN
    DROP POLICY IF EXISTS "Public view rooms" ON rooms;
    CREATE POLICY "Public view rooms" ON rooms
    FOR SELECT TO anon, authenticated
    USING (true);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- D. Grants
GRANT SELECT ON food_orders TO anon, authenticated;
GRANT SELECT ON food_order_items TO anon, authenticated;
GRANT SELECT ON food_order_sla_state TO anon, authenticated;
GRANT SELECT ON rooms TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
