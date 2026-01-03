
ALTER TABLE public.stays
ADD COLUMN room_id UUID;

ALTER TABLE public.stays
ADD CONSTRAINT stays_room_id_fkey
FOREIGN KEY (room_id)
REFERENCES public.rooms(id)
ON DELETE RESTRICT;

UPDATE public.stays
SET room_id = '1459cf9c-34a7-4980-ba42-2f84ecdad565'
WHERE room_id IS NULL;

ALTER TABLE public.stays
ALTER COLUMN room_id SET NOT NULL;





DROP VIEW public.user_stay_detail;


CREATE OR REPLACE VIEW public.user_stay_detail AS
SELECT
  s.id                 AS stay_id,
  s.guest_id           AS user_id,
  s.hotel_id,
  s.check_in_start     AS checkin_at,
  s.check_out_end      AS checkout_at,
  s.status::text       AS status,
  s.source,
  r.number             AS room_number,
  h.name               AS hotel_name,
  h.slug
FROM stays s
JOIN hotels h
  ON h.id = s.hotel_id
JOIN rooms r
  ON r.id = s.room_id
WHERE s.guest_id = auth.uid();


CREATE OR REPLACE VIEW public.owner_revenue_daily_v AS
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


 ALTER TABLE public.stays
DROP COLUMN room;
