-- Migration: Hotel Invites & Staff Configuration
-- Date: 2026-03-02

BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS public.hotel_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  hotel_id uuid NOT NULL,
  email citext NOT NULL,
  role_id uuid NOT NULL,

  token uuid NOT NULL DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','expired','revoked')),

  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz NULL,

  resend_count integer NOT NULL DEFAULT 0,
  last_sent_at timestamptz,
  invite_metadata jsonb DEFAULT '{}'::jsonb,

  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT hotel_invites_token_unique UNIQUE (token),

  CONSTRAINT fk_hotel
    FOREIGN KEY (hotel_id)
    REFERENCES hotels(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_role
    FOREIGN KEY (role_id)
    REFERENCES hotel_roles(id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_created_by
    FOREIGN KEY (created_by)
    REFERENCES auth.users(id),

  CONSTRAINT chk_expiry_valid
    CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_invite
ON public.hotel_invites (hotel_id, email)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_invites_token ON public.hotel_invites(token);
CREATE INDEX IF NOT EXISTS idx_invites_hotel_id ON public.hotel_invites(hotel_id);

COMMIT;
