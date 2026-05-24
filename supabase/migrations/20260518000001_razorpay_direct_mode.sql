-- 20260518000001_razorpay_direct_mode.sql
--
-- Adds DIRECT mode to the Razorpay integration: each hotel uses their own
-- Razorpay account credentials instead of going through the platform's
-- Route flow. This unblocks online payments while Route activation is
-- pending (Razorpay denies Route until the platform has turnover).
--
-- Three modes:
--   • NONE   — cash only (default). Online payment buttons hidden.
--   • DIRECT — hotel's own Razorpay account. Funds settle directly to
--              the hotel's bank. vaiyu never touches the money. No
--              platform fee.
--   • ROUTE  — platform-managed via /v2/accounts (existing flow, unchanged).
--              Funds split via transfers[] to hotel's Linked Account.
--
-- The Route plumbing built earlier (razorpay-create-order, etc.) is
-- preserved 100% — both modes coexist permanently. Migration to Route is
-- per-hotel and opt-in once the platform's Route is activated.

BEGIN;

/* ===================================================================
   1. hotels.razorpay_mode — picker
   =================================================================== */

ALTER TABLE public.hotels
  ADD COLUMN razorpay_mode TEXT NOT NULL DEFAULT 'NONE'
    CHECK (razorpay_mode IN ('NONE', 'DIRECT', 'ROUTE'));

COMMENT ON COLUMN public.hotels.razorpay_mode IS
  'Razorpay integration mode for this hotel. NONE = cash only; DIRECT = hotel''s own Razorpay account (direct settlement); ROUTE = platform-managed Linked Account (transfers[] split).';

/* ===================================================================
   2. DIRECT mode credentials (encrypted at rest)
   ===================================================================

   key_secret and webhook_secret are stored as AES-256-GCM ciphertext
   (base64-encoded `iv || ciphertext || authTag`). The master key lives
   in the RAZORPAY_DIRECT_SECRETS_KEY env var (64 hex chars = 32 bytes).
   Decryption happens in Edge Functions via _shared/razorpay-direct.ts.

   key_id is NOT encrypted — it's a public identifier shown openly in
   Razorpay Checkout's order_id payload anyway.
*/

ALTER TABLE public.hotels
  ADD COLUMN razorpay_direct_key_id TEXT,
  ADD COLUMN razorpay_direct_key_secret_enc TEXT,
  ADD COLUMN razorpay_direct_webhook_secret_enc TEXT;

-- Key IDs follow rzp_(test|live)_<alnum> format. Reject anything else
-- at the DB layer so a bad UPDATE can't leave a corrupt row.
ALTER TABLE public.hotels
  ADD CONSTRAINT hotels_razorpay_direct_key_id_format_chk
    CHECK (razorpay_direct_key_id IS NULL
           OR razorpay_direct_key_id ~ '^rzp_(test|live)_[A-Za-z0-9]+$');

-- If mode is DIRECT, all three credential fields must be present.
-- If mode isn't DIRECT, the credential fields can be anything (we keep
-- them around so a hotel that flips ROUTE → DIRECT doesn't lose old keys).
ALTER TABLE public.hotels
  ADD CONSTRAINT hotels_razorpay_direct_complete_chk
    CHECK (
      razorpay_mode <> 'DIRECT'
      OR (
        razorpay_direct_key_id IS NOT NULL
        AND razorpay_direct_key_secret_enc IS NOT NULL
        AND razorpay_direct_webhook_secret_enc IS NOT NULL
      )
    );

COMMENT ON COLUMN public.hotels.razorpay_direct_key_id IS
  'Hotel''s own Razorpay key_id (rzp_test_* or rzp_live_*). Public identifier; not encrypted.';
COMMENT ON COLUMN public.hotels.razorpay_direct_key_secret_enc IS
  'AES-256-GCM ciphertext of hotel''s Razorpay key_secret. Decrypted only inside Edge Functions.';
COMMENT ON COLUMN public.hotels.razorpay_direct_webhook_secret_enc IS
  'AES-256-GCM ciphertext of the webhook signing secret vaiyu generated for this hotel. Hotel pastes the plaintext into their Razorpay dashboard webhook config.';

/* ===================================================================
   3. payments / refunds — per-row mode tracking
   ===================================================================

   Critical: a payment captured via DIRECT keys must be refunded via the
   SAME DIRECT keys, even if the hotel later switches to ROUTE. We tag
   each row at insert time so refund / reconcile logic picks the right
   credential path regardless of the hotel's current mode.

   Existing rows pre-migration are all ROUTE (the only path that
   existed). Backfill explicitly; leave the column NULL-able to support
   non-Razorpay cash rows (which have razorpay_payment_id IS NULL).
*/

ALTER TABLE public.payments
  ADD COLUMN razorpay_mode TEXT
    CHECK (razorpay_mode IS NULL OR razorpay_mode IN ('DIRECT', 'ROUTE'));

ALTER TABLE public.refunds
  ADD COLUMN razorpay_mode TEXT
    CHECK (razorpay_mode IS NULL OR razorpay_mode IN ('DIRECT', 'ROUTE'));

-- Backfill: anything with a razorpay_payment_id pre-this-migration was
-- collected via the original ROUTE path. The payments + refunds tables
-- have BEFORE UPDATE immutability triggers (trg_restrict_payment_update,
-- and similar on refunds) that block ANY update to COMPLETED/FAILED/PROCESSED
-- rows. The backfill must bypass those triggers — set
-- session_replication_role='replica' for the duration of this transaction,
-- which is the standard idiom for migration-time data fixes. The setting
-- is LOCAL so it reverts at COMMIT (no leakage to subsequent transactions).
SET LOCAL session_replication_role = 'replica';

UPDATE public.payments
   SET razorpay_mode = 'ROUTE'
 WHERE razorpay_payment_id IS NOT NULL
   AND razorpay_mode IS NULL;

UPDATE public.refunds
   SET razorpay_mode = 'ROUTE'
 WHERE razorpay_refund_id IS NOT NULL
   AND razorpay_mode IS NULL;

SET LOCAL session_replication_role = 'origin';

-- Enforce: if razorpay_payment_id is set, mode must also be set.
ALTER TABLE public.payments
  ADD CONSTRAINT payments_razorpay_mode_required_chk
    CHECK (razorpay_payment_id IS NULL OR razorpay_mode IS NOT NULL);

ALTER TABLE public.refunds
  ADD CONSTRAINT refunds_razorpay_mode_required_chk
    CHECK (razorpay_refund_id IS NULL OR razorpay_mode IS NOT NULL);

COMMENT ON COLUMN public.payments.razorpay_mode IS
  'Which credential set was used to capture this payment. Refund logic reads this so a DIRECT-collected payment is refunded against the hotel''s own Razorpay account even if the hotel later switches to ROUTE.';

COMMENT ON COLUMN public.refunds.razorpay_mode IS
  'Which credential set was used to issue this refund. Set at insert time.';

COMMIT;
