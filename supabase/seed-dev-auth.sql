-- supabase/seed-dev-auth.sql
--
-- Deterministic dev-only seed for browser-agent / Playwright UI testing.
--
-- Creates:
--   * auth.users row for dev-owner@vaiyu.test (bcrypt password) with
--     email_confirmed_at set so OTP / magic link is bypassed.
--   * matching auth.identities row.
--   * public.profiles row.
--   * public.hotels row "dev-hotel".
--   * public.hotel_members row with role='owner'.
--   * a couple of room_types and rooms so the UI dashboards render meaningfully.
--
-- All inserts use fixed UUIDs + ON CONFLICT DO NOTHING so the script is
-- idempotent and safe to re-run.
--
-- !!  NEVER run this against a production database.  !!
-- The script aborts unless the connection sets vaiyu.dev_seed_allow=1, e.g.
--   PGOPTIONS="-c vaiyu.dev_seed_allow=1" psql "$DATABASE_URL" -f supabase/seed-dev-auth.sql
-- The wrapper at web/scripts/dev-seed.sh sets that flag automatically.

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF coalesce(current_setting('vaiyu.dev_seed_allow', true), '') <> '1' THEN
    RAISE EXCEPTION
      'Refusing to run seed-dev-auth.sql: missing -v vaiyu.dev_seed_allow=1. '
      'This script must only ever be run against a LOCAL Supabase.';
  END IF;
END
$guard$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Deterministic IDs so the seed is idempotent and identifiable.
--   dev user:   00000000-0000-0000-0000-0000000000d1
--   dev hotel:  00000000-0000-0000-0000-0000000000d2
--   room type:  00000000-0000-0000-0000-0000000000d3
--   rooms 101-104: ...d4..d7

-- ──────────────────────────────────────────────────────────────────────────
-- 1. auth.users + auth.identities
-- ──────────────────────────────────────────────────────────────────────────
INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
)
VALUES (
  '00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'dev-owner@vaiyu.test',
  crypt('devpassword-change-me', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Dev Owner"}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
)
ON CONFLICT (id) DO UPDATE
  SET encrypted_password = EXCLUDED.encrypted_password,
      email_confirmed_at = EXCLUDED.email_confirmed_at,
      updated_at = now();

INSERT INTO auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
VALUES (
  '00000000-0000-0000-0000-0000000000e1',
  '00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-0000000000d1',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-0000000000d1',
    'email', 'dev-owner@vaiyu.test',
    'email_verified', true
  ),
  'email',
  now(),
  now(),
  now()
)
ON CONFLICT (provider, provider_id) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. public.profiles
-- ──────────────────────────────────────────────────────────────────────────
INSERT INTO public.profiles (id, full_name, email, vaiyu_id, is_admin)
VALUES (
  '00000000-0000-0000-0000-0000000000d1',
  'Dev Owner',
  'dev-owner@vaiyu.test',
  'VA-DEV-0001',
  true
)
ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      email    = EXCLUDED.email,
      is_admin = EXCLUDED.is_admin;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. public.hotels
-- ──────────────────────────────────────────────────────────────────────────
INSERT INTO public.hotels (
  id, slug, name, address, phone, email,
  city, state, country, timezone, currency_code,
  tax_percentage, tax_inclusive, service_charge_percentage,
  invoice_prefix, default_checkin_time, default_checkout_time,
  status, is_setup_complete, lifecycle_status, plan, plan_status
)
VALUES (
  '00000000-0000-0000-0000-0000000000d2',
  'dev-hotel',
  'Dev Test Hotel',
  '1 Test Lane',
  '+910000000000',
  'dev-hotel@vaiyu.test',
  'Dehradun',
  'Uttarakhand',
  'India',
  'Asia/Kolkata',
  'INR',
  12.00,
  false,
  0.00,
  'DEV',
  '13:00'::time,
  '11:00'::time,
  'active',
  true,
  'ACTIVE',
  'pro',
  'active'
)
ON CONFLICT (id) DO UPDATE
  SET slug              = EXCLUDED.slug,
      name              = EXCLUDED.name,
      is_setup_complete = true,
      lifecycle_status  = 'ACTIVE',
      status            = 'active',
      updated_at        = now();

-- ──────────────────────────────────────────────────────────────────────────
-- 4. public.hotel_members
-- ──────────────────────────────────────────────────────────────────────────
INSERT INTO public.hotel_members (
  id, hotel_id, user_id, role, active, is_active, is_verified, status
)
VALUES (
  '00000000-0000-0000-0000-0000000000d8',
  '00000000-0000-0000-0000-0000000000d2',
  '00000000-0000-0000-0000-0000000000d1',
  'owner',
  true,
  true,
  true,
  'active'
)
ON CONFLICT (id) DO UPDATE
  SET role        = 'owner',
      active      = true,
      is_active   = true,
      is_verified = true,
      status      = 'active',
      updated_at  = now();

-- ──────────────────────────────────────────────────────────────────────────
-- 4b. hotel_roles + hotel_member_roles (RBAC v2 — OwnerDashboard requires
--     a hotel_member_roles row joined to hotel_roles.code in
--     ['OWNER','ADMIN','MANAGER','OPS_MANAGER']).
-- ──────────────────────────────────────────────────────────────────────────
INSERT INTO public.hotel_roles (id, hotel_id, code, name, description, is_active)
VALUES (
  '00000000-0000-0000-0000-0000000000d9',
  '00000000-0000-0000-0000-0000000000d2',
  'OWNER',
  'Owner',
  'Seeded dev role',
  true
)
ON CONFLICT (hotel_id, code) DO UPDATE
  SET is_active = true,
      updated_at = now();

INSERT INTO public.hotel_member_roles (hotel_member_id, role_id)
SELECT
  '00000000-0000-0000-0000-0000000000d8',
  id
FROM public.hotel_roles
WHERE hotel_id = '00000000-0000-0000-0000-0000000000d2'
  AND code = 'OWNER'
ON CONFLICT (hotel_member_id, role_id) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. room_types + rooms (so dashboards / calendar / housekeeping render)
-- ──────────────────────────────────────────────────────────────────────────
INSERT INTO public.room_types (id, hotel_id, name, description, base_occupancy, max_occupancy, is_active)
VALUES (
  '00000000-0000-0000-0000-0000000000d3',
  '00000000-0000-0000-0000-0000000000d2',
  'Standard',
  'Seeded dev room type',
  2, 3, true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.rooms (id, hotel_id, number, floor, room_type_id)
VALUES
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000d2', '101', '1', '00000000-0000-0000-0000-0000000000d3'),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000d2', '102', '1', '00000000-0000-0000-0000-0000000000d3'),
  ('00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000d2', '201', '2', '00000000-0000-0000-0000-0000000000d3'),
  ('00000000-0000-0000-0000-0000000000d7', '00000000-0000-0000-0000-0000000000d2', '202', '2', '00000000-0000-0000-0000-0000000000d3')
ON CONFLICT (id) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────
-- Summary (printed on success)
-- ──────────────────────────────────────────────────────────────────────────
SELECT
  'seed-dev-auth.sql complete' AS status,
  (SELECT email FROM auth.users WHERE id = '00000000-0000-0000-0000-0000000000d1') AS dev_user,
  (SELECT slug  FROM public.hotels WHERE id = '00000000-0000-0000-0000-0000000000d2') AS dev_hotel,
  (SELECT role  FROM public.hotel_members WHERE id = '00000000-0000-0000-0000-0000000000d8') AS dev_role,
  (SELECT count(*) FROM public.rooms WHERE hotel_id = '00000000-0000-0000-0000-0000000000d2') AS dev_rooms;
