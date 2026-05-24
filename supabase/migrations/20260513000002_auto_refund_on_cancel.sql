-- 20260513000002_auto_refund_on_cancel.sql
--
-- When a paid booking is cancelled, today the payment stays COMPLETED and
-- the folio balance goes negative. Staff have to remember to refund via
-- the FolioDrawer — easy to miss, hard to audit.
--
-- This migration adds a SAFER auto-refund pattern:
--   1. When `bookings.status` transitions to 'CANCELLED', a trigger inserts
--      a row in `refunds` for each completed Razorpay payment on that
--      booking, with status='PENDING' and reason='Auto-flagged: booking
--      cancelled'. NO Razorpay API call yet — just a marker.
--   2. Owners see these in `OwnerPayments` as "Refunds pending review" and
--      click a button to process them, which calls `razorpay-create-refund`
--      one by one.
--
-- Why not auto-call Razorpay from the trigger?
--   - Triggers can't make HTTP calls without pg_net which adds complexity
--     and would have weak failure modes (no retry, no auth context).
--   - Staff review prevents accidental refunds during testing or when a
--     cancellation was actually a typo. Money out the door should be
--     deliberate, not automatic.
--   - The FolioDrawer "Refund" button already exists for the manual path
--     — this just adds an opt-in queue for batch processing.
--
-- Cash payments are NOT auto-flagged — they don't have razorpay_payment_id
-- and would need a different reversal workflow (manual ledger correction).

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
    SELECT id, hotel_id, folio_id, amount
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

    INSERT INTO public.refunds (
      hotel_id, booking_id, folio_id, payment_id,
      amount, currency, reason, status, reverse_all
    ) VALUES (
      v_payment.hotel_id, NEW.id, v_payment.folio_id, v_payment.id,
      v_refundable, 'INR',
      'Auto-flagged: booking cancelled',
      'PENDING',
      true
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_flag_refunds_on_cancel ON public.bookings;
CREATE TRIGGER bookings_flag_refunds_on_cancel
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW
  WHEN (NEW.status = 'CANCELLED' AND OLD.status IS DISTINCT FROM 'CANCELLED')
  EXECUTE FUNCTION public.trg_flag_refunds_on_cancellation();

COMMENT ON FUNCTION public.trg_flag_refunds_on_cancellation() IS
  'On booking cancellation, inserts PENDING refund rows for each completed Razorpay payment so staff can process them via the OwnerPayments review queue.';
