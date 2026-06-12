-- Fix v_arrival_payment_state: payments were double-counted AGAINST the guest.
--
-- THE BUG (reproduced on local, observed in prod): trg_payment_to_folio writes
-- PAYMENT folio entries NEGATIVE (-NEW.amount) — the ledger convention where
-- charges are positive, payments negative, and the plain SUM of a booking's
-- entries IS the outstanding balance (collect_payment's own overpayment guard
-- uses exactly that plain SUM). This view, however, computed
--   pending = SUM(charges) - SUM(payments)
-- assuming payments POSITIVE. With stored -2200: 2200 - (-2200) = 4400 — every
-- rupee collected WIDENED the displayed balance by a rupee, and paid_amount
-- went negative so the PARTIAL/PAID badges never fired (always UNPAID).
--
-- Blast radius of the wrong sign (all corrected by this single view change —
-- no consumer compensates for it anywhere in web/src):
--   • OwnerArrivals balance pill: settled guests shown UNPAID at 2x amount
--   • GuestNewCheckout: balanceDue = total - priorPayments → guests who
--     already paid were asked for MORE at checkout
--   • GuestNewHome invoice: "Payments Received" line never rendered
--     (guarded by paid_amount > 0), grand total inflated
--   • FoodOrderTracker: balance due inflated
-- FolioDrawer was unaffected (it sums raw entries itself), which is why the
-- folio looked right while the board looked wrong.
--
-- THE FIX: derive both numbers from the ledger invariant instead of a sign
-- assumption:
--   pending_amount = SUM(amount) over ALL entry types  (charges + payments
--                    as stored — the same number collect_payment validates
--                    against, so the two can never diverge again)
--   paid_amount    = -SUM(PAYMENT/REFUND as stored)    (net inflow, positive;
--                    a future REFUND entry stored positive correctly reduces it)
-- Column list/order/types are identical → CREATE OR REPLACE, no cascade,
-- dependent v_arrival_dashboard_rows untouched. Safe to apply ahead of any
-- frontend deploy (old clients simply start seeing correct numbers).

CREATE OR REPLACE VIEW public.v_arrival_payment_state AS
SELECT
  b.id AS booking_id,

  -- Net charges owed to the hotel (charges + adjustments, post-discount,
  -- pre-payment). Unchanged.
  COALESCE(SUM(fe.amount) FILTER (
    WHERE fe.entry_type IN ('ROOM_CHARGE','FOOD_CHARGE','SERVICE_CHARGE','TAX','ADJUSTMENT')
  ), 0)::numeric AS total_amount,

  -- Net money received from the guest, as a POSITIVE number. PAYMENT entries
  -- are stored negative (trg_payment_to_folio inserts -amount), so negate the
  -- stored sum. A REFUND entry stored positive (money returned) correctly
  -- reduces this.
  COALESCE(-SUM(fe.amount) FILTER (
    WHERE fe.entry_type IN ('PAYMENT','REFUND')
  ), 0)::numeric AS paid_amount,

  -- Outstanding balance = the plain ledger sum (charges positive, payments
  -- negative). Identical by construction to collect_payment's guard.
  COALESCE(SUM(fe.amount) FILTER (
    WHERE fe.entry_type IN ('ROOM_CHARGE','FOOD_CHARGE','SERVICE_CHARGE','TAX','ADJUSTMENT','PAYMENT','REFUND')
  ), 0)::numeric AS pending_amount,

  CASE
    WHEN COALESCE(SUM(fe.amount) FILTER (
      WHERE fe.entry_type IN ('ROOM_CHARGE','FOOD_CHARGE','SERVICE_CHARGE','TAX','ADJUSTMENT','PAYMENT','REFUND')
    ), 0) > 0 THEN true
    ELSE false
  END AS payment_pending,

  -- ─── Breakdown columns (unchanged) ───
  COALESCE(SUM(fe.amount) FILTER (WHERE fe.entry_type = 'ROOM_CHARGE'),    0)::numeric AS room_charges,
  COALESCE(SUM(fe.amount) FILTER (WHERE fe.entry_type = 'FOOD_CHARGE'),    0)::numeric AS food_charges,
  COALESCE(SUM(fe.amount) FILTER (WHERE fe.entry_type = 'SERVICE_CHARGE'), 0)::numeric AS service_charges,
  COALESCE(SUM(fe.amount) FILTER (WHERE fe.entry_type = 'TAX'),            0)::numeric AS tax_amount,
  COALESCE(-SUM(fe.amount) FILTER (WHERE fe.entry_type = 'ADJUSTMENT' AND fe.amount < 0), 0)::numeric AS discount_amount,
  COALESCE(SUM(fe.amount) FILTER (WHERE fe.entry_type = 'ADJUSTMENT' AND fe.amount > 0), 0)::numeric AS surcharge_amount

FROM public.bookings b
LEFT JOIN public.folio_entries fe ON fe.booking_id = b.id
GROUP BY b.id;
