-- Google Place ID per hotel — enables the guest post-review Google funnel.
--
-- Why: the post-checkout review screen wants to send 4★+ guests to Google's
-- "write a review" deep link (https://search.google.com/local/writereview?placeid=…),
-- but no Place ID was stored anywhere (the old CTA pointed at a literal
-- REPLACE_WITH_ACTUAL_ID placeholder and was removed). Owners set the ID once
-- in Owner Settings; the guest CTA renders only when it is set — never a
-- broken or fabricated link.
--
-- A Place ID is public information (it identifies the hotel's public Google
-- Maps listing), so exposing it through v_public_hotels is safe and consistent
-- with the lockdown audit in 20260610000001 (safe-only columns).

-- ─── 1. hotels.google_place_id ───────────────────────────────────────────────
ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS google_place_id text;

COMMENT ON COLUMN public.hotels.google_place_id IS
  'Google Maps Place ID for this property (e.g. ChIJ…). Set in Owner Settings; powers the guest post-review "share on Google" deep link. Public info — exposed via v_public_hotels.';

-- ─── 2. v_public_hotels: append the column ───────────────────────────────────
-- Exact column list from 20260610000001 (the post-lockdown definition), with
-- google_place_id appended last — legal for CREATE OR REPLACE VIEW. Grants on
-- the view (anon, authenticated) are preserved by CREATE OR REPLACE.
CREATE OR REPLACE VIEW public.v_public_hotels AS
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
  status,
  google_place_id
FROM public.hotels
WHERE status = 'active' OR status IS NULL;
