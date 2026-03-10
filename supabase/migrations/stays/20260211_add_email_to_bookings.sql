-- Migration: Standardize Bookings Table with Email Snapshot
-- Rationale: Bookings should snapshot guest contact details (Phone, Email, Name) at time of booking.
-- This ensures historical accuracy even if the guest profile changes later.

-- 1. Add email column
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS email TEXT;

-- 2. Backfill email from Guests table (Source of Truth)
UPDATE bookings b
SET email = g.email
FROM guests g
WHERE b.guest_id = g.id
AND b.email IS NULL;

-- 3. Update search_booking RPC to use b.email (Optimization & Standardization)
