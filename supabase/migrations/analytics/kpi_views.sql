-- ============================================================
-- KPI VIEWS (Materialized & Regular)
-- ============================================================

-- 1. OWNER DASHBOARD KPIS (Materialized View)
DROP MATERIALIZED VIEW IF EXISTS public.owner_dashboard_kpis CASCADE;

CREATE MATERIALIZED VIEW public.owner_dashboard_kpis AS
WITH
today AS (
  SELECT
    (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date AS as_of_date
),

hotel_set AS (
  SELECT
    h.id   AS hotel_id,
    h.slug AS hotel_slug,
    h.name AS hotel_name
  FROM hotels h
),

-- Occupied rooms today
rooms_today AS (
  SELECT
    b.hotel_id,
    t.as_of_date,
    COUNT(*)::integer AS occupied_today
  FROM bookings b
  CROSS JOIN today t
  WHERE
    date(b.scheduled_checkin_at) <= t.as_of_date
    AND date(b.scheduled_checkout_at) > t.as_of_date
  GROUP BY b.hotel_id, t.as_of_date
),

-- Orders today
orders_today AS (
  SELECT
    o.hotel_id,
    t.as_of_date,
    COUNT(*)::integer AS orders_today,
    COALESCE(
      SUM(
        COALESCE(o.price,0) *
        GREATEST(COALESCE(o.qty,1),1)
      ),
      0
    ) AS revenue_today
  FROM orders o
  CROSS JOIN today t
  WHERE (o.created_at AT TIME ZONE 'Asia/Kolkata')::date = t.as_of_date
  GROUP BY o.hotel_id, t.as_of_date
),

-- Pickup last 7 days
pickup_7d AS (
  SELECT
    b.hotel_id,
    t.as_of_date,
    COUNT(*)::integer AS pickup_7d
  FROM bookings b
  CROSS JOIN today t
  WHERE
    date(b.scheduled_checkin_at) >= (t.as_of_date - INTERVAL '6 days')
    AND date(b.scheduled_checkin_at) <= t.as_of_date
  GROUP BY b.hotel_id, t.as_of_date
),

-- Rating last 30 days
rating_30d AS (
  SELECT
    r.hotel_id,
    t.as_of_date,
    AVG(r.rating)::numeric(4,2) AS avg_rating_30d
  FROM reviews r
  CROSS JOIN today t
  WHERE
    (r.created_at AT TIME ZONE 'Asia/Kolkata')::date >= (t.as_of_date - INTERVAL '30 days')
    AND (r.created_at AT TIME ZONE 'Asia/Kolkata')::date <= t.as_of_date
  GROUP BY r.hotel_id, t.as_of_date
),

final AS (
  SELECT
    h.hotel_id,
    h.hotel_slug,
    h.hotel_name,
    t.as_of_date,
    COALESCE(rt.occupied_today,0) AS occupied_today,
    COALESCE(ot.orders_today,0)   AS orders_today,
    COALESCE(ot.revenue_today,0)  AS revenue_today,
    COALESCE(pk.pickup_7d,0)      AS pickup_7d,
    r30.avg_rating_30d,
    NOW() AS updated_at
  FROM hotel_set h
  CROSS JOIN today t
  LEFT JOIN rooms_today rt ON rt.hotel_id = h.hotel_id AND rt.as_of_date = t.as_of_date
  LEFT JOIN orders_today ot ON ot.hotel_id = h.hotel_id AND ot.as_of_date = t.as_of_date
  LEFT JOIN pickup_7d pk ON pk.hotel_id = h.hotel_id AND pk.as_of_date = t.as_of_date
  LEFT JOIN rating_30d r30 ON r30.hotel_id = h.hotel_id AND r30.as_of_date = t.as_of_date
)

SELECT * FROM final;

-- Index for performance refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_dashboard_kpis_hotel_id ON public.owner_dashboard_kpis(hotel_id);


-- 2. OCCUPANCY SNAPSHOT (Live View)
CREATE OR REPLACE VIEW public.owner_hotel_occupancy_snapshot AS
SELECT
  h.id   AS hotel_id,
  h.slug AS hotel_slug,
  h.name AS hotel_name,
  h.rooms_total,

  COUNT(b.id) AS occupied_rooms,

  CASE
    WHEN COALESCE(h.rooms_total, 0) > 0 THEN
      ROUND(
        COUNT(b.id)::numeric
        / h.rooms_total::numeric * 100,
        1
      )
    ELSE 0::numeric
  END AS occupancy_percent

FROM hotels h
LEFT JOIN bookings b
  ON b.hotel_id = h.id
  AND b.scheduled_checkin_at <= now()
  AND b.scheduled_checkout_at > now()

GROUP BY
  h.id,
  h.slug,
  h.name,
  h.rooms_total;


-- 3. OCCUPANCY DAILY TREND (Live View)
CREATE OR REPLACE VIEW public.owner_hotel_occupancy_daily AS
WITH days AS (
  SELECT
    generate_series(
      (now()::date - INTERVAL '29 days')::timestamptz,
      now()::date::timestamptz,
      INTERVAL '1 day'
    ) AS day_start
)

SELECT
  h.id   AS hotel_id,
  h.slug AS hotel_slug,
  h.name AS hotel_name,
  h.rooms_total,

  d.day_start::date AS day,

  COUNT(b.id) AS occupied_rooms,

  CASE
    WHEN COALESCE(h.rooms_total, 0) > 0 THEN
      ROUND(
        COUNT(b.id)::numeric
        / h.rooms_total::numeric * 100,
        1
      )
    ELSE 0::numeric
  END AS occupancy_percent

FROM hotels h
CROSS JOIN days d

LEFT JOIN bookings b
  ON b.hotel_id = h.id
  AND b.scheduled_checkin_at <= d.day_start
  AND b.scheduled_checkout_at > d.day_start

GROUP BY
  h.id,
  h.slug,
  h.name,
  h.rooms_total,
  d.day_start

ORDER BY
  h.slug,
  d.day_start::date;

-- Grants
GRANT SELECT ON public.owner_dashboard_kpis TO authenticated;
GRANT SELECT ON public.owner_hotel_occupancy_snapshot TO authenticated;
GRANT SELECT ON public.owner_hotel_occupancy_daily TO authenticated;
