-- Properties are referenced by slug (e.g., 'sunrise').
-- If you already have a properties table, you can skip this.
CREATE TABLE IF NOT EXISTS properties (
  slug        text PRIMARY KEY,
  name        text
);

-- Users are referenced by internal user_id (string/uuid).
-- If you already have users elsewhere, just make sure IDs match.
-- Lightweight identity map to resolve phone/email → user_id.
CREATE TABLE IF NOT EXISTS guest_identities (
  id          bigserial PRIMARY KEY,
  user_id     text NOT NULL,
  phone       text UNIQUE,
  email       text UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Referral codes created by referrers, property scoped.
CREATE TABLE IF NOT EXISTS referrals (
  id                bigserial PRIMARY KEY,
  property          text NOT NULL REFERENCES properties(slug) ON DELETE RESTRICT,
  code              text NOT NULL UNIQUE,
  created_by_user_id text,         -- the referrer (if known)
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referrals_property_idx ON referrals(property);

-- Idempotency table: one referee booking gets exactly one reward entry.
-- We tie booking_code + property → referrer_user_id to prevent duplicates.
CREATE TABLE IF NOT EXISTS referral_rewards (
  id                 bigserial PRIMARY KEY,
  property           text NOT NULL REFERENCES properties(slug) ON DELETE RESTRICT,
  booking_code       text NOT NULL,
  referrer_user_id   text NOT NULL,
  amount             integer NOT NULL,
  meta               jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property, booking_code)
);

-- Ledger of credits (positive for bonuses; negative for redemptions).
CREATE TYPE credit_reason AS ENUM ('referral_bonus','redemption','manual_adjust');

CREATE TABLE IF NOT EXISTS credits_ledger (
  id            bigserial PRIMARY KEY,
  property      text NOT NULL REFERENCES properties(slug) ON DELETE RESTRICT,
  user_id       text NOT NULL,
  booking_code  text,
  delta         integer NOT NULL,
  reason        credit_reason NOT NULL,
  meta          jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credits_ledger_user_idx ON credits_ledger(user_id);
CREATE INDEX IF NOT EXISTS credits_ledger_prop_user_idx ON credits_ledger(property, user_id);

-- A simple read-time aggregation for balances.
CREATE VIEW IF NOT EXISTS credit_balances AS
SELECT
  property,
  user_id,
  SUM(delta)::int AS balance
FROM credits_ledger
GROUP BY property, user_id;

-- Optional seed (demo)
INSERT INTO properties(slug, name)
VALUES ('sunrise','Sunrise Resort')
ON CONFLICT (slug) DO NOTHING;
