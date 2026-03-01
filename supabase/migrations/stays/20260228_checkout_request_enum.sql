-- ============================================================
-- CHECKOUT REQUEST FLOW - PART 1: ENUM ADDITION
-- ============================================================

-- This MUST be run and committed before PART 2 can be executed.
-- Postgres enums cannot be used in the same transaction block they are created.

DO $$
BEGIN
    ALTER TYPE stay_status ADD VALUE IF NOT EXISTS 'checkout_requested';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
