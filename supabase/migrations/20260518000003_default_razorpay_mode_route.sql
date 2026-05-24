-- 20260518000003_default_razorpay_mode_route.sql
--
-- Bug fix for 20260518000001 (razorpay_direct_mode):
--
-- The CHECK constraints added in 20260518000001 require razorpay_mode to be
-- NOT NULL whenever razorpay_payment_id (or razorpay_refund_id) is set. The
-- new DIRECT Edge Functions set razorpay_mode='DIRECT' on every INSERT, so
-- they're fine.
--
-- BUT the existing Route Edge Functions (razorpay-verify-payment,
-- razorpay-webhook, razorpay-create-refund) do NOT set razorpay_mode at
-- INSERT time — they were written before the column existed and are
-- intentionally untouched (they stay reserved for Route reactivation
-- without rewrites). Without this fix, ANY Route INSERT after migration
-- 20260518000001 fails with check_violation — money captured at Razorpay
-- but never recorded in our DB.
--
-- Fix: BEFORE INSERT triggers default razorpay_mode to 'ROUTE' when a
-- razorpay_payment_id / razorpay_refund_id is provided without an explicit
-- mode. Explicit mode ('DIRECT' set by Direct Edge Functions) is preserved.
--
-- Verification: `INSERT INTO payments(... razorpay_payment_id, /* no mode */)`
-- now succeeds with razorpay_mode auto-populated to 'ROUTE'.

BEGIN;

CREATE OR REPLACE FUNCTION public.trg_default_razorpay_mode_payments()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only act if this is a Razorpay-captured payment with no explicit mode.
  -- Cash payments have NULL razorpay_payment_id and stay NULL on mode.
  IF NEW.razorpay_payment_id IS NOT NULL AND NEW.razorpay_mode IS NULL THEN
    NEW.razorpay_mode := 'ROUTE';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_default_razorpay_mode ON public.payments;
CREATE TRIGGER payments_default_razorpay_mode
  BEFORE INSERT ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_default_razorpay_mode_payments();

CREATE OR REPLACE FUNCTION public.trg_default_razorpay_mode_refunds()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.razorpay_refund_id IS NOT NULL AND NEW.razorpay_mode IS NULL THEN
    NEW.razorpay_mode := 'ROUTE';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refunds_default_razorpay_mode ON public.refunds;
CREATE TRIGGER refunds_default_razorpay_mode
  BEFORE INSERT ON public.refunds
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_default_razorpay_mode_refunds();

COMMIT;
