-- Hotels RLS lockdown — close the cross-tenant SELECT leak discovered during
-- the walk-in test on 2026-06-10.
--
-- Problem:
--   public.hotels had FOUR SELECT policies. Two of them — "Everyone can view
--   hotels" and "hotels_read_all" — used USING (true). Per PostgreSQL RLS,
--   policies OR together, so the strict member-scoped policies were never
--   the binding gate. Effect: any authenticated user (and anon, since
--   anon has column-level SELECT grant on every column) could read every
--   hotel's PII (phone, email, address), commercial details (plan,
--   plan_status, plan_renews_at), regulatory identifiers (gst_number,
--   legal_name), payment routing (upi_id), WhatsApp Business credentials
--   (wa_phone_number_id, wa_display_number), and Razorpay account state.
--
--   Empirically observed: anon role + tenant1's ajit each saw 11 hotels
--   instead of the 0 / 3 they should have. The `v_public_hotels` view
--   inherited the same leak — it exposes the same sensitive columns to
--   anyone with PostgREST access.
--
-- Fix:
--   1. Drop the two "Everyone can view hotels" / "hotels_read_all" SELECT
--      policies. The two existing member-scoped SELECT policies
--      (hotels_select_for_members + "read member hotels") remain — they
--      correctly scope hotel-staff access to their own hotel.
--
--   2. Add a guest-of-stay SELECT policy. Guests authenticated via the
--      magic-link flow have a guest_user_map row resolving to a guest_id,
--      and may need to read fields like razorpay_mode / tax_percentage from
--      the hotels table for their stay (the GuestNewCheckout flow does
--      this). Scope: only hotels they have a stay at. Same pattern as
--      every other guest_view_own_X policy added in Batch A (20260603).
--
--   3. Rebuild `v_public_hotels` with a tight column list. The new view
--      keeps only storefront-safe fields needed by the consumers identified
--      in the audit (HotelOnboarding search, CheckInHome, CheckInSuccess,
--      GuestKYC, WalkInDetails, GuestNewSupport):
--        - identity:    id, slug, name
--        - branding:    brand_color, logo_url (logo_path), cover_image_url
--                       (cover_image_path), theme, description, amenities
--        - location:    address, city, state, country, postal_code,
--                       latitude, longitude
--        - contact:     phone, email, wa_display_number, booking_url
--        - operational: default_checkin_time, default_checkout_time,
--                       timezone, currency_code, status
--
--      Removed columns (still readable from `hotels` itself via the member
--      policy, but no longer leak through v_public_hotels to anon):
--        gst_number, legal_name, upi_id, tax_percentage,
--        service_charge_percentage, invoice_prefix, invoice_counter,
--        plan, plan_status, plan_renews_at, plan_notes, billing_*,
--        wa_phone_number_id, whatsapp_*, drip_daily_send_cap,
--        razorpay_*, ai_quote_drafts_*, ai_quote_daily_token_cap,
--        partner_verification_stale_days, allow_overbooking,
--        overbooking_limit, require_inspection, default_cleaning_minutes,
--        onboarding_*, go_live_at, is_setup_complete, lifecycle_status,
--        invoice_format, financial_year_start_month, sac_code,
--        early_checkin_allowed, late_checkout_allowed,
--        rooms_total, is_verified, tax_inclusive, created_at, updated_at.
--
--      The view stays callable by anon (so QR/storefront /
--      hotel-by-slug-lookup keeps working). Sensitive fields now ONLY
--      reach authenticated hotel members via the member-scoped policies on
--      the base table.
--
--   This migration touches NO authenticated-member workflow:
--     - Owners still read their full hotels row via the member policy
--     - Owners can still write via "Hotel admins can update hotel details"
--     - Platform admins still create via the existing INSERT policy
--     - Guest checkout (razorpay_mode etc.) flows through the new
--       hotels_guest_view_own_stay policy

BEGIN;

-- ─── 1. Drop the two cross-tenant SELECT leaks ──────────────────────────
DROP POLICY IF EXISTS "Everyone can view hotels" ON public.hotels;
DROP POLICY IF EXISTS "hotels_read_all"          ON public.hotels;

-- ─── 2. Authenticated-guest access to their stay's hotel ────────────────
DROP POLICY IF EXISTS "hotels_guest_view_own_stay" ON public.hotels;

CREATE POLICY "hotels_guest_view_own_stay"
  ON public.hotels
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.stays s
      WHERE s.hotel_id = hotels.id
        AND s.guest_id = public.current_guest_id()
    )
  );

-- ─── 3. Rebuild v_public_hotels with safe-only columns ──────────────────
-- Keep the same view name so frontend consumers (HotelOnboarding, CheckInHome,
-- CheckInSuccess, GuestKYC, WalkInDetails, GuestNewSupport) keep working.
-- Frontend column usage audit confirmed: none of the consumers reference any
-- of the removed columns.
--
-- Use DROP + CREATE (not CREATE OR REPLACE) because CREATE OR REPLACE VIEW
-- can only ADD trailing columns; removing/reshaping requires a drop.
DROP VIEW IF EXISTS public.v_public_hotels;

CREATE VIEW public.v_public_hotels AS
SELECT
  id,
  slug,
  name,
  phone,
  email,
  address,
  city,
  state,
  country,
  postal_code,
  latitude,
  longitude,
  logo_path        AS logo_url,
  cover_image_path AS cover_image_url,
  default_checkin_time,
  default_checkout_time,
  timezone,
  currency_code,
  brand_color,
  booking_url,
  amenities,
  description,
  theme,
  wa_display_number,
  status
FROM public.hotels
WHERE status = 'active' OR status IS NULL;

GRANT SELECT ON public.v_public_hotels TO anon, authenticated;

COMMIT;
