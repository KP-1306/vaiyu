-- Migration: Add missing columns to hotels based on UI and schema audit
-- Date: 2026-03-04

BEGIN;

-- Add toggle flags for operations
ALTER TABLE public.hotels 
ADD COLUMN IF NOT EXISTS early_checkin_allowed boolean DEFAULT false;

ALTER TABLE public.hotels 
ADD COLUMN IF NOT EXISTS late_checkout_allowed boolean DEFAULT false;

-- Add flags for setup and verification state
ALTER TABLE public.hotels 
ADD COLUMN IF NOT EXISTS is_verified boolean DEFAULT false;

ALTER TABLE public.hotels 
ADD COLUMN IF NOT EXISTS is_setup_complete boolean DEFAULT false;

-- upi_id and brand_color (checking just in case)
ALTER TABLE public.hotels 
ADD COLUMN IF NOT EXISTS upi_id text;

ALTER TABLE public.hotels 
ADD COLUMN IF NOT EXISTS brand_color text DEFAULT '#6366F1';

COMMIT;
