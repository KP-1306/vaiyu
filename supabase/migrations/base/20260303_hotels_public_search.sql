-- Migration: Secure Public Search Access for Hotels
-- Purpose: Implement Enterprise-Grade security for public hotel searching via a restricted view.
-- Date: 2026-03-03

-- 1. Remove direct public SELECT policies from hotels table (Hardening)
DROP POLICY IF EXISTS "Public hotels search access" ON public.hotels;

-- 2. Create Public-Safe View
-- Only expose columns required for search and display.
CREATE OR REPLACE VIEW public.v_public_hotels AS
SELECT
    id,
    name,
    slug,
    description,
    phone,
    email,
    address,
    city,
    state,
    country,
    postal_code,
    latitude,
    longitude,
    legal_name,
    gst_number,
    logo_path AS logo_url,
    cover_image_path AS cover_image_url,
    default_checkin_time,
    default_checkout_time,
    timezone,
    currency_code,
    tax_percentage,
    service_charge_percentage,
    invoice_prefix,
    invoice_counter,
    brand_color,
    upi_id,
    booking_url,
    amenities,
    status,
    wa_display_number
FROM public.hotels
WHERE (status = 'active' OR status IS NULL);

-- 3. Grant Permissions on the View
-- Allow anon and authenticated roles to search via the view.
GRANT SELECT ON public.v_public_hotels TO anon;
GRANT SELECT ON public.v_public_hotels TO authenticated;

-- Ensure RLS is enabled on the underlying table (though we query the view)
ALTER TABLE public.hotels ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- 4. Performance: Enable Fast Search
-- ==========================================

-- Enable pg_trgm extension for fast ILIKE searches
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create GIN index on name for fast substring matching
CREATE INDEX IF NOT EXISTS idx_hotels_name_trgm 
ON public.hotels USING gin (name gin_trgm_ops);

-- Create GIN index on slug for fast substring matching
CREATE INDEX IF NOT EXISTS idx_hotels_slug_trgm 
ON public.hotels USING gin (slug gin_trgm_ops);
