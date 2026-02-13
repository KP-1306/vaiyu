-- Re-create v_guest_food_orders view with corrected permissions/schema
DROP VIEW IF EXISTS v_guest_food_orders CASCADE;

-- Ensure food_order_sla_state is referenced correctly
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

-- Removed 7-day filter to show all orders during stay
-- WHERE fo.created_at >= now() - interval '7 days'

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

-- Key Fix: Grant permissions explicitly
GRANT SELECT ON v_guest_food_orders TO anon;
GRANT SELECT ON v_guest_food_orders TO authenticated;
