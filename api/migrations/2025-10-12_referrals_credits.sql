-- 2025-10-12_referrals_credits.sql
-- Schema for property-scoped referrals and guest credits
-- Postgres-safe & idempotent (ok to run multiple times)

-- ──────────────────────────────────────────────────────────────────────────────
-- Properties (reference by slug)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.properties (
  slug        text PRIMARY KEY,
  name        text
);

-- ──────────────────────────────────────────────────────────────────────────────
-- Guest identity map (to resolve phone/email -> user_id)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.guest_identities (
  id          bigserial PRIMARY KEY,
  user_id     text NOT NULL,
  phone       text UNIQUE,
  email       text UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guest_identities_user_idx ON public.guest_identities(user_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- Referrals: property-scoped codes (optionally linked to referrer’s user_id)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referrals (
  id                  bigserial PRIMARY KEY,
  property            text NOT NULL REFERENCES public.properties(slug) ON DELETE RESTRICT,
  code                text NOT NULL UNIQUE,
  created_by_user_id  text,              -- the referrer (if known)
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referrals_property_idx            ON public.referrals(property);
CREATE INDEX IF NOT EXISTS referrals_created_by_user_idx     ON public.referrals(created_by_user_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- Referral rewards: idempotency per (property, booking_code)
-- (One referee booking gives at most one reward entry to a referrer.)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referral_rewards (
  id                 bigserial PRIMARY KEY,
  property           text NOT NULL REFERENCES public.properties(slug) ON DELETE RESTRICT,
  booking_code       text NOT NULL,
  referrer_user_id   text NOT NULL,
  amount             integer NOT NULL,
  meta               jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property, booking_code)
);

CREATE INDEX IF NOT EXISTS referral_rewards_referrer_idx ON public.referral_rewards(referrer_user_id);
ALTER TABLE public.referral_rewards
  ADD CONSTRAINT referral_rewards_amount_positive
  CHECK (amount > 0) NOT VALID;

-- ──────────────────────────────────────────────────────────────────────────────
-- Credits ledger (positive = earn; negative = redeem)
-- Use a guarded block to create the enum once.
-- ──────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'credit_reason' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.credit_reason AS ENUM ('referral_bonus','redemption','manual_adjust');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS public.credits_ledger (
  id            bigserial PRIMARY KEY,
  property      text NOT NULL REFERENCES public.properties(slug) ON DELETE RESTRICT,
  user_id       text NOT NULL,
  booking_code  text,
  delta         integer NOT NULL,                 -- +earn / -redeem
  reason        public.credit_reason NOT NULL,
  meta          jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credits_ledger_user_idx         ON public.credits_ledger(user_id);
CREATE INDEX IF NOT EXISTS credits_ledger_prop_user_idx    ON public.credits_ledger(property, user_id);
ALTER TABLE public.credits_ledger
  ADD CONSTRAINT credits_ledger_delta_nonzero
  CHECK (delta <> 0) NOT VALID;

-- ──────────────────────────────────────────────────────────────────────────────
-- Read-time aggregation for balances
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.credit_balances AS
SELECT
  property,
  user_id,
  SUM(delta)::int AS balance
FROM public.credits_ledger
GROUP BY property, user_id;

-- ──────────────────────────────────────────────────────────────────────────────
-- Optional seed for demo
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO public.properties(slug, name)
VALUES ('sunrise','Sunrise Resort')
ON CONFLICT (slug) DO NOTHING;
