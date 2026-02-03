-- ============================================================
-- FOOD ORDER VIEWS (Read Models)
-- Production-grade, stateless, event-derived views
-- ============================================================

-- 1. KITCHEN QUEUE VIEW
-- Shows orders waiting for kitchen action.
DROP VIEW IF EXISTS v_kitchen_queue CASCADE;
CREATE OR REPLACE VIEW v_kitchen_queue AS
SELECT
  fo.id                AS order_id,
  fo.display_id,
  fo.hotel_id,
  fo.room_id,
  r.number             AS room_number, -- Joined for UI
  fo.status,
  fo.special_instructions,

  fo.created_at,
  fo.updated_at,

  sla.sla_started_at,
  sla.sla_target_at,

  -- SLA minutes remaining (NULL if not started)
  CASE
    WHEN sla.sla_started_at IS NULL THEN NULL
    ELSE EXTRACT(EPOCH FROM (sla.sla_target_at - now())) / 60
  END AS sla_minutes_remaining,

  -- Assigned kitchen staff (if accepted)
  ka.hotel_member_id AS assigned_kitchen_staff,

  items.total_items,
  items.total_amount,
  items.items -- This is the JSON array

FROM food_orders fo
LEFT JOIN rooms r ON r.id = fo.room_id
LEFT JOIN food_order_sla_state sla
  ON sla.food_order_id = fo.id

LEFT JOIN food_order_assignments ka
  ON ka.food_order_id = fo.id
  AND ka.role = 'KITCHEN'
  AND ka.unassigned_at IS NULL

-- LATERAL JOIN for safe aggregation
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS total_items,
    SUM(total_price) AS total_amount,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'name', item_name,
          'quantity', quantity,
          'modifiers', modifiers
        )
      ) FILTER (WHERE id IS NOT NULL),
      '[]'::jsonb
    ) AS items
  FROM food_order_items
  WHERE food_order_id = fo.id
) items ON true

WHERE fo.status IN ('CREATED','ACCEPTED','PREPARING')

GROUP BY
  fo.id,
  fo.display_id,
  fo.hotel_id,
  fo.room_id,
  r.number,
  fo.status,
  fo.special_instructions,
  fo.created_at,
  fo.updated_at,
  sla.sla_started_at,
  sla.sla_target_at,
  ka.hotel_member_id,
  items.total_items,
  items.total_amount,
  items.items;



-- 2. RUNNER QUEUE VIEW
-- Shows orders ready for delivery.
DROP VIEW IF EXISTS v_runner_queue CASCADE;
CREATE OR REPLACE VIEW v_runner_queue AS
SELECT
  fo.id                AS order_id,
  fo.display_id,
  fo.hotel_id,
  fo.room_id,
  r.number             AS room_number, -- Joined for UI
  fo.status,
  fo.special_instructions, -- Ensure this is carried over if it was added before

  fo.created_at, -- For UI timestamp
  fo.updated_at,

  sla.sla_target_at,
  EXTRACT(EPOCH FROM (sla.sla_target_at - now())) / 60
    AS sla_minutes_remaining,

  ra.hotel_member_id AS assigned_runner,
  COALESCE(p.full_name, 'Unassigned'::text) AS assigned_runner_name,

  items.total_items,
  items.total_amount,
  items.items -- JSON array

FROM food_orders fo
LEFT JOIN rooms r ON r.id = fo.room_id
JOIN food_order_sla_state sla
  ON sla.food_order_id = fo.id

LEFT JOIN food_order_assignments ra
  ON ra.food_order_id = fo.id
  AND ra.role = 'RUNNER'
  AND ra.unassigned_at IS NULL
LEFT JOIN hotel_members hm ON hm.id = ra.hotel_member_id
LEFT JOIN profiles p ON p.id = hm.user_id

-- LATERAL JOIN for safe aggregation
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS total_items,
    SUM(total_price) AS total_amount,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'name', item_name,
          'quantity', quantity,
          'modifiers', modifiers
        )
      ) FILTER (WHERE id IS NOT NULL),
      '[]'::jsonb
    ) AS items
  FROM food_order_items
  WHERE food_order_id = fo.id
) items ON true

WHERE fo.status = 'READY'

GROUP BY
  fo.id,
  fo.display_id,
  fo.hotel_id,
  fo.room_id,
  r.number,
  fo.status,
  fo.special_instructions,
  fo.created_at,
  fo.updated_at,
  sla.sla_target_at,
  ra.hotel_member_id,
  p.full_name,
  items.total_items,
  items.total_amount,
  items.items;



-- 3. MY ASSIGNED ORDERS VIEW (Kitchen / Runner)
-- Shows what I am responsible for right now.
DROP VIEW IF EXISTS v_my_food_orders CASCADE;
CREATE OR REPLACE VIEW v_my_food_orders AS
SELECT
  fo.id AS order_id,
  fo.display_id,
  fo.status,
  fo.created_at, -- For UI timestamp
  fo.updated_at, -- For status duration
  fo.room_id,
  r.number AS room_number, -- Joined for UI

  fa.hotel_member_id, -- Filter by this in UI/RLS
  fa.role,
  fa.assigned_at,

  sla.sla_target_at,
  EXTRACT(EPOCH FROM (sla.sla_target_at - now())) / 60
    AS sla_minutes_remaining,
    
  items.total_items,
  items.total_amount,
  items.items -- JSON array

FROM food_order_assignments fa
JOIN food_orders fo
  ON fo.id = fa.food_order_id
LEFT JOIN rooms r ON r.id = fo.room_id
LEFT JOIN food_order_sla_state sla
  ON sla.food_order_id = fo.id

-- LATERAL JOIN for safe aggregation
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS total_items,
    SUM(total_price) AS total_amount,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'name', item_name,
          'quantity', quantity,
          'modifiers', modifiers
        )
      ) FILTER (WHERE id IS NOT NULL),
      '[]'::jsonb
    ) AS items
  FROM food_order_items
  WHERE food_order_id = fo.id
) items ON true

WHERE fa.unassigned_at IS NULL
  -- Correct Role-Based Logic:
  -- Kitchen sees active work (ACCEPTED/PREPARING)
  -- Runner sees active work (READY) + completed deliveries (DELIVERED)
  AND (
      (fa.role = 'KITCHEN' AND fo.status IN ('ACCEPTED', 'PREPARING'))
      OR
      (fa.role = 'RUNNER' AND fo.status IN ('READY', 'DELIVERED'))
  )
  AND fo.updated_at >= date_trunc('day', now()) -- Rolling 24h window for history

GROUP BY
    fo.id,
    fo.display_id,
    fo.status,
    fo.special_instructions,
    fo.created_at,
    fo.updated_at,
    fo.room_id,
    r.number,
    fa.hotel_member_id,
    fa.role,
    fa.assigned_at,
    sla.sla_target_at,
    items.total_items,
    items.total_amount,
    items.items;


-- 4. SLA RISK LIST (Owner / Manager)
-- Shows orders that are about to breach or already breached.
DROP VIEW IF EXISTS v_food_orders_sla_risk CASCADE;
CREATE OR REPLACE VIEW v_food_orders_sla_risk AS
SELECT
  fo.id AS order_id,
  fo.status,
  fo.created_at, -- For UI timestamp
  fo.room_id,
  r.number AS room_number,

  sla.sla_target_at,
  sla.breached,

  EXTRACT(EPOCH FROM (sla.sla_target_at - now())) / 60
    AS minutes_to_breach

FROM food_orders fo
LEFT JOIN rooms r ON r.id = fo.room_id
JOIN food_order_sla_state sla
  ON sla.food_order_id = fo.id

WHERE fo.status IN ('ACCEPTED','PREPARING','READY')
  AND (
       sla.breached = true
       OR sla.sla_target_at < now() + interval '5 minutes'
  );

-- Grant access
GRANT SELECT ON v_kitchen_queue TO authenticated;
GRANT SELECT ON v_runner_queue TO authenticated;
GRANT SELECT ON v_my_food_orders TO authenticated;
GRANT SELECT ON v_food_orders_sla_risk TO authenticated;



-- 5. GUEST FOOD ORDERS VIEW
-- Allows guests to view their food orders by booking_code
DROP VIEW IF EXISTS v_guest_food_orders CASCADE;
CREATE OR REPLACE VIEW v_guest_food_orders AS
SELECT
  fo.id AS order_id,
  fo.display_id,
  fo.status,
  fo.created_at,
  fo.updated_at,
  fo.total_amount,
  fo.currency,
  fo.special_instructions,
  
  r.number AS room_number,
  st.booking_code,
  
  sla.sla_target_at,
  EXTRACT(EPOCH FROM (sla.sla_target_at - now())) / 60 AS sla_minutes_remaining,
  sla.breached AS sla_breached,
  
  -- Aggregate items as JSON
  items.items,
  items.total_items

FROM food_orders fo
LEFT JOIN stays st ON st.id = fo.stay_id
LEFT JOIN rooms r ON r.id = fo.room_id
LEFT JOIN food_order_sla_state sla ON sla.food_order_id = fo.id

-- LATERAL JOIN for items aggregation
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS total_items,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'name', item_name,
          'quantity', quantity,
          'price', total_price
        )
      ) FILTER (WHERE id IS NOT NULL),
      '[]'::jsonb
    ) AS items
  FROM food_order_items
  WHERE food_order_id = fo.id
) items ON true

-- Only show orders from the last 7 days for performance
WHERE fo.created_at >= now() - interval '7 days'

GROUP BY
  fo.id,
  fo.display_id,
  fo.status,
  fo.created_at,
  fo.updated_at,
  fo.total_amount,
  fo.currency,
  fo.special_instructions,
  r.number,
  st.booking_code,
  sla.sla_target_at,
  sla.breached,
  items.items,
  items.total_items;

-- Grant access
GRANT SELECT ON v_guest_food_orders TO anon;
GRANT SELECT ON v_guest_food_orders TO authenticated;
