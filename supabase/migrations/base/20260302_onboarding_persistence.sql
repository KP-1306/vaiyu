-- Migration: Add onboarding fields to hotels
-- Date: 2026-03-02

BEGIN;

ALTER TABLE public.hotels
ADD COLUMN IF NOT EXISTS onboarding_step integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_setup_complete boolean DEFAULT false;

COMMIT;
