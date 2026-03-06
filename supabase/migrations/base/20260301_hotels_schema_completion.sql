-- Migration: Hotels Schema Completion
-- Purpose: Add missing fields to hotels table for address, legal, operations, audit, and status.
-- Date: 2026-03-01
-- Safe: All ADD COLUMN IF NOT EXISTS, idempotent constraints, idempotent triggers.

-- ===============================
-- CURRENT SCHEMA REFERENCE (hotels)
-- ===============================
-- id uuid PK default gen_random_uuid()
-- slug text NOT NULL UNIQUE
-- name text NOT NULL
-- address text
-- phone text
-- email text
-- created_at timestamptz default now()
-- plan text default 'free' CHECK (free|starter|pro|enterprise)
-- plan_status text default 'active' CHECK (trial|active|past_due|canceled)
-- plan_renews_at timestamptz
-- plan_notes text
-- city text
-- wa_phone_number_id text
-- wa_display_number text
-- brand_color text
-- logo_url text
-- review_policy_url text
-- booking_url text
-- state text
-- country text
-- rooms_total integer
-- amenities text[]
-- description text
-- theme jsonb
-- reviews_policy jsonb
-- upi_id text

BEGIN;

-- ===============================
-- ADDRESS COMPLETION
-- ===============================

ALTER TABLE public.hotels
ADD COLUMN IF NOT EXISTS postal_code text;

ALTER TABLE public.hotels
ADD COLUMN IF NOT EXISTS latitude numeric(9,6);

ALTER TABLE public.hotels
ADD COLUMN IF NOT EXISTS longitude numeric(9,6);


-- ===============================
-- LEGAL
-- ===============================

ALTER TABLE public.hotels
ADD COLUMN IF NOT EXISTS gst_number text;

ALTER TABLE public.hotels
ADD COLUMN IF NOT EXISTS legal_name text;

ALTER TABLE public.hotels
RENAME COLUMN logo_url TO logo_path;

ALTER TABLE public.hotels
ADD COLUMN IF NOT EXISTS cover_image_path text;
-- ===============================
-- OPERATIONS
-- ===============================

ALTER TABLE public.hotels
ADD COLUMN IF NOT EXISTS default_checkin_time time;

ALTER TABLE public.hotels
ADD COLUMN IF NOT EXISTS default_checkout_time time;

ALTER TABLE public.hotels
ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'Asia/Kolkata';

ALTER TABLE public.hotels
ADD COLUMN IF NOT EXISTS currency_code text DEFAULT 'INR';

ALTER TABLE public.hotels
ADD COLUMN IF NOT EXISTS tax_percentage numeric(5,2),
ADD COLUMN IF NOT EXISTS tax_inclusive boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS service_charge_percentage numeric(5,2),
ADD COLUMN IF NOT EXISTS invoice_prefix text,
ADD COLUMN IF NOT EXISTS invoice_counter bigint DEFAULT 1;
-- ===============================
-- AUDIT
-- ===============================

ALTER TABLE public.hotels
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();


-- ===============================
-- OPERATIONAL STATUS
-- ===============================

ALTER TABLE public.hotels
ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'hotels_status_check'
    ) THEN
        ALTER TABLE public.hotels
        ADD CONSTRAINT hotels_status_check
        CHECK (status IN ('active','inactive','suspended'));
    END IF;
END $$;

COMMIT;

-- ===============================
-- UPDATED_AT TRIGGER
-- ===============================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_hotels_updated_at'
    ) THEN
        CREATE TRIGGER trg_hotels_updated_at
        BEFORE UPDATE ON public.hotels
        FOR EACH ROW
        EXECUTE FUNCTION public.set_updated_at();
    END IF;
END $$;

BEGIN;

-- ===============================
-- OPERATIONAL CONTROLS
-- ===============================

ALTER TABLE public.hotels
ADD COLUMN IF NOT EXISTS require_inspection boolean DEFAULT true;

ALTER TABLE public.hotels
ADD COLUMN IF NOT EXISTS default_cleaning_minutes integer DEFAULT 30;

ALTER TABLE public.hotels
ADD COLUMN IF NOT EXISTS allow_overbooking boolean DEFAULT false;

ALTER TABLE public.hotels
ADD COLUMN IF NOT EXISTS overbooking_limit integer DEFAULT 0;

ALTER TABLE public.hotels
ADD COLUMN IF NOT EXISTS go_live_at timestamptz;


-- ===============================
-- FINANCIAL CONTROLS
-- ===============================

ALTER TABLE public.hotels
ADD COLUMN IF NOT EXISTS invoice_format text DEFAULT 'FY';

ALTER TABLE public.hotels
ADD COLUMN IF NOT EXISTS financial_year_start_month integer DEFAULT 4;

ALTER TABLE public.hotels
ADD COLUMN IF NOT EXISTS sac_code text;


-- Add safe CHECK constraints (only if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'hotels_invoice_format_check'
    ) THEN
        ALTER TABLE public.hotels
        ADD CONSTRAINT hotels_invoice_format_check
        CHECK (invoice_format IN ('FY','CALENDAR','CONTINUOUS'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'hotels_financial_year_start_check'
    ) THEN
        ALTER TABLE public.hotels
        ADD CONSTRAINT hotels_financial_year_start_check
        CHECK (financial_year_start_month BETWEEN 1 AND 12);
    END IF;
END $$;

COMMIT;
----update
BEGIN;

UPDATE public.hotels
SET
    require_inspection = COALESCE(require_inspection, true),
    default_cleaning_minutes = COALESCE(default_cleaning_minutes, 30),
    allow_overbooking = COALESCE(allow_overbooking, false),
    overbooking_limit = COALESCE(overbooking_limit, 0),
    invoice_format = COALESCE(invoice_format, 'FY'),
    financial_year_start_month = COALESCE(financial_year_start_month, 4),
    sac_code = COALESCE(sac_code, '996311'), -- Indian hotel SAC
    go_live_at = COALESCE(go_live_at, now());

COMMIT;
-- ===============================
-- DATA BACKFILL (populate NULLs with defaults)
-- ===============================

UPDATE public.hotels
SET default_checkin_time = '14:00'
WHERE default_checkin_time IS NULL;

UPDATE public.hotels
SET default_checkout_time = '11:00'
WHERE default_checkout_time IS NULL;

UPDATE public.hotels
SET timezone = 'Asia/Kolkata'
WHERE timezone IS NULL;

UPDATE public.hotels
SET currency_code = 'INR'
WHERE currency_code IS NULL;

UPDATE public.hotels
SET status = 'active'
WHERE status IS NULL;

UPDATE public.hotels
SET updated_at = now()
WHERE updated_at IS NULL;

