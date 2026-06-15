-- 20260616000002_owner_revenue_from_folio.sql
--
-- FIX A CONFIRMED REVENUE BUG + make the folio ledger the single source of
-- truth for owner revenue reporting.
--
-- THE BUG (confirmed in code 2026-06-16):
--   owner_revenue_daily_v.room_revenue was SUM(orders.price) from the `orders`
--   table — but `orders` is the FOOD/SERVICE ordering table (item_key, qty,
--   price, room). So "room_revenue" was actually F&B/service revenue, and the
--   ADR (room_revenue/rooms_sold) and RevPAR (room_revenue/rooms_available)
--   pages built on this view have been WRONG. The dead legacy backend behind
--   the revenue overview (fetchOwnerRevenue) hid that this view was the only
--   live revenue source, and it was mis-sourced.
--
-- THE FIX:
--   Source revenue from public.folio_entries — the authoritative ledger of what
--   each guest was actually charged, which also reconciles with PAYMENT entries.
--   Sign conventions are the documented ledger ones (see
--   20260612000005_fix_arrival_payment_state_payment_sign): charge types
--   (ROOM_CHARGE/FOOD_CHARGE/SERVICE_CHARGE/TAX/ADJUSTMENT) are stored POSITIVE,
--   PAYMENT/REFUND stored NEGATIVE.
--
--   • room_revenue   = SUM(ROOM_CHARGE)         ← corrects ADR + RevPAR
--   • fnb_revenue    = SUM(FOOD_CHARGE)          (NEW)
--   • service_revenue= SUM(SERVICE_CHARGE)       (NEW)
--   • tax_amount     = SUM(TAX)                  (NEW; excluded from revenue)
--   • total_revenue  = room + fnb + service + ADJUSTMENT (net of discounts),
--                      EXCLUDING tax (tax is pass-through, not revenue) (NEW)
--   • payments_received = -SUM(PAYMENT,REFUND)   (NEW; positive net inflow)
--
--   Revenue is attributed to folio_entries.created_at::date (the posting date),
--   the same grain the ledger records — consistent with the per-booking
--   breakdown views. rooms_sold / rooms_available occupancy logic is REUSED
--   UNCHANGED from the previous definition (only the revenue source was wrong).
--
-- SAFETY (non-breaking):
--   • CREATE OR REPLACE keeps the first five output columns identical
--     (hotel_id, day, rooms_available, rooms_sold, room_revenue) in the same
--     order and types, appending the new columns — so the only consumers
--     (the ADR + RevPAR pages, which select day,rooms_available,rooms_sold,
--     room_revenue) keep working and are silently corrected. Grants are
--     preserved by CREATE OR REPLACE.
--   • Money numbers shown on ADR/RevPAR WILL CHANGE — they were wrong; this
--     corrects them.

CREATE OR REPLACE VIEW public.owner_revenue_daily_v AS
WITH charges_daily AS (
  SELECT
    fe.hotel_id,
    (date_trunc('day', fe.created_at))::date AS day,
    SUM(fe.amount) FILTER (WHERE fe.entry_type = 'ROOM_CHARGE')    AS room_revenue,
    SUM(fe.amount) FILTER (WHERE fe.entry_type = 'FOOD_CHARGE')    AS fnb_revenue,
    SUM(fe.amount) FILTER (WHERE fe.entry_type = 'SERVICE_CHARGE') AS service_revenue,
    SUM(fe.amount) FILTER (WHERE fe.entry_type = 'TAX')            AS tax_amount,
    SUM(fe.amount) FILTER (WHERE fe.entry_type = 'ADJUSTMENT')     AS adjustment_amount,
    -SUM(fe.amount) FILTER (WHERE fe.entry_type IN ('PAYMENT','REFUND')) AS payments_received
  FROM public.folio_entries fe
  GROUP BY fe.hotel_id, (date_trunc('day', fe.created_at))::date
),
-- Occupancy (rooms sold per day) — REUSED UNCHANGED from the prior definition.
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
  -- ── appended breakdown (new) ──
  COALESCE(c.fnb_revenue, 0.0)             AS fnb_revenue,
  COALESCE(c.service_revenue, 0.0)         AS service_revenue,
  COALESCE(c.tax_amount, 0.0)              AS tax_amount,
  (COALESCE(c.room_revenue, 0.0)
   + COALESCE(c.fnb_revenue, 0.0)
   + COALESCE(c.service_revenue, 0.0)
   + COALESCE(c.adjustment_amount, 0.0))   AS total_revenue,
  COALESCE(c.payments_received, 0.0)       AS payments_received
FROM charges_daily c
LEFT JOIN rooms_per_hotel  rph ON rph.hotel_id = c.hotel_id
LEFT JOIN rooms_sold_by_day rs ON rs.hotel_id = c.hotel_id AND rs.day = c.day;

COMMENT ON VIEW public.owner_revenue_daily_v IS
  'Daily owner revenue from the folio ledger (folio_entries). room_revenue=ROOM_CHARGE '
  '(corrected from the old orders-table mis-source), plus fnb/service/tax/total/payments. '
  'total_revenue excludes tax. Occupancy (rooms_sold/available) unchanged. See 20260616000002.';
