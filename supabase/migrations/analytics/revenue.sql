-- ============================================================
-- ANALYTICS: Revenue & Occupancy
-- ============================================================

-- Daily Revenue View
-- Usage: Owner Booking Pickup and Revenue Charts
CREATE OR REPLACE VIEW owner_revenue_daily_v AS
WITH
orders_daily AS (
  SELECT
    o.hotel_id,
    date_trunc('day', o.closed_at)::date AS day,
    SUM(COALESCE(o.price, 0))            AS room_revenue
  FROM orders o
  WHERE o.closed_at IS NOT NULL
  GROUP BY o.hotel_id, date_trunc('day', o.closed_at)::date
),

rooms_sold_by_day AS (
  SELECT
    se.hotel_id,
    se.day,
    COUNT(DISTINCT se.room_id)::integer AS rooms_sold
  FROM (
    SELECT
      s.hotel_id,
      s.room_id,
      gs.d::date AS day
    FROM stays s
    CROSS JOIN LATERAL generate_series(
      date_trunc('day', s.check_in_start)::date,
      (date_trunc('day', s.check_out_end) - interval '1 day')::date,
      interval '1 day'
    ) gs(d)
    WHERE
      s.check_in_start IS NOT NULL
      AND s.check_out_end IS NOT NULL
  ) se
  GROUP BY se.hotel_id, se.day
),

rooms_per_hotel AS (
  SELECT
    hotel_id,
    COUNT(*)::integer AS rooms_available
  FROM rooms
  GROUP BY hotel_id
)

SELECT
  od.hotel_id,
  od.day,
  r.rooms_available,
  COALESCE(rs.rooms_sold, 0)      AS rooms_sold,
  COALESCE(od.room_revenue, 0.0)  AS room_revenue
FROM orders_daily od
LEFT JOIN rooms_per_hotel r
  ON r.hotel_id = od.hotel_id
LEFT JOIN rooms_sold_by_day rs
  ON rs.hotel_id = od.hotel_id
 AND rs.day = od.day;

GRANT SELECT ON owner_revenue_daily_v TO authenticated;
