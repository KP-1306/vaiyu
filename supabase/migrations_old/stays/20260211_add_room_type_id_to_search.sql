-- Migration: FAST FIX for search_booking
-- The error "column b.email does not exist" means bookings table does not have email column.
-- We must get email from GUESTS table only.

