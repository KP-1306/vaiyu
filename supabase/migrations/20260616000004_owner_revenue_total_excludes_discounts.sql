-- 20260616000004_owner_revenue_total_excludes_discounts.sql
--
-- FIX: owner_revenue_daily_v.total_revenue could be LESS than room_revenue.
--
-- 20260616000002 defined total_revenue = room + fnb + service + ADJUSTMENT,
-- i.e. NET of discounts (ADJUSTMENT entries are negative for discounts). On a
-- day with a discount, the net Total fell below the gross Room figure — which
-- is nonsensical in the "Total vs Room vs F&B" breakdown the overview shows
-- (Total must equal the sum of the streams plotted), and contradicts the KPI
-- card subtitle "Room + F&B for the selected period".
--
-- Hospitality reporting convention: Room / F&B / Service revenue are reported
-- GROSS; discounts are a separate contra-revenue line, not folded into the
-- per-stream total. So:
--   total_revenue = room_revenue + fnb_revenue + service_revenue   (no ADJUSTMENT)
-- This guarantees total_revenue >= each component and matches the chart's
-- mental model. room_revenue/fnb/service stay gross (consistent with ADR/RevPAR,
-- which use gross ROOM_CHARGE). Discounts remain in the ledger (ADJUSTMENT) and
-- can be surfaced as their own Net/Discounts metric later if needed.
--
-- Only the total_revenue expression changes; all columns/order/types identical
-- → CREATE OR REPLACE safe, consumers (overview, ADR/RevPAR, dashboard trend)
-- unaffected except Total now reads correctly.

CREATE OR REPLACE VIEW public.owner_revenue_daily_v AS
WITH charges_daily AS (
  SELECT
    fe.hotel_id,
    (date_trunc('day', fe.created_at))::date AS day,
    SUM(fe.amount) FILTER (WHERE fe.entry_type = 'ROOM_CHARGE')    AS room_revenue,
    SUM(fe.amount) FILTER (WHERE fe.entry_type = 'FOOD_CHARGE')    AS fnb_revenue,
    SUM(fe.amount) FILTER (WHERE fe.entry_type = 'SERVICE_CHARGE') AS service_revenue,
    SUM(fe.amount) FILTER (WHERE fe.entry_type = 'TAX')            AS tax_amount,
    -SUM(fe.amount) FILTER (WHERE fe.entry_type IN ('PAYMENT','REFUND')) AS payments_received
  FROM public.folio_entries fe
  GROUP BY fe.hotel_id, (date_trunc('day', fe.created_at))::date
),
rooms_sold_by_day AS (
  SELECT se.hotel_id, se.day, (count(DISTINCT se.room_id))::integer AS rooms_sold
  FROM (
    SELECT s.hotel_id, s.room_id, (gs.d)::date AS day
    FROM public.stays s
    CROSS JOIN LATERAL generate_series(
      ((date_trunc('day', s.scheduled_checkin_at))::date)::timestamptz,
      (((date_trunc('day', s.scheduled_checkout_at) - '1 day'::interval))::date)::timestamptz,
      '1 day'::interval
    ) gs(d)
    WHERE s.scheduled_checkin_at IS NOT NULL AND s.scheduled_checkout_at IS NOT NULL
  ) se
  GROUP BY se.hotel_id, se.day
),
rooms_per_hotel AS (
  SELECT rooms.hotel_id, (count(*))::integer AS rooms_available
  FROM public.rooms
  GROUP BY rooms.hotel_id
)
SELECT
  c.hotel_id,
  c.day,
  rph.rooms_available,
  COALESCE(rs.rooms_sold, 0)               AS rooms_sold,
  COALESCE(c.room_revenue, 0.0)            AS room_revenue,
  COALESCE(c.fnb_revenue, 0.0)             AS fnb_revenue,
  COALESCE(c.service_revenue, 0.0)         AS service_revenue,
  COALESCE(c.tax_amount, 0.0)              AS tax_amount,
  -- Gross revenue across streams (room + F&B + service). Excludes tax
  -- (pass-through) AND discounts (ADJUSTMENT) so Total >= each component.
  (COALESCE(c.room_revenue, 0.0)
   + COALESCE(c.fnb_revenue, 0.0)
   + COALESCE(c.service_revenue, 0.0))     AS total_revenue,
  COALESCE(c.payments_received, 0.0)       AS payments_received
FROM charges_daily c
LEFT JOIN rooms_per_hotel  rph ON rph.hotel_id = c.hotel_id
LEFT JOIN rooms_sold_by_day rs ON rs.hotel_id = c.hotel_id AND rs.day = c.day;

COMMENT ON VIEW public.owner_revenue_daily_v IS
  'Daily owner revenue from folio_entries. room/fnb/service are GROSS; '
  'total_revenue = room+fnb+service (excludes tax AND discounts, so Total >= '
  'each component). Occupancy unchanged. See 20260616000004 (supersedes _002 total).';
