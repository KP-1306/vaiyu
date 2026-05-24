-- 20260518000002_auto_refund_razorpay_mode.sql
--
-- Follow-up to 20260513000002 (auto_refund_on_cancel) and 20260518000001
-- (razorpay_direct_mode): the cancellation trigger inserts refund rows for
-- each completed Razorpay payment on a cancelled booking, but it predates
-- the `refunds.razorpay_mode` column added in 20260518000001 — so those
-- auto-created rows land with `razorpay_mode = NULL`.
--
-- Without this fix, refund/refresh/reconcile dispatch in the UI has to
-- fall back to joining the payment row to recover the mode (which works
-- today because we built the fallback into the frontend facade), but the
-- DB state is uglier than it should be and any direct SQL on `refunds`
-- would have to remember to JOIN payments for mode.
--
-- Tagging the refund at INSERT time with the payment's mode keeps the
-- data clean and means future code (reports, exports, BI tools) can
-- read `refunds.razorpay_mode` directly.
--
-- This is a function-only change — the trigger itself is preserved
-- (CREATE OR REPLACE FUNCTION updates the body without rebinding).

CREATE OR REPLACE FUNCTION public.trg_flag_refunds_on_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment RECORD;
  v_already_refunded NUMERIC(12,2);
  v_refundable NUMERIC(12,2);
BEGIN
  -- Only act on the CANCELLED transition, not every UPDATE to the row.
  IF NEW.status IS DISTINCT FROM 'CANCELLED' OR OLD.status = 'CANCELLED' THEN
    RETURN NEW;
  END IF;

  FOR v_payment IN
    SELECT id, hotel_id, folio_id, amount, razorpay_mode
      FROM public.payments
     WHERE booking_id = NEW.id
       AND status = 'COMPLETED'
       AND razorpay_payment_id IS NOT NULL
  LOOP
    -- Subtract any already-processed/pending refunds (idempotent if trigger
    -- fires twice due to back-and-forth status changes).
    SELECT COALESCE(SUM(amount), 0)
      INTO v_already_refunded
      FROM public.refunds
     WHERE payment_id = v_payment.id
       AND status IN ('PENDING', 'PROCESSED');

    v_refundable := v_payment.amount - v_already_refunded;
    IF v_refundable <= 0 THEN
      CONTINUE;
    END IF;

    -- Inherit razorpay_mode from the payment so the refund is dispatched
    -- via the correct credential path even after the hotel switches modes.
    INSERT INTO public.refunds (
      hotel_id, booking_id, folio_id, payment_id,
      amount, currency, reason, status, reverse_all, razorpay_mode
    ) VALUES (
      v_payment.hotel_id, NEW.id, v_payment.folio_id, v_payment.id,
      v_refundable, 'INR',
      'Auto-flagged: booking cancelled',
      'PENDING',
      true,
      v_payment.razorpay_mode
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- Backfill any existing pending refund rows that were auto-flagged before
-- this fix (will only affect prod if cancellations happened between the
-- 20260513000002 migration apply and this one).
UPDATE public.refunds r
   SET razorpay_mode = p.razorpay_mode
  FROM public.payments p
 WHERE r.payment_id = p.id
   AND r.razorpay_mode IS NULL
   AND p.razorpay_mode IS NOT NULL;
