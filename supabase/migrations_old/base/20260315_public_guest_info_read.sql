-- Migration: Allow public read access to hotel guest info
-- Date: 2026-03-15
-- Purpose: Enable guest-facing kiosks/apps to show WiFi and breakfast info.

BEGIN;

CREATE POLICY "Allow public read access to hotel guest info" 
ON public.hotel_guest_info 
FOR SELECT 
USING (true);

COMMIT;
