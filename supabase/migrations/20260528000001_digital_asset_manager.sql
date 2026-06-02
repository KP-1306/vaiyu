-- Digital Asset Manager v0 — Position 6 of the growth sheet
--
-- Merges two product visions into one primitive:
--   • Asset Readiness Checklist (PO brief): system-defined catalog of
--     business-required hotel assets (signboard photo, business card,
--     room photos, etc.) with per-hotel status tracking. Drives a
--     readiness scorecard + Top Missing widget. Feeds Visibility Score
--     (Position 9) and Local SEO landing pages (Position 7).
--   • Asset Library (sequence doc card #11): central reusable store for
--     branded media so Package Builder (Position 5) + Quote PDFs (Position
--     3) + Microsite (future) don't each invent their own upload pipe.
--
-- Architecture in three layers:
--   1. asset_requirements   — system catalog, ~30 seeded rows. Read-only
--      from app perspective; mutations only via migration.
--   2. hotel_assets         — per-hotel tracking row, lazy-created on
--      first action. Holds status + workflow metadata + admin review.
--   3. hotel_asset_files    — 1-to-many under hotel_assets. The actual
--      uploaded files. Each row points to a storage object.
--
-- Dual-bucket storage:
--   • hotel-assets         — EXISTING public bucket; marketing-grade
--                            (rooms, food, view, exterior, logo, cover).
--                            Consumed by microsite/PDFs/emails as public URLs.
--   • hotel-asset-vault    — NEW private bucket; verification-grade
--                            (signboard photo, business card, blank invoice,
--                            letterhead, booking register). Signed URLs only,
--                            never publicly exposed.
--   Bucket choice is deterministic from asset_requirements.storage_zone —
--   owner cannot accidentally route a letterhead to the public bucket.
--
-- Approval workflow (future-ready, not used by owners in v0):
--   • COLLECTED set automatically on first file upload.
--   • APPROVED / REJECTED set by platform_admin only — represents VAiyu's
--     onboarding team having verified the asset is real, legible, and on-brand.
--   • Owner sees COLLECTED ✓ until reviewed; never sees a stuck "Pending".
--   • NEEDS_REPLACEMENT set automatically when files removed from a
--     previously COLLECTED/APPROVED row, OR by admin during review.
--   • MISSING is computed in the view (no hotel_assets row exists).
--
-- Privacy guardrails (enforced at RPC layer, not just UI):
--   • MIME allowlist (image/* + application/pdf only)
--   • Per-file size cap 10 MB
--   • Filename PII regex reject (aadhaar / pan / passport / cheque /
--     bank_statement / driving_license — case-insensitive, word-bounded)
--   • Storage zone CHECK constraint pins bucket to requirement
--   • Hotel folder enforced via split_part(path, '/', 1)::uuid
--
-- Backfill:
--   On migration, every hotel with logo_path / cover_image_path set gets
--   the corresponding requirement auto-linked with status=COLLECTED and
--   collected_via='AUTO_LINK_BRAND'. Owners see 1/2 of brand essentials
--   already ticked on day 1. Ongoing changes to hotels.logo_path /
--   cover_image_path keep the asset row in sync via a brand trigger.
--
-- Per CLAUDE.md:
--   • Multi-tenancy: vaiyu_is_hotel_member RLS on every table + view
--   • Money math: N/A (no pricing)
--   • Immutability: hotel_asset_files immutable post-INSERT; status
--     transitions logged in va_audit_logs
--   • Audit: vaiyu_log_audit shared helper (NOT a per-entity event table —
--     the dashboard surface here is the v_hotel_asset_status view, not
--     a timeline; audit goes to va_audit_logs)
--   • Idempotency: hotel_asset_files.idempotency_key UNIQUE partial
--     (same pattern as notification_queue)
--
-- ============================================================================

-- ─── Enums ──────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.asset_category AS ENUM (
    'VERIFICATION_PROOF',
    'TRUST_ESSENTIALS',
    'OPERATIONAL',
    'EXPERIENCE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.asset_priority AS ENUM (
    'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.asset_status AS ENUM (
    'COLLECTED', 'APPROVED', 'REJECTED', 'NEEDS_REPLACEMENT'
    -- MISSING is computed in the view, never stored
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.asset_storage_zone AS ENUM (
    'PUBLIC_MARKETING',  -- hotel-assets bucket; marketing reuse
    'PRIVATE_VAULT'      -- hotel-asset-vault bucket; signed-URL only
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── asset_requirements (system catalog) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.asset_requirements (
  code                     text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{2,80}$'),
  category                 public.asset_category   NOT NULL,
  priority                 public.asset_priority   NOT NULL,
  storage_zone             public.asset_storage_zone NOT NULL,
  display_name_en          text NOT NULL CHECK (length(btrim(display_name_en)) > 0),
  display_name_hi          text NOT NULL CHECK (length(btrim(display_name_hi)) > 0),
  why_it_matters_en        text NOT NULL CHECK (length(btrim(why_it_matters_en)) > 0),
  why_it_matters_hi        text NOT NULL CHECK (length(btrim(why_it_matters_hi)) > 0),
  recommended_action_en    text NOT NULL CHECK (length(btrim(recommended_action_en)) > 0),
  recommended_action_hi    text NOT NULL CHECK (length(btrim(recommended_action_hi)) > 0),
  allow_multiple_files     boolean NOT NULL DEFAULT false,
  sort_order               integer NOT NULL DEFAULT 100,
  is_active                boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.asset_requirements IS
  'System-defined catalog of business-required hotel assets. Per CLAUDE.md anti-features: no custom-per-hotel requirements — additions/edits only via migration. Each row defines what hotels are expected to collect and which bucket the files must land in.';

CREATE INDEX IF NOT EXISTS idx_asset_requirements_category_priority
  ON public.asset_requirements(category, priority, sort_order)
  WHERE is_active = true;

-- RLS: public read for authenticated users (catalog is not sensitive)
ALTER TABLE public.asset_requirements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asset_requirements_read_all ON public.asset_requirements;
CREATE POLICY asset_requirements_read_all
  ON public.asset_requirements FOR SELECT
  TO authenticated
  USING (true);

-- Writes blocked (no policy = no access). Only migrations / service_role mutate.

-- ─── hotel_assets (per-hotel tracking) ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hotel_assets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id            uuid NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  requirement_code    text NOT NULL REFERENCES public.asset_requirements(code) ON DELETE RESTRICT,
  status              public.asset_status NOT NULL,
  collected_via       text NOT NULL DEFAULT 'OWNER_UPLOAD'
    CHECK (collected_via IN ('OWNER_UPLOAD', 'AUTO_LINK_BRAND')),

  -- Owner notes (visible to owner)
  owner_notes         text CHECK (owner_notes IS NULL OR length(owner_notes) <= 2000),

  -- Internal notes (admin only; not surfaced to owner UI)
  internal_notes      text CHECK (internal_notes IS NULL OR length(internal_notes) <= 4000),
  rejection_reason    text CHECK (rejection_reason IS NULL OR length(rejection_reason) <= 1000),

  -- Review trail (set when APPROVED / REJECTED)
  reviewed_at         timestamptz,
  review_actor_id     uuid REFERENCES auth.users(id),
  review_actor_name   text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT hotel_assets_unique_per_requirement UNIQUE (hotel_id, requirement_code),
  CONSTRAINT hotel_assets_review_consistency CHECK (
    (status IN ('APPROVED', 'REJECTED')
       AND reviewed_at IS NOT NULL
       AND review_actor_id IS NOT NULL)
    OR
    (status IN ('COLLECTED', 'NEEDS_REPLACEMENT'))
  ),
  CONSTRAINT hotel_assets_rejection_has_reason CHECK (
    status <> 'REJECTED' OR (rejection_reason IS NOT NULL AND length(btrim(rejection_reason)) > 0)
  )
);

COMMENT ON TABLE public.hotel_assets IS
  'Per-hotel per-requirement tracking row. Lazy-created on first owner action (note, status change, or file upload). MISSING state is NEVER stored — it is computed by the v_hotel_asset_status view when no row exists.';

CREATE INDEX IF NOT EXISTS idx_hotel_assets_hotel_status
  ON public.hotel_assets(hotel_id, status);
CREATE INDEX IF NOT EXISTS idx_hotel_assets_requirement
  ON public.hotel_assets(requirement_code);

ALTER TABLE public.hotel_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hotel_assets_select_members ON public.hotel_assets;
CREATE POLICY hotel_assets_select_members
  ON public.hotel_assets FOR SELECT
  TO authenticated
  USING (public.vaiyu_is_hotel_member(hotel_id));

-- Writes only via SECURITY DEFINER RPCs; no direct INSERT/UPDATE/DELETE policies.

-- ─── hotel_asset_files (1-to-many) ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hotel_asset_files (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_asset_id           uuid NOT NULL REFERENCES public.hotel_assets(id) ON DELETE CASCADE,
  hotel_id                 uuid NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,

  bucket                   text NOT NULL
    CHECK (bucket IN ('hotel-assets', 'hotel-asset-vault')),
  storage_path             text NOT NULL CHECK (length(btrim(storage_path)) > 0),

  mime_type                text NOT NULL
    CHECK (mime_type IN (
      'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
      'application/pdf'
    )),
  file_size_bytes          integer NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760),

  width_px                 integer CHECK (width_px IS NULL OR width_px > 0),
  height_px                integer CHECK (height_px IS NULL OR height_px > 0),
  alt_text                 text CHECK (alt_text IS NULL OR length(alt_text) <= 280),
  sort_order               integer NOT NULL DEFAULT 0,

  -- Idempotency: same key resubmitted = no-op (mirrors notification_queue)
  idempotency_key          uuid,

  -- Provenance
  uploaded_by_actor_id     uuid REFERENCES auth.users(id),
  uploaded_by_actor_name   text,

  created_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT hotel_asset_files_unique_path UNIQUE (bucket, storage_path),
  -- Hotel folder enforcement: path must start with the hotel_id followed by '/'
  CONSTRAINT hotel_asset_files_path_starts_with_hotel CHECK (
    storage_path ~ ('^' || hotel_id::text || '/.+')
  )
);

COMMENT ON TABLE public.hotel_asset_files IS
  'Immutable per-file metadata for hotel assets. One hotel_assets row can have many files (rooms / food / etc.) or exactly one (signboard / business card). Rows are append-only — to update a file, INSERT a new row and DELETE the old.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_hotel_asset_files_idempotency
  ON public.hotel_asset_files(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hotel_asset_files_asset
  ON public.hotel_asset_files(hotel_asset_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_hotel_asset_files_hotel_bucket
  ON public.hotel_asset_files(hotel_id, bucket);

ALTER TABLE public.hotel_asset_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hotel_asset_files_select_members ON public.hotel_asset_files;
CREATE POLICY hotel_asset_files_select_members
  ON public.hotel_asset_files FOR SELECT
  TO authenticated
  USING (public.vaiyu_is_hotel_member(hotel_id));

-- Writes only via SECURITY DEFINER RPCs.

-- Immutability triggers (mirror trg_restrict_payment_update pattern)
CREATE OR REPLACE FUNCTION public._restrict_hotel_asset_file_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('vaiyu.allow_asset_file_mutation', true) = 'on' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'IMMUTABLE_RECORD: hotel_asset_files rows are append-only. INSERT a new row + DELETE the old to replace.'
    USING ERRCODE = '23000';
END $$;

DROP TRIGGER IF EXISTS trg_restrict_hotel_asset_file_update ON public.hotel_asset_files;
CREATE TRIGGER trg_restrict_hotel_asset_file_update
  BEFORE UPDATE OF bucket, storage_path, mime_type, file_size_bytes,
                   hotel_asset_id, hotel_id, idempotency_key, created_at,
                   uploaded_by_actor_id, uploaded_by_actor_name
  ON public.hotel_asset_files
  FOR EACH ROW
  EXECUTE FUNCTION public._restrict_hotel_asset_file_mutation();

-- (sort_order and alt_text are mutable — they're presentation, not identity)

-- ─── updated_at triggers ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._touch_hotel_assets_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_hotel_assets_touch ON public.hotel_assets;
CREATE TRIGGER trg_hotel_assets_touch
  BEFORE UPDATE ON public.hotel_assets
  FOR EACH ROW
  EXECUTE FUNCTION public._touch_hotel_assets_updated_at();

DROP TRIGGER IF EXISTS trg_asset_requirements_touch ON public.asset_requirements;
CREATE TRIGGER trg_asset_requirements_touch
  BEFORE UPDATE ON public.asset_requirements
  FOR EACH ROW
  EXECUTE FUNCTION public._touch_hotel_assets_updated_at();

-- (Storage bucket + RLS moved to END of migration — they require
--  supabase_storage_admin privileges; deferring lets the rest of the
--  schema apply cleanly even when the migration runner lacks that role.
--  Existing hotel-assets public-bucket policies are unchanged either way.)

-- ─── Catalog seed (28 requirements across 4 categories) ────────────────────

INSERT INTO public.asset_requirements
  (code, category, priority, storage_zone, display_name_en, display_name_hi,
   why_it_matters_en, why_it_matters_hi, recommended_action_en, recommended_action_hi,
   allow_multiple_files, sort_order)
VALUES
  -- VERIFICATION_PROOF (sort 100-199)
  ('verification_signboard_exterior', 'VERIFICATION_PROOF', 'CRITICAL', 'PRIVATE_VAULT',
   'Permanent signboard photo',
   'स्थायी साइनबोर्ड फोटो',
   'Google verification reviewers compare your signboard to the registered business name. A clear, daylit signboard photo is the single most important verification artifact.',
   'Google verification ke liye aapke hotel ka signboard saaf-saaf dikhna chahiye. Yahi sabse zaroori proof hai.',
   'Daytime photo from across the road. Full signboard visible, business name readable.',
   'Din ke ujale mein, saamne se khinchi photo. Pura board aur naam saaf dikhna chahiye.',
   false, 100),

  ('verification_entrance_front', 'VERIFICATION_PROOF', 'CRITICAL', 'PRIVATE_VAULT',
   'Entrance / front view photo',
   'मुख्य प्रवेश द्वार / सामने का फोटो',
   'Establishes physical presence at the registered address. Required for Google Business Profile photo guidelines.',
   'Hotel ke saamne ka pura view dikhna chahiye. Address verify karne ke liye zaroori hai.',
   'Wide-angle photo from the road showing the entrance and immediate surroundings.',
   'Sadak se khinchi wide-angle photo. Entrance aur aas-paas ka maahaul dikhna chahiye.',
   false, 110),

  ('verification_approach_road', 'VERIFICATION_PROOF', 'HIGH', 'PRIVATE_VAULT',
   'Approach road / landmark photo',
   'पहुँच मार्ग / लैंडमार्क फोटो',
   'Helps verification reviewers and guests locate the property using landmarks.',
   'Nearest landmark se hotel tak ka raasta dikhna chahiye. Guests aur Google dono ko fayda.',
   'Photo showing the road or junction leading to the hotel with a recognisable landmark.',
   'Hotel tak pahunchne ka raasta ya nearest landmark dikhane wali photo.',
   false, 120),

  ('verification_business_card', 'VERIFICATION_PROOF', 'HIGH', 'PRIVATE_VAULT',
   'Business card',
   'विज़िटिंग कार्ड',
   'Demonstrates registered business identity. Use the official business card with hotel name, address, and phone.',
   'Hotel ka official visiting card. Naam, address aur phone clear hone chahiye.',
   'Scan or photo of the business card, both sides if applicable.',
   'Visiting card ka scan ya photo. Dono side ka ho to behtar.',
   false, 130),

  ('verification_letterhead', 'VERIFICATION_PROOF', 'HIGH', 'PRIVATE_VAULT',
   'Letterhead',
   'लेटरहेड',
   'Demonstrates formal business identity. Used by VAiyu onboarding team for verification dossier.',
   'Hotel ka official letterhead. Onboarding team verification ke liye use karti hai.',
   'PDF or image of your blank business letterhead.',
   'Blank letterhead ka PDF ya photo.',
   false, 140),

  ('verification_blank_invoice', 'VERIFICATION_PROOF', 'HIGH', 'PRIVATE_VAULT',
   'Blank invoice / receipt template',
   'खाली बिल / रसीद टेम्पलेट',
   'Confirms operational business with documented billing. Use a sample blank invoice, not one with guest data.',
   'Aapke hotel ka blank bill format. Khaali template — kisi guest ki details na ho.',
   'Photo or PDF of a blank invoice template. Do not include any guest data.',
   'Blank bill / receipt format. Kisi guest ka data NA HO.',
   false, 150),

  ('verification_booking_register', 'VERIFICATION_PROOF', 'MEDIUM', 'PRIVATE_VAULT',
   'Booking register cover',
   'बुकिंग रजिस्टर कवर',
   'The physical guest register is required by Indian hospitality regulations. Showing the cover proves you maintain one.',
   'Government rules ke according booking register hona zaroori hai. Sirf cover ki photo, andar ka data NA dikhayein.',
   'Photo of the closed register''s front cover only — never of inside pages with guest data.',
   'Sirf register ke cover ki photo. Andar ke pages ki photo NA lein.',
   false, 160),

  ('verification_branded_menu', 'VERIFICATION_PROOF', 'MEDIUM', 'PRIVATE_VAULT',
   'Branded menu',
   'ब्रांडेड मेन्यू',
   'Demonstrates active food service operations. Used by verification team to confirm in-house dining.',
   'In-house restaurant ka proof. Verification team ko dikhana padta hai.',
   'Photo or PDF of your hotel''s branded food menu.',
   'Aapke hotel ka branded food menu ki photo ya PDF.',
   false, 170),

  ('verification_reception_desk', 'VERIFICATION_PROOF', 'HIGH', 'PRIVATE_VAULT',
   'Reception / operations area',
   'रिसेप्शन / ऑपरेशन एरिया',
   'Confirms physical operations are active. Photo of a staffed (or staff-ready) reception desk.',
   'Hotel chal raha hai — reception desk ki photo se yeh confirm hota hai.',
   'Photo of the reception desk during operating hours. Staff in photo is optional but adds credibility.',
   'Reception desk ki photo, kaam ke time. Staff dikhana optional hai.',
   false, 180),

  -- TRUST_ESSENTIALS (sort 200-299) — PUBLIC bucket; reusable across modules
  ('trust_logo_brand_assets', 'TRUST_ESSENTIALS', 'CRITICAL', 'PUBLIC_MARKETING',
   'Logo / brand mark',
   'लोगो / ब्रांड मार्क',
   'Used on Quote PDFs, microsite, branded emails, and the Google Business Profile.',
   'Logo aapke quotes, emails, aur microsite par dikhega. Saaf aur high-resolution chahiye.',
   'Square format preferred. PNG with transparent background ideal. Min 500×500 px.',
   'Square PNG, transparent background, kam-se-kam 500×500 px.',
   false, 200),

  ('trust_cover_image', 'TRUST_ESSENTIALS', 'HIGH', 'PUBLIC_MARKETING',
   'Cover / hero image',
   'कवर / हीरो इमेज',
   'Headline image for the hotel''s microsite, package landing pages, and dashboards. First impression of the property online.',
   'Microsite aur package landing pages ka main image. Guests sabse pehle yahi dekhte hain.',
   'Landscape 16:9. Daytime, exterior or signature view. Min 1920×1080 px.',
   '16:9 landscape, din ka time, ya exterior ya signature view. Min 1920×1080 px.',
   false, 210),

  ('trust_room_photos', 'TRUST_ESSENTIALS', 'CRITICAL', 'PUBLIC_MARKETING',
   'Room photos',
   'कमरे की फोटो',
   'Drive booking conversion. Used by Package Builder hero, Quote PDF inclusions, and microsite.',
   'Bookings convert karne ke liye sabse zaroori. Package builder aur quotes mein use hote hain.',
   'At least one well-lit photo per room category. Made bed, tidy desk, curtains open.',
   'Har room category ki kam-se-kam ek photo. Saaf, tidy, parde khulay.',
   true, 220),

  ('trust_bathroom_photos', 'TRUST_ESSENTIALS', 'HIGH', 'PUBLIC_MARKETING',
   'Bathroom photos',
   'बाथरूम फोटो',
   'OTA guests filter on bathroom quality. Missing bathroom photos suppress impressions.',
   'OTA guests bathroom photo dekh kar book karte hain. Bina photo ke listings down rank ho sakti hain.',
   'Clean, well-lit. Show toiletries / shower / sink. Avoid mirror reflections of the photographer.',
   'Saaf-suthri, achhi lighting. Mirror mein khud na dikhein.',
   true, 230),

  ('trust_common_areas', 'TRUST_ESSENTIALS', 'HIGH', 'PUBLIC_MARKETING',
   'Reception / lobby / common areas',
   'रिसेप्शन / लॉबी / कॉमन एरिया',
   'Signals hotel scale and standard. Used for verification supplements and microsite secondary images.',
   'Hotel ka size aur standard dikhta hai. Microsite par lobby ki photo zaroor jaati hai.',
   'Lobby, sitting area, corridors. People (anonymised or absent) are fine.',
   'Lobby, baithak, corridor. Logo n ya logo k bina, dono chalega.',
   true, 240),

  ('trust_dining_food', 'TRUST_ESSENTIALS', 'HIGH', 'PUBLIC_MARKETING',
   'Dining / food photos',
   'खाने की फोटो',
   'Hotels with food photos see ~30% higher OTA click-through. Critical for Package Builder food inclusions.',
   'Khaane ki photos se OTA clicks badhte hain — almost 30% zyada. Package builder mein bhi use hoti hain.',
   'Plated dishes, breakfast spread, dining area. Natural light preferred over flash.',
   'Plated dishes ki photos, breakfast layout. Natural light better.',
   true, 250),

  ('trust_parking', 'TRUST_ESSENTIALS', 'MEDIUM', 'PUBLIC_MARKETING',
   'Parking',
   'पार्किंग',
   'Domestic guests in Uttarakhand check parking availability before booking. Showing it converts.',
   'Uttarakhand mein guests parking dekhar book karte hain. Photo dikhana zaroori hai.',
   'Photo of the parking area with capacity visible. Show whether covered / open.',
   'Parking area ki photo, capacity dikhe. Covered ya open dono note karein.',
   true, 260),

  ('trust_view_surroundings', 'TRUST_ESSENTIALS', 'HIGH', 'PUBLIC_MARKETING',
   'View / surroundings',
   'व्यू / आसपास का माहौल',
   'Uttarakhand guests book for the view. Hill/forest/river views need to be the headline images.',
   'Uttarakhand mein guests view ke liye aate hain. Hill, jungle, river view zaroor dikhayein.',
   'Photos from balconies, rooftops, or surrounding viewpoints. Golden-hour shots convert best.',
   'Balcony, chhat ya nearby viewpoint se. Sunrise ya sunset best hoti hain.',
   true, 270),

  -- OPERATIONAL (sort 300-399)
  ('operational_menu_photo', 'OPERATIONAL', 'MEDIUM', 'PUBLIC_MARKETING',
   'Food / service menu',
   'फूड / सर्विस मेन्यू',
   'Used on microsite and packages. Owners can attach the same file referenced in Verification Proof.',
   'Microsite aur packages mein use hota hai. Yahi menu Verification Proof mein bhi de sakte hain.',
   'PDF or image of the active food / spa / service menu.',
   'Active menu (food, spa, services) ka PDF ya photo.',
   false, 300),

  ('operational_service_list', 'OPERATIONAL', 'MEDIUM', 'PUBLIC_MARKETING',
   'Service / amenities sheet',
   'सेवा / सुविधा शीट',
   'Owners list amenities in onboarding but a one-page sheet helps guests scan quickly.',
   'Amenities ka one-page sheet — guests jaldi padh sakein.',
   'PDF or graphic listing major amenities (wifi, parking, breakfast, etc.).',
   'Wifi, parking, breakfast jaise amenities ka ek-page graphic ya PDF.',
   false, 310),

  ('operational_room_category_images', 'OPERATIONAL', 'MEDIUM', 'PUBLIC_MARKETING',
   'Per-room-category images',
   'प्रति-रूम-कैटेगरी इमेज',
   'Each room category (Deluxe / Suite / Family) needs its own image for Package Builder selection.',
   'Har room category — Deluxe, Suite, Family — ki alag image chahiye package builder ke liye.',
   'One signature image per active room category. Distinct from generic Room Photos.',
   'Har active room category ki ek signature image.',
   true, 320),

  ('operational_qr_placement', 'OPERATIONAL', 'LOW', 'PRIVATE_VAULT',
   'In-room QR placement proof',
   'इन-रूम क्यूआर प्लेसमेंट प्रूफ',
   'Confirms VAiyu QR codes are actually installed in guest rooms.',
   'VAiyu ke QR codes kamre mein lagaye gaye hain — uska photo proof.',
   'Photo showing QR code mounted in a guest room context.',
   'Kamre mein QR code laga hua dikhna chahiye.',
   true, 330),

  ('operational_staff_uniform', 'OPERATIONAL', 'LOW', 'PUBLIC_MARKETING',
   'Staff in uniform',
   'यूनिफॉर्म में स्टाफ',
   'Optional credibility signal for the microsite. Get explicit staff consent before uploading.',
   'Microsite ke liye optional. Staff se permission lekar hi upload karein.',
   'Photo of front-desk / housekeeping in uniform. Staff consent required.',
   'Front-desk ya housekeeping uniform mein. Staff ki permission lekar.',
   false, 340),

  -- EXPERIENCE (sort 400-499)
  ('experience_local_attractions', 'EXPERIENCE', 'MEDIUM', 'PUBLIC_MARKETING',
   'Local attractions',
   'स्थानीय आकर्षण',
   'Used by Local SEO landing pages and Package Builder experience cards.',
   'Local SEO pages aur package experience cards mein use hota hai.',
   'Photos of nearby attractions, viewpoints, temples, trails. Each tagged or captioned.',
   'Aas-paas ke attractions, viewpoint, temple, trail ki photos.',
   true, 400),

  ('experience_packages', 'EXPERIENCE', 'MEDIUM', 'PUBLIC_MARKETING',
   'Package / experience photos',
   'पैकेज / एक्सपीरियंस फोटो',
   'Per-package hero and inclusion images for the Package Builder.',
   'Package builder mein har package ke liye hero aur inclusion images.',
   'One hero image per package + one image per major inclusion.',
   'Har package ke liye ek hero image + har inclusion ki ek photo.',
   true, 410),

  ('experience_trek_tour', 'EXPERIENCE', 'LOW', 'PUBLIC_MARKETING',
   'Trek / tour photos',
   'ट्रेक / टूर फोटो',
   'For trekking-focused packages and Uttarakhand adventure positioning.',
   'Trekking packages aur Uttarakhand adventure positioning ke liye.',
   'Photos from past treks or tours your hotel has organised.',
   'Aapke hotel ne organize kiye trek/tour ki photos.',
   true, 420),

  ('experience_temple_spiritual', 'EXPERIENCE', 'LOW', 'PUBLIC_MARKETING',
   'Temple / spiritual destinations',
   'मंदिर / आध्यात्मिक स्थल',
   'For Char Dham / religious-tourism packages and seasonal microsite content.',
   'Char Dham aur religious-tourism packages ke liye.',
   'Photos of nearby temples or spiritual sites your packages connect to.',
   'Nearby temples ya spiritual sites jin tak aapke package le jaate hain.',
   true, 430),

  ('experience_wellness_yoga', 'EXPERIENCE', 'LOW', 'PUBLIC_MARKETING',
   'Wellness / yoga setting',
   'वेलनेस / योग सेटिंग',
   'For Rishikesh-style wellness packages and seasonal monsoon yoga retreats.',
   'Rishikesh-style wellness aur monsoon yoga retreats ke liye.',
   'Photos of yoga shala, meditation deck, river-side wellness setups.',
   'Yoga shala, meditation deck, river-side wellness setup ki photos.',
   true, 440),

  ('experience_seasonal_offers', 'EXPERIENCE', 'LOW', 'PUBLIC_MARKETING',
   'Seasonal offer visuals',
   'सीज़नल ऑफर विज़ुअल्स',
   'Used by Seasonal Demand Calendar (Position 8) for campaign launches.',
   'Seasonal Demand Calendar feature mein use honge campaign launches ke liye.',
   'Graphics or photos themed around upcoming seasons (winter rush, monsoon, summer Char Dham).',
   'Aane wale season (sardiyaan, monsoon, summer Char Dham) ke theme par graphics ya photos.',
   true, 450)

ON CONFLICT (code) DO UPDATE SET
  category               = EXCLUDED.category,
  priority               = EXCLUDED.priority,
  storage_zone           = EXCLUDED.storage_zone,
  display_name_en        = EXCLUDED.display_name_en,
  display_name_hi        = EXCLUDED.display_name_hi,
  why_it_matters_en      = EXCLUDED.why_it_matters_en,
  why_it_matters_hi      = EXCLUDED.why_it_matters_hi,
  recommended_action_en  = EXCLUDED.recommended_action_en,
  recommended_action_hi  = EXCLUDED.recommended_action_hi,
  allow_multiple_files   = EXCLUDED.allow_multiple_files,
  sort_order             = EXCLUDED.sort_order,
  is_active              = true,
  updated_at             = now();

-- ─── Views ─────────────────────────────────────────────────────────────────

-- v_hotel_asset_status: the primary read surface for the owner UI.
-- LEFT JOIN computes MISSING for requirements with no hotel_assets row.
DROP VIEW IF EXISTS public.v_hotel_asset_status CASCADE;
CREATE VIEW public.v_hotel_asset_status WITH (security_invoker = on) AS
SELECT
  r.code                    AS requirement_code,
  r.category,
  r.priority,
  r.storage_zone,
  r.display_name_en,
  r.display_name_hi,
  r.why_it_matters_en,
  r.why_it_matters_hi,
  r.recommended_action_en,
  r.recommended_action_hi,
  r.allow_multiple_files,
  r.sort_order,
  CASE r.priority
    WHEN 'CRITICAL' THEN 0
    WHEN 'HIGH'     THEN 1
    WHEN 'MEDIUM'   THEN 2
    WHEN 'LOW'      THEN 3
  END                       AS priority_rank,
  CASE r.category
    WHEN 'VERIFICATION_PROOF' THEN 0
    WHEN 'TRUST_ESSENTIALS'   THEN 1
    WHEN 'OPERATIONAL'        THEN 2
    WHEN 'EXPERIENCE'         THEN 3
  END                       AS category_rank,
  h.id                      AS hotel_id,
  ha.id                     AS hotel_asset_id,
  COALESCE(ha.status::text, 'MISSING')  AS status,
  ha.collected_via,
  ha.owner_notes,
  ha.internal_notes,
  ha.rejection_reason,
  ha.reviewed_at,
  ha.review_actor_name,
  ha.updated_at             AS asset_updated_at,
  COALESCE(fc.file_count, 0)  AS file_count,
  fc.last_file_at
FROM public.asset_requirements r
CROSS JOIN public.hotels h
LEFT JOIN public.hotel_assets ha
  ON ha.hotel_id = h.id AND ha.requirement_code = r.code
LEFT JOIN LATERAL (
  SELECT COUNT(*)::integer AS file_count, MAX(created_at) AS last_file_at
  FROM public.hotel_asset_files
  WHERE hotel_asset_id = ha.id
) fc ON true
WHERE r.is_active = true
  AND public.vaiyu_is_hotel_member(h.id);

COMMENT ON VIEW public.v_hotel_asset_status IS
  'Primary read surface for the Digital Asset Manager owner UI. Returns every active requirement crossed with every hotel the caller is a member of, with computed MISSING status when no per-hotel row exists. Always RLS-scoped via security_invoker.';

-- v_hotel_visible_assets: reuse hook for Package Builder / Quote PDF / Microsite.
DROP VIEW IF EXISTS public.v_hotel_visible_assets CASCADE;
CREATE VIEW public.v_hotel_visible_assets WITH (security_invoker = on) AS
SELECT
  ha.hotel_id,
  r.code                AS requirement_code,
  r.category,
  r.storage_zone,
  ha.status,
  f.id                  AS file_id,
  f.bucket,
  f.storage_path,
  f.mime_type,
  f.alt_text,
  f.sort_order,
  f.created_at          AS file_created_at
FROM public.hotel_assets ha
JOIN public.asset_requirements r ON r.code = ha.requirement_code
JOIN public.hotel_asset_files f  ON f.hotel_asset_id = ha.id
WHERE ha.status IN ('COLLECTED', 'APPROVED')
  AND r.is_active = true
  AND public.vaiyu_is_hotel_member(ha.hotel_id);

COMMENT ON VIEW public.v_hotel_visible_assets IS
  'Reuse hook for Package Builder, Quote PDF, and Microsite. Returns the actual file rows for requirements that have at least one file collected. Filters out REJECTED and NEEDS_REPLACEMENT to keep stale or rejected media out of guest-facing surfaces.';

-- ─── RPC: filename PII guardrail (helper) ───────────────────────────────────

CREATE OR REPLACE FUNCTION public._asset_filename_has_pii(p_path text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  -- Word-bounded match against common PII document name patterns.
  -- Catches obvious uploads like "aadhaar.jpg", "pan-card.png", "passport.pdf"
  -- without false-positiving "panorama" / "japanese" / etc.
  SELECT lower(p_path) ~ '\m(aadhaar|aadhar|pancard|pan.card|pan.copy|passport|cheque|bankstatement|bank.statement|drivinglicen[sc]e|driving.licen[sc]e|voter.?id)\M';
$$;

COMMENT ON FUNCTION public._asset_filename_has_pii IS
  'Returns true if the path/filename appears to contain personal identity document patterns. Word-bounded to avoid false positives. Final defence is owner education and human review — this just blocks the obvious case.';

-- ─── RPC: record_hotel_asset_file ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_hotel_asset_file(
  p_hotel_id          uuid,
  p_requirement_code  text,
  p_bucket            text,
  p_storage_path      text,
  p_mime_type         text,
  p_file_size_bytes   integer,
  p_idempotency_key   uuid,
  p_width_px          integer DEFAULT NULL,
  p_height_px         integer DEFAULT NULL,
  p_alt_text          text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_req           public.asset_requirements%ROWTYPE;
  v_asset         public.hotel_assets%ROWTYPE;
  v_existing      public.hotel_asset_files%ROWTYPE;
  v_file_id       uuid;
  v_actor_id      uuid := auth.uid();
  v_actor_name    text;
  v_old_status    public.asset_status;
BEGIN
  -- Membership gate
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_HOTEL_MEMBER' USING ERRCODE = '42501';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED' USING ERRCODE = '23502';
  END IF;

  -- Idempotency short-circuit: same key already used → return existing row
  SELECT * INTO v_existing
    FROM public.hotel_asset_files
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'file_id', v_existing.id,
      'hotel_asset_id', v_existing.hotel_asset_id
    );
  END IF;

  -- Requirement lookup
  SELECT * INTO v_req
    FROM public.asset_requirements
    WHERE code = p_requirement_code AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNKNOWN_REQUIREMENT' USING ERRCODE = '23503';
  END IF;

  -- Bucket / storage_zone alignment
  IF (v_req.storage_zone = 'PRIVATE_VAULT' AND p_bucket <> 'hotel-asset-vault') OR
     (v_req.storage_zone = 'PUBLIC_MARKETING' AND p_bucket <> 'hotel-assets') THEN
    RAISE EXCEPTION 'WRONG_BUCKET_FOR_ZONE: requirement % expects bucket for zone %, got %',
      p_requirement_code, v_req.storage_zone, p_bucket
      USING ERRCODE = '22023';
  END IF;

  -- Path must live under this hotel's folder
  IF p_storage_path !~ ('^' || p_hotel_id::text || '/.+') THEN
    RAISE EXCEPTION 'STORAGE_PATH_OUTSIDE_HOTEL_FOLDER' USING ERRCODE = '22023';
  END IF;

  -- Filename PII guardrail
  IF public._asset_filename_has_pii(p_storage_path) THEN
    RAISE EXCEPTION 'PII_FILENAME_REJECTED: Personal identity documents are not accepted. Only public business materials.'
      USING ERRCODE = '22023';
  END IF;

  -- MIME allowlist
  IF p_mime_type NOT IN (
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'
  ) THEN
    RAISE EXCEPTION 'MIME_NOT_ALLOWED: %', p_mime_type USING ERRCODE = '22023';
  END IF;

  -- Size cap (also enforced by bucket + CHECK)
  IF p_file_size_bytes <= 0 OR p_file_size_bytes > 10485760 THEN
    RAISE EXCEPTION 'FILE_TOO_LARGE: file size must be 1..10485760 bytes, got %', p_file_size_bytes
      USING ERRCODE = '22023';
  END IF;

  -- Actor name (best-effort; for audit). Uses canonical helper.
  v_actor_name := public._user_display_name(v_actor_id);

  -- Upsert hotel_assets row
  SELECT * INTO v_asset
    FROM public.hotel_assets
    WHERE hotel_id = p_hotel_id AND requirement_code = p_requirement_code;

  IF NOT FOUND THEN
    INSERT INTO public.hotel_assets (hotel_id, requirement_code, status, collected_via)
    VALUES (p_hotel_id, p_requirement_code, 'COLLECTED', 'OWNER_UPLOAD')
    RETURNING * INTO v_asset;
    v_old_status := NULL;
  ELSE
    v_old_status := v_asset.status;
    -- Bump back to COLLECTED if the row was NEEDS_REPLACEMENT or REJECTED.
    -- APPROVED stays APPROVED (admin review still valid; the new file is just
    -- an additional one within an already-approved multi-file requirement).
    IF v_asset.status IN ('NEEDS_REPLACEMENT', 'REJECTED') THEN
      UPDATE public.hotel_assets
        SET status = 'COLLECTED',
            collected_via = 'OWNER_UPLOAD',
            rejection_reason = NULL,
            reviewed_at = NULL,
            review_actor_id = NULL,
            review_actor_name = NULL
        WHERE id = v_asset.id
        RETURNING * INTO v_asset;
    END IF;
  END IF;

  -- For single-file requirements, evict prior files (idempotency_key already
  -- short-circuited above, so this only fires for genuine replacement).
  IF NOT v_req.allow_multiple_files THEN
    DELETE FROM public.hotel_asset_files
      WHERE hotel_asset_id = v_asset.id;
  END IF;

  -- Insert the file row
  INSERT INTO public.hotel_asset_files (
    hotel_asset_id, hotel_id, bucket, storage_path, mime_type,
    file_size_bytes, width_px, height_px, alt_text,
    sort_order, idempotency_key,
    uploaded_by_actor_id, uploaded_by_actor_name
  )
  VALUES (
    v_asset.id, p_hotel_id, p_bucket, p_storage_path, p_mime_type,
    p_file_size_bytes, p_width_px, p_height_px, p_alt_text,
    COALESCE(
      (SELECT COALESCE(MAX(sort_order), -1) + 1
         FROM public.hotel_asset_files
         WHERE hotel_asset_id = v_asset.id),
      0
    ),
    p_idempotency_key,
    v_actor_id, v_actor_name
  )
  RETURNING id INTO v_file_id;

  -- Audit
  PERFORM public.vaiyu_log_audit(
    'asset_file_recorded',
    'hotel_asset_files',
    v_file_id,
    p_hotel_id,
    jsonb_build_object(
      'requirement_code', p_requirement_code,
      'bucket', p_bucket,
      'storage_path', p_storage_path,
      'mime_type', p_mime_type,
      'file_size_bytes', p_file_size_bytes,
      'previous_status', v_old_status,
      'new_status', v_asset.status
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'file_id', v_file_id,
    'hotel_asset_id', v_asset.id,
    'previous_status', v_old_status,
    'new_status', v_asset.status
  );
END $$;

COMMENT ON FUNCTION public.record_hotel_asset_file IS
  'Idempotent RPC to record a file uploaded to either hotel-assets (public) or hotel-asset-vault (private) bucket against a known requirement. Validates bucket/zone alignment, MIME allowlist, size cap, hotel folder ownership, and PII filename patterns. Lazy-creates hotel_assets row.';

-- ─── RPC: remove_hotel_asset_file ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.remove_hotel_asset_file(
  p_file_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_file        public.hotel_asset_files%ROWTYPE;
  v_asset       public.hotel_assets%ROWTYPE;
  v_remaining   integer;
  v_new_status  public.asset_status;
BEGIN
  SELECT * INTO v_file FROM public.hotel_asset_files WHERE id = p_file_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FILE_NOT_FOUND' USING ERRCODE = '02000';
  END IF;

  IF NOT public.vaiyu_is_hotel_member(v_file.hotel_id) THEN
    RAISE EXCEPTION 'NOT_HOTEL_MEMBER' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_asset FROM public.hotel_assets WHERE id = v_file.hotel_asset_id;

  DELETE FROM public.hotel_asset_files WHERE id = p_file_id;

  SELECT COUNT(*) INTO v_remaining
    FROM public.hotel_asset_files
    WHERE hotel_asset_id = v_asset.id;

  -- State transition on last-file removal
  IF v_remaining = 0 AND v_asset.status IN ('COLLECTED', 'APPROVED') THEN
    v_new_status := 'NEEDS_REPLACEMENT';
    UPDATE public.hotel_assets
      SET status = v_new_status,
          reviewed_at = NULL,
          review_actor_id = NULL,
          review_actor_name = NULL
      WHERE id = v_asset.id;
  ELSE
    v_new_status := v_asset.status;
  END IF;

  PERFORM public.vaiyu_log_audit(
    'asset_file_removed',
    'hotel_asset_files',
    p_file_id,
    v_file.hotel_id,
    jsonb_build_object(
      'requirement_code', v_asset.requirement_code,
      'bucket', v_file.bucket,
      'storage_path', v_file.storage_path,
      'remaining_files', v_remaining,
      'previous_status', v_asset.status,
      'new_status', v_new_status
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'hotel_asset_id', v_asset.id,
    'remaining_files', v_remaining,
    'previous_status', v_asset.status,
    'new_status', v_new_status,
    'storage_path', v_file.storage_path,
    'bucket', v_file.bucket
  );
END $$;

COMMENT ON FUNCTION public.remove_hotel_asset_file IS
  'Deletes the metadata row. Caller is expected to also delete the storage object via supabase.storage.from(bucket).remove([path]) — the returned bucket/storage_path makes that easy. Audit-logged. Auto-bumps the parent status to NEEDS_REPLACEMENT if the last file is gone.';

-- ─── RPC: reorder_hotel_asset_files ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reorder_hotel_asset_files(
  p_hotel_asset_id  uuid,
  p_ordered_ids     uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_asset    public.hotel_assets%ROWTYPE;
  v_count    integer;
  v_i        integer;
BEGIN
  SELECT * INTO v_asset FROM public.hotel_assets WHERE id = p_hotel_asset_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSET_NOT_FOUND' USING ERRCODE = '02000';
  END IF;
  IF NOT public.vaiyu_is_hotel_member(v_asset.hotel_id) THEN
    RAISE EXCEPTION 'NOT_HOTEL_MEMBER' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM public.hotel_asset_files
    WHERE hotel_asset_id = p_hotel_asset_id
      AND id = ANY(p_ordered_ids);
  IF v_count <> array_length(p_ordered_ids, 1) THEN
    RAISE EXCEPTION 'REORDER_LIST_MISMATCH: not all file IDs belong to this asset'
      USING ERRCODE = '22023';
  END IF;

  -- sort_order is not in the immutability trigger's column list, so the
  -- update is allowed; identity columns stay locked.
  FOR v_i IN 1 .. array_length(p_ordered_ids, 1) LOOP
    UPDATE public.hotel_asset_files
      SET sort_order = v_i - 1
      WHERE id = p_ordered_ids[v_i];
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'count', v_count);
END $$;

COMMENT ON FUNCTION public.reorder_hotel_asset_files IS
  'Bulk re-orders files under one hotel_assets row. The full list must be passed; partial reorders are rejected to keep state deterministic.';

-- ─── RPC: set_hotel_asset_status (owner-side: COLLECTED ↔ NEEDS_REPLACEMENT) ─

CREATE OR REPLACE FUNCTION public.set_hotel_asset_status(
  p_hotel_id          uuid,
  p_requirement_code  text,
  p_status            public.asset_status,
  p_owner_notes       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_asset      public.hotel_assets%ROWTYPE;
  v_file_cnt   integer;
  v_old_status public.asset_status;
BEGIN
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_HOTEL_MEMBER' USING ERRCODE = '42501';
  END IF;

  -- Owner can only toggle COLLECTED ↔ NEEDS_REPLACEMENT.
  -- APPROVED and REJECTED are admin-only via approve_hotel_asset / reject_hotel_asset.
  IF p_status NOT IN ('COLLECTED', 'NEEDS_REPLACEMENT') THEN
    RAISE EXCEPTION 'STATUS_NOT_ALLOWED_FROM_OWNER: owner can only set COLLECTED or NEEDS_REPLACEMENT'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_asset
    FROM public.hotel_assets
    WHERE hotel_id = p_hotel_id AND requirement_code = p_requirement_code;

  IF NOT FOUND THEN
    -- Lazy-create only allows status transition if there are no files yet
    IF p_status <> 'NEEDS_REPLACEMENT' THEN
      RAISE EXCEPTION 'NO_FILES_TO_MARK_COLLECTED' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.hotel_assets (hotel_id, requirement_code, status, collected_via, owner_notes)
    VALUES (p_hotel_id, p_requirement_code, 'NEEDS_REPLACEMENT', 'OWNER_UPLOAD', p_owner_notes)
    RETURNING * INTO v_asset;
    v_old_status := NULL;
  ELSE
    v_old_status := v_asset.status;
    -- COLLECTED requires at least one file
    IF p_status = 'COLLECTED' THEN
      SELECT COUNT(*) INTO v_file_cnt
        FROM public.hotel_asset_files
        WHERE hotel_asset_id = v_asset.id;
      IF v_file_cnt = 0 THEN
        RAISE EXCEPTION 'NO_FILES_TO_MARK_COLLECTED' USING ERRCODE = '22023';
      END IF;
    END IF;
    -- Owner can't override an APPROVED row to anything except via admin reject
    IF v_asset.status = 'APPROVED' AND p_status = 'NEEDS_REPLACEMENT' THEN
      RAISE EXCEPTION 'CANNOT_UNAPPROVE_DIRECTLY: contact VAiyu team to mark this as needs replacement'
        USING ERRCODE = '42501';
    END IF;
    UPDATE public.hotel_assets
      SET status = p_status,
          owner_notes = COALESCE(p_owner_notes, owner_notes)
      WHERE id = v_asset.id
      RETURNING * INTO v_asset;
  END IF;

  PERFORM public.vaiyu_log_audit(
    'asset_status_changed_by_owner',
    'hotel_assets',
    v_asset.id,
    p_hotel_id,
    jsonb_build_object(
      'requirement_code', p_requirement_code,
      'previous_status', v_old_status,
      'new_status', p_status
    )
  );

  RETURN jsonb_build_object('ok', true, 'hotel_asset_id', v_asset.id, 'new_status', p_status);
END $$;

-- ─── RPC: upsert_hotel_asset_note (owner notes only) ────────────────────────

CREATE OR REPLACE FUNCTION public.upsert_hotel_asset_note(
  p_hotel_id          uuid,
  p_requirement_code  text,
  p_owner_notes       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_asset public.hotel_assets%ROWTYPE;
BEGIN
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_HOTEL_MEMBER' USING ERRCODE = '42501';
  END IF;

  -- Verify requirement exists
  PERFORM 1 FROM public.asset_requirements WHERE code = p_requirement_code AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNKNOWN_REQUIREMENT' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO v_asset
    FROM public.hotel_assets
    WHERE hotel_id = p_hotel_id AND requirement_code = p_requirement_code;

  IF NOT FOUND THEN
    -- Lazy-create with NEEDS_REPLACEMENT (no files yet, but owner is tracking)
    INSERT INTO public.hotel_assets (hotel_id, requirement_code, status, collected_via, owner_notes)
    VALUES (p_hotel_id, p_requirement_code, 'NEEDS_REPLACEMENT', 'OWNER_UPLOAD', p_owner_notes)
    RETURNING * INTO v_asset;
  ELSE
    UPDATE public.hotel_assets
      SET owner_notes = p_owner_notes
      WHERE id = v_asset.id
      RETURNING * INTO v_asset;
  END IF;

  RETURN jsonb_build_object('ok', true, 'hotel_asset_id', v_asset.id);
END $$;

-- ─── RPC: approve_hotel_asset (admin only) ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.approve_hotel_asset(
  p_hotel_asset_id  uuid,
  p_internal_notes  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_asset       public.hotel_assets%ROWTYPE;
  v_file_cnt    integer;
  v_actor_id    uuid := auth.uid();
  v_actor_name  text;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'PLATFORM_ADMIN_ONLY' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_asset FROM public.hotel_assets WHERE id = p_hotel_asset_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSET_NOT_FOUND' USING ERRCODE = '02000';
  END IF;

  SELECT COUNT(*) INTO v_file_cnt
    FROM public.hotel_asset_files
    WHERE hotel_asset_id = p_hotel_asset_id;
  IF v_file_cnt = 0 THEN
    RAISE EXCEPTION 'NO_FILES_TO_APPROVE' USING ERRCODE = '22023';
  END IF;

  v_actor_name := public._user_display_name(v_actor_id);

  UPDATE public.hotel_assets
    SET status            = 'APPROVED',
        internal_notes    = COALESCE(p_internal_notes, internal_notes),
        rejection_reason  = NULL,
        reviewed_at       = now(),
        review_actor_id   = v_actor_id,
        review_actor_name = v_actor_name
    WHERE id = p_hotel_asset_id
    RETURNING * INTO v_asset;

  PERFORM public.vaiyu_log_audit(
    'asset_approved_by_admin',
    'hotel_assets',
    v_asset.id,
    v_asset.hotel_id,
    jsonb_build_object(
      'requirement_code', v_asset.requirement_code,
      'file_count', v_file_cnt
    )
  );

  RETURN jsonb_build_object('ok', true, 'hotel_asset_id', v_asset.id);
END $$;

-- ─── RPC: reject_hotel_asset (admin only) ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.reject_hotel_asset(
  p_hotel_asset_id  uuid,
  p_reason          text,
  p_internal_notes  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_asset       public.hotel_assets%ROWTYPE;
  v_actor_id    uuid := auth.uid();
  v_actor_name  text;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'PLATFORM_ADMIN_ONLY' USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'REJECTION_REASON_REQUIRED' USING ERRCODE = '23502';
  END IF;

  SELECT * INTO v_asset FROM public.hotel_assets WHERE id = p_hotel_asset_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSET_NOT_FOUND' USING ERRCODE = '02000';
  END IF;

  v_actor_name := public._user_display_name(v_actor_id);

  UPDATE public.hotel_assets
    SET status            = 'REJECTED',
        rejection_reason  = p_reason,
        internal_notes    = COALESCE(p_internal_notes, internal_notes),
        reviewed_at       = now(),
        review_actor_id   = v_actor_id,
        review_actor_name = v_actor_name
    WHERE id = p_hotel_asset_id
    RETURNING * INTO v_asset;

  PERFORM public.vaiyu_log_audit(
    'asset_rejected_by_admin',
    'hotel_assets',
    v_asset.id,
    v_asset.hotel_id,
    jsonb_build_object(
      'requirement_code', v_asset.requirement_code,
      'reason', p_reason
    )
  );

  RETURN jsonb_build_object('ok', true, 'hotel_asset_id', v_asset.id);
END $$;

-- ─── Brand sync: link existing hotels.logo_path + cover_image_path ──────────

CREATE OR REPLACE FUNCTION public.link_hotel_brand_to_asset_requirement(
  p_hotel_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_hotel        public.hotels%ROWTYPE;
  v_linked       integer := 0;
  v_existing_id  uuid;
BEGIN
  SELECT * INTO v_hotel FROM public.hotels WHERE id = p_hotel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HOTEL_NOT_FOUND' USING ERRCODE = '02000';
  END IF;

  -- LOGO → trust_logo_brand_assets
  IF v_hotel.logo_path IS NOT NULL AND length(btrim(v_hotel.logo_path)) > 0 THEN
    SELECT id INTO v_existing_id
      FROM public.hotel_assets
      WHERE hotel_id = p_hotel_id AND requirement_code = 'trust_logo_brand_assets';
    IF NOT FOUND THEN
      INSERT INTO public.hotel_assets (hotel_id, requirement_code, status, collected_via, internal_notes)
      VALUES (p_hotel_id, 'trust_logo_brand_assets', 'COLLECTED', 'AUTO_LINK_BRAND',
              'Auto-linked from hotels.logo_path. Manage via Hotel Settings.');
      v_linked := v_linked + 1;
    END IF;
  END IF;

  -- COVER → trust_cover_image
  IF v_hotel.cover_image_path IS NOT NULL AND length(btrim(v_hotel.cover_image_path)) > 0 THEN
    SELECT id INTO v_existing_id
      FROM public.hotel_assets
      WHERE hotel_id = p_hotel_id AND requirement_code = 'trust_cover_image';
    IF NOT FOUND THEN
      INSERT INTO public.hotel_assets (hotel_id, requirement_code, status, collected_via, internal_notes)
      VALUES (p_hotel_id, 'trust_cover_image', 'COLLECTED', 'AUTO_LINK_BRAND',
              'Auto-linked from hotels.cover_image_path. Manage via Hotel Settings.');
      v_linked := v_linked + 1;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'linked', v_linked);
END $$;

COMMENT ON FUNCTION public.link_hotel_brand_to_asset_requirement IS
  'Idempotent backfill: creates AUTO_LINK_BRAND hotel_assets rows for trust_logo_brand_assets and trust_cover_image when the corresponding hotels.* columns are populated. Called by migration backfill and by the brand-update trigger.';

-- ─── Trigger: keep brand assets in sync as hotels.logo_path changes ─────────

CREATE OR REPLACE FUNCTION public._trg_sync_hotel_brand_to_assets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Only fires when the relevant columns actually change
  IF NEW.logo_path IS DISTINCT FROM OLD.logo_path
     OR NEW.cover_image_path IS DISTINCT FROM OLD.cover_image_path THEN
    PERFORM public.link_hotel_brand_to_asset_requirement(NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_hotel_brand_to_assets ON public.hotels;
CREATE TRIGGER trg_hotel_brand_to_assets
  AFTER UPDATE OF logo_path, cover_image_path ON public.hotels
  FOR EACH ROW
  EXECUTE FUNCTION public._trg_sync_hotel_brand_to_assets();

-- ─── One-shot backfill on migration ─────────────────────────────────────────

DO $$
DECLARE
  v_hotel_id uuid;
BEGIN
  FOR v_hotel_id IN SELECT id FROM public.hotels LOOP
    PERFORM public.link_hotel_brand_to_asset_requirement(v_hotel_id);
  END LOOP;
END $$;

-- ─── Grants ─────────────────────────────────────────────────────────────────

GRANT SELECT ON public.asset_requirements    TO authenticated;
GRANT SELECT ON public.v_hotel_asset_status  TO authenticated;
GRANT SELECT ON public.v_hotel_visible_assets TO authenticated;
GRANT SELECT ON public.hotel_assets          TO authenticated;
GRANT SELECT ON public.hotel_asset_files     TO authenticated;

GRANT EXECUTE ON FUNCTION public.record_hotel_asset_file
  (uuid, text, text, text, text, integer, uuid, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_hotel_asset_file(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_hotel_asset_files(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_hotel_asset_status
  (uuid, text, public.asset_status, text)                                TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_hotel_asset_note(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_hotel_asset(uuid, text)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_hotel_asset(uuid, text, text)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_hotel_brand_to_asset_requirement(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ─── Storage bucket + RLS (placed LAST: requires elevated privileges) ──────
-- ════════════════════════════════════════════════════════════════════════════
--
-- IMPORTANT: storage.objects is owned by supabase_storage_admin in cloud
-- Supabase. Running this section requires postgres / supabase_storage_admin
-- membership. If `supabase migration up` runs as a less-privileged user, this
-- section fails — but by being LAST, the table / view / RPC schema above is
-- fully applied first, leaving a recoverable state.
--
-- Production deploy options (same as quote-pdfs precedent):
--   1. Apply this migration via psql as the postgres user:
--        psql "$SUPABASE_DB_URL" -f 20260528000001_digital_asset_manager.sql
--   2. Or apply only the section below separately, after the main schema:
--        psql "$SUPABASE_DB_URL" -c "<...this block...>"
--   3. Or via the Supabase dashboard SQL editor (runs as superuser).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'hotel-asset-vault', 'hotel-asset-vault', false,
  10 * 1024 * 1024,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'application/pdf'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Asset Vault: members read own"   ON storage.objects;
DROP POLICY IF EXISTS "Asset Vault: members upload own" ON storage.objects;
DROP POLICY IF EXISTS "Asset Vault: members update own" ON storage.objects;
DROP POLICY IF EXISTS "Asset Vault: members delete own" ON storage.objects;

CREATE POLICY "Asset Vault: members read own"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'hotel-asset-vault'
    AND public.vaiyu_is_hotel_member(
      NULLIF(split_part(name, '/', 1), '')::uuid
    )
  );

CREATE POLICY "Asset Vault: members upload own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'hotel-asset-vault'
    AND public.vaiyu_is_hotel_member(
      NULLIF(split_part(name, '/', 1), '')::uuid
    )
  );

CREATE POLICY "Asset Vault: members update own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'hotel-asset-vault'
    AND public.vaiyu_is_hotel_member(
      NULLIF(split_part(name, '/', 1), '')::uuid
    )
  );

CREATE POLICY "Asset Vault: members delete own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'hotel-asset-vault'
    AND public.vaiyu_is_hotel_member(
      NULLIF(split_part(name, '/', 1), '')::uuid
    )
  );
