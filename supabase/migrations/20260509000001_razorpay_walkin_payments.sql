-- 20260509000001_razorpay_walkin_payments.sql
--
-- Razorpay walk-in payment integration with Route (Linked Accounts).
--
-- Adds:
--   • hotels.razorpay_account_id          — Linked Account ID (acc_xxx) per hotel
--   • hotels.razorpay_platform_fee_pct    — platform's cut per payment, default 0
--   • payments.razorpay_order_id          — order_xxx for reconciliation
--   • payments.razorpay_payment_id        — pay_xxx, the Razorpay payment id
--   • payments.razorpay_signature         — HMAC signature, retained for audit
--   • partial UNIQUE index on razorpay_payment_id — guarantees idempotency between
--     the client verify-payment path and the asynchronous webhook path. Cash
--     payments (NULL) remain unrestricted.
--
-- Reuses existing infrastructure unchanged:
--   • payments table (status='COMPLETED' → trigger trg_payment_to_folio creates
--     the corresponding folio_entries PAYMENT row).
--   • RLS policies on payments — column-agnostic for INSERT/SELECT.
--   • create_walkin_v2 RPC — still posts ROOM_CHARGE / ADJUSTMENT / TAX, no
--     change here.
--
-- No data migration required. Existing rows have NULL razorpay_* columns and
-- continue to behave as cash/manual entries.

ALTER TABLE public.hotels
  ADD COLUMN razorpay_account_id        TEXT,
  ADD COLUMN razorpay_platform_fee_pct  NUMERIC(5,2) NOT NULL DEFAULT 0;

ALTER TABLE public.hotels
  ADD CONSTRAINT hotels_razorpay_account_id_format_chk
    CHECK (razorpay_account_id IS NULL OR razorpay_account_id LIKE 'acc\_%' ESCAPE '\');

ALTER TABLE public.hotels
  ADD CONSTRAINT hotels_razorpay_platform_fee_pct_range_chk
    CHECK (razorpay_platform_fee_pct >= 0 AND razorpay_platform_fee_pct <= 100);

ALTER TABLE public.payments
  ADD COLUMN razorpay_order_id   TEXT,
  ADD COLUMN razorpay_payment_id TEXT,
  ADD COLUMN razorpay_signature  TEXT;

-- Idempotency: only one payment row per razorpay_payment_id. Both the
-- verify-payment Edge Function and the webhook race to insert; whichever
-- arrives first wins, the other gets ON CONFLICT DO NOTHING and reports
-- back as "deduped".
CREATE UNIQUE INDEX payments_razorpay_payment_id_uq
  ON public.payments (razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;

-- Lookup index for webhook reconciliation by order_id (used to detect
-- "already inserted" before computing signature).
CREATE INDEX payments_razorpay_order_id_idx
  ON public.payments (razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL;
