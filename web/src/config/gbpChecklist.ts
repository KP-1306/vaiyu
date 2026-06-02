// web/src/config/gbpChecklist.ts
//
// Google Business Checklist v0 — TS config + catalog mirror.
//
// Toggle: flip GOOGLE_BUSINESS_CHECKLIST_V0_ENABLED = false to hide the
// expanded checklist UI (reverts the Visibility workspace to the prior
// 6-item GMB panel).
//
// This is an INTERNAL self-audit workbook. It does NOT:
//   • Connect to any Google API
//   • Scrape any Google Business page
//   • Predict ranking or visibility
//   • Use any AI
//
// SQL is authoritative (see _gbp_catalog() in 20260602000001 migration).
// vitest parity test in gbpChecklist.test.ts asserts SQL ↔ TS key-set match
// on (item_key, category, kind, linked_visibility_signal_key, display_order).

import type {
  GBPCatalogItem,
  GBPCategory,
  GBPFixModule,
} from '../types/gbpChecklist';

export const GOOGLE_BUSINESS_CHECKLIST_V0_ENABLED = true;

// ── Disclaimers (verbatim per PO spec) ──────────────────────────────────────

export const GBP_DISCLAIMER_EN =
  'VAiyu Google Business Checklist is an internal readiness tool. It does not guarantee Google ranking, bookings, revenue, occupancy, or verification approval.';

export const GBP_DISCLAIMER_HI =
  'Yeh tool sirf readiness dikhata hai. Google ranking ya booking ki koi guarantee nahi hai.';

// ── Category labels ────────────────────────────────────────────────────────

export const GBP_CATEGORY_LABEL: Record<GBPCategory, string> = {
  BUSINESS_PROFILE:        'Business profile',
  LOCATION_ACCURACY:       'Location accuracy',
  CONTACT_READINESS:       'Contact readiness',
  CONTENT_READINESS:       'Content readiness',
  TRUST_SIGNALS:           'Trust signals',
  EXPERIENCE_READINESS:    'Experience readiness',
  VERIFICATION_READINESS:  'Verification readiness',
};

export const GBP_CATEGORY_LABEL_HI: Record<GBPCategory, string> = {
  BUSINESS_PROFILE:        'Business profile',
  LOCATION_ACCURACY:       'Location ki accuracy',
  CONTACT_READINESS:       'Contact ke liye taiyari',
  CONTENT_READINESS:       'Content ke liye taiyari',
  TRUST_SIGNALS:           'Trust signals',
  EXPERIENCE_READINESS:    'Experience readiness',
  VERIFICATION_READINESS:  'Verification ke liye taiyari',
};

export const GBP_CATEGORY_ORDER: GBPCategory[] = [
  'BUSINESS_PROFILE',
  'LOCATION_ACCURACY',
  'CONTACT_READINESS',
  'CONTENT_READINESS',
  'TRUST_SIGNALS',
  'EXPERIENCE_READINESS',
  'VERIFICATION_READINESS',
];

// ── Readiness threshold ────────────────────────────────────────────────────
// Matches SQL: meets_ready_threshold = satisfied_count >= ceil(total_count × 0.70)
// This drives the gbp_checklist_ready Visibility Score signal.
export const GBP_READY_THRESHOLD_PCT = 70;

// ── Fix-action route resolution ────────────────────────────────────────────

export function gbpFixActionRoute(hotelSlug: string, fixModule: GBPFixModule): string {
  switch (fixModule) {
    case 'DAM':                return `/owner/${hotelSlug}/assets`;
    case 'PACKAGE_BUILDER':    return `/owner/${hotelSlug}/packages`;
    case 'SEO_PLANNER':        return `/owner/${hotelSlug}/seo-planner`;
    case 'SEASONAL_CALENDAR':  return `/owner/${hotelSlug}/seasonal`;
    case 'VISIBILITY':         return `/owner/${hotelSlug}/visibility`;
    case 'SETTINGS':           return `/owner/${hotelSlug}/settings`;
    default:                   return `/owner/${hotelSlug}/settings`;
  }
}

export const GBP_FIX_MODULE_LABEL: Record<GBPFixModule, string> = {
  DAM:               'Asset Manager',
  PACKAGE_BUILDER:   'Package Builder',
  SEO_PLANNER:       'SEO Planner',
  SEASONAL_CALENDAR: 'Seasonal Calendar',
  VISIBILITY:        'Visibility Score',
  SETTINGS:          'Property settings',
};

// ── Catalog (30 items, MUST mirror SQL `_gbp_catalog()`) ───────────────────

export const GBP_CATALOG: GBPCatalogItem[] = [
  // ─── BUSINESS_PROFILE ────────────────────────────────────────────────────
  {
    itemKey: 'profile_claimed', category: 'BUSINESS_PROFILE',
    kind: 'LINKED_VISIBILITY', linkedVisibilitySignalKey: 'gmb_claimed', displayOrder: 10,
    fixModule: 'SETTINGS',
    labelEn: 'Google Business Profile claimed',
    labelHi: 'Google Business Profile claim ho chuki hai',
    descEn: 'Your property is claimed on Google Business Profile.',
    descHi: 'Aapki property Google Business Profile par claim ho chuki hai.',
  },
  {
    itemKey: 'profile_verified', category: 'BUSINESS_PROFILE',
    kind: 'LINKED_VISIBILITY', linkedVisibilitySignalKey: 'gmb_verified', displayOrder: 11,
    fixModule: 'SETTINGS',
    labelEn: 'Profile verified (postcard/phone/video)',
    labelHi: 'Profile verified hai (postcard/phone/video)',
    descEn: 'Google has verified your property and the verification badge is active.',
    descHi: 'Google ne aapki property verify ki hai aur verification badge active hai.',
  },
  {
    itemKey: 'primary_category_set', category: 'BUSINESS_PROFILE',
    kind: 'LINKED_VISIBILITY', linkedVisibilitySignalKey: 'gmb_category_set', displayOrder: 12,
    fixModule: 'SETTINGS',
    labelEn: 'Primary category correctly selected',
    labelHi: 'Primary category sahi se chuni gayi hai',
    descEn: 'The primary GMB category accurately reflects your property type (Hotel/Resort/Homestay).',
    descHi: 'Primary GMB category aapki property type ko sahi dikhati hai (Hotel/Resort/Homestay).',
  },
  {
    itemKey: 'secondary_categories_set', category: 'BUSINESS_PROFILE',
    kind: 'SELF_ATTESTED', linkedVisibilitySignalKey: null, displayOrder: 13,
    fixModule: 'SETTINGS',
    labelEn: 'Secondary categories configured (where relevant)',
    labelHi: 'Secondary categories configure hain (jahan zaroori hai)',
    descEn: 'Add secondary categories like Restaurant, Spa, Wedding Venue where applicable. Improves discoverability.',
    descHi: 'Restaurant, Spa, Wedding Venue jaisi secondary categories jodiye jahan applicable hain.',
  },

  // ─── LOCATION_ACCURACY ──────────────────────────────────────────────────
  {
    itemKey: 'address_complete', category: 'LOCATION_ACCURACY',
    kind: 'LINKED_VISIBILITY', linkedVisibilitySignalKey: 'address_complete', displayOrder: 20,
    fixModule: 'SETTINGS',
    labelEn: 'Full address present (address, city, state, country, postal code)',
    labelHi: 'Pura address bhara hai (address, city, state, country, postal code)',
    descEn: 'All address fields are populated in property settings.',
    descHi: 'Sab address fields property settings mein bhare hue hain.',
  },
  {
    itemKey: 'address_matches_business', category: 'LOCATION_ACCURACY',
    kind: 'SELF_ATTESTED', linkedVisibilitySignalKey: null, displayOrder: 21,
    fixModule: 'SETTINGS',
    labelEn: 'Address on GBP matches the actual business address',
    labelHi: 'GBP par address actual business address se match karta hai',
    descEn: 'Address shown on GBP exactly matches your invoices and signboard. Mismatched address triggers verification rejection.',
    descHi: 'GBP par address invoice aur signboard se match karna chahiye. Mismatch verification reject kar sakta hai.',
  },
  {
    itemKey: 'map_pin_accurate', category: 'LOCATION_ACCURACY',
    kind: 'LINKED_VISIBILITY', linkedVisibilitySignalKey: 'map_pin_set', displayOrder: 22,
    fixModule: 'SETTINGS',
    labelEn: 'Map pin set to accurate latitude/longitude',
    labelHi: 'Map pin sahi latitude/longitude par set hai',
    descEn: 'Lat/long are populated and pin lands at the correct entrance, not a generic area.',
    descHi: 'Lat/long sahi entry point par set hain, generic area par nahi.',
  },
  {
    itemKey: 'service_area_accurate', category: 'LOCATION_ACCURACY',
    kind: 'SELF_ATTESTED', linkedVisibilitySignalKey: null, displayOrder: 23,
    fixModule: 'SETTINGS',
    labelEn: 'Service area set correctly (only if applicable)',
    labelHi: 'Service area sahi set hai (sirf agar applicable hai)',
    descEn: 'For hotels that pick up/drop guests, set the service-area zone. Skip if not relevant.',
    descHi: 'Agar guests ko pick-up/drop dete ho to service-area zone set karo. Warna skip.',
  },

  // ─── CONTACT_READINESS ──────────────────────────────────────────────────
  {
    itemKey: 'phone_present', category: 'CONTACT_READINESS',
    kind: 'LINKED_VISIBILITY', linkedVisibilitySignalKey: 'phone_present', displayOrder: 30,
    fixModule: 'SETTINGS',
    labelEn: 'Phone number on file',
    labelHi: 'Phone number bhara hua hai',
    descEn: 'A direct contact phone is present in property settings.',
    descHi: 'Property settings mein direct contact phone hai.',
  },
  {
    itemKey: 'whatsapp_visible_on_gbp', category: 'CONTACT_READINESS',
    kind: 'SELF_ATTESTED', linkedVisibilitySignalKey: null, displayOrder: 31,
    fixModule: 'SETTINGS',
    labelEn: 'WhatsApp number visible on Google Business Profile',
    labelHi: 'WhatsApp number Google Business Profile par visible hai',
    descEn: 'Add your WhatsApp number to GBP so guests can message directly from search results.',
    descHi: 'WhatsApp number GBP par dikhao taaki guest search se seedha message kar sakein.',
  },
  {
    itemKey: 'website_visible_on_gbp', category: 'CONTACT_READINESS',
    kind: 'SELF_ATTESTED', linkedVisibilitySignalKey: null, displayOrder: 32,
    fixModule: 'SETTINGS',
    labelEn: 'Website link visible on Google Business Profile',
    labelHi: 'Website link Google Business Profile par visible hai',
    descEn: 'Your direct booking website / microsite link is on GBP — captures direct enquiries.',
    descHi: 'Direct booking website ya microsite ka link GBP par hai — direct enquiries laata hai.',
  },
  {
    itemKey: 'enquiry_page_visible_on_gbp', category: 'CONTACT_READINESS',
    kind: 'SELF_ATTESTED', linkedVisibilitySignalKey: null, displayOrder: 33,
    fixModule: 'SETTINGS',
    labelEn: 'Direct enquiry page accessible from GBP',
    labelHi: 'Direct enquiry page GBP se accessible hai',
    descEn: 'Either a "Send message" CTA on GBP or a website page that captures enquiries — at least one direct path.',
    descHi: '"Send message" CTA ya website enquiry form — kam-se-kam ek direct path hona chahiye.',
  },

  // ─── CONTENT_READINESS ──────────────────────────────────────────────────
  {
    itemKey: 'description_present', category: 'CONTENT_READINESS',
    kind: 'AUTO_DERIVED', linkedVisibilitySignalKey: null, displayOrder: 40,
    fixModule: 'SETTINGS',
    labelEn: 'Business description present (≥30 chars in property settings)',
    labelHi: 'Business description bhari hai (property settings mein ≥30 chars)',
    descEn: 'A non-trivial description is set in your property profile. Auto-derived from settings.',
    descHi: 'Property profile mein description bhara hua hai (auto-detect).',
  },
  {
    itemKey: 'exterior_photos_on_gbp', category: 'CONTENT_READINESS',
    kind: 'SELF_ATTESTED', linkedVisibilitySignalKey: null, displayOrder: 41,
    fixModule: 'DAM',
    labelEn: 'Exterior photos uploaded to GBP (≥3)',
    labelHi: 'Exterior photos GBP par upload kiye hain (≥3)',
    descEn: 'Front, sides, and entrance photos uploaded to Google Business. Daylight, no compression artefacts.',
    descHi: 'Front, side, entrance ke photos GBP par upload kiye hain. Din ki roshni, saaf.',
  },
  {
    itemKey: 'room_photos_on_gbp', category: 'CONTENT_READINESS',
    kind: 'SELF_ATTESTED', linkedVisibilitySignalKey: null, displayOrder: 42,
    fixModule: 'DAM',
    labelEn: 'Room photos uploaded to GBP (≥2 per room type)',
    labelHi: 'Room photos GBP par hain (har room type ke ≥2)',
    descEn: 'Bed view + window angle minimum per room type. Property made up before shoot.',
    descHi: 'Bed + window angle har room type ka. Photo lene se pehle room set karo.',
  },
  {
    itemKey: 'bathroom_photos_on_gbp', category: 'CONTENT_READINESS',
    kind: 'SELF_ATTESTED', linkedVisibilitySignalKey: null, displayOrder: 43,
    fixModule: 'DAM',
    labelEn: 'Bathroom photos uploaded to GBP',
    labelHi: 'Bathroom photos GBP par upload hain',
    descEn: 'Clean, well-lit bathroom shots. Guests check cleanliness here.',
    descHi: 'Saaf, accha lit bathroom photo. Guest yahan cleanliness check karte hain.',
  },
  {
    itemKey: 'dining_photos_on_gbp', category: 'CONTENT_READINESS',
    kind: 'SELF_ATTESTED', linkedVisibilitySignalKey: null, displayOrder: 44,
    fixModule: 'DAM',
    labelEn: 'Dining/restaurant photos on GBP (if you serve food)',
    labelHi: 'Dining ya restaurant photos GBP par hain (agar khana milta hai)',
    descEn: 'Restaurant interior, dining setting, signature dishes. Skip if no F&B.',
    descHi: 'Restaurant interior, dining setting, signature dish. Agar F&B nahi to skip.',
  },
  {
    itemKey: 'common_area_photos_on_gbp', category: 'CONTENT_READINESS',
    kind: 'SELF_ATTESTED', linkedVisibilitySignalKey: null, displayOrder: 45,
    fixModule: 'DAM',
    labelEn: 'Common area photos on GBP (lobby/reception/garden)',
    labelHi: 'Common area photos GBP par hain (lobby/reception/garden)',
    descEn: 'Public space shots convey property character. One well-framed shot per area is enough.',
    descHi: 'Common areas se property ka character pata chalta hai. Ek accha framed shot per area kaafi hai.',
  },

  // ─── TRUST_SIGNALS ──────────────────────────────────────────────────────
  {
    itemKey: 'review_link_available', category: 'TRUST_SIGNALS',
    kind: 'LINKED_VISIBILITY', linkedVisibilitySignalKey: 'review_link_set', displayOrder: 50,
    fixModule: 'SETTINGS',
    labelEn: 'Google review link configured',
    labelHi: 'Google review link configure hai',
    descEn: 'Your direct review link is on file so guests can review easily.',
    descHi: 'Direct review link configure hai taaki guest aasani se review de sakein.',
  },
  {
    itemKey: 'review_process_defined', category: 'TRUST_SIGNALS',
    kind: 'SELF_ATTESTED', linkedVisibilitySignalKey: null, displayOrder: 51,
    fixModule: 'SETTINGS',
    labelEn: 'Documented process to ask guests for reviews',
    labelHi: 'Guests se review maangne ka documented process hai',
    descEn: 'Check-out script, follow-up template, or QR card with review link — at least one consistent path.',
    descHi: 'Check-out script, follow-up template, ya QR card — koi ek consistent path.',
  },
  {
    itemKey: 'review_response_discipline', category: 'TRUST_SIGNALS',
    kind: 'LINKED_VISIBILITY', linkedVisibilitySignalKey: 'off_platform_response', displayOrder: 52,
    fixModule: 'VISIBILITY',
    labelEn: 'Responding to recent reviews (Google + others)',
    labelHi: 'Recent reviews ka jawab de rahe ho (Google aur baaki)',
    descEn: 'Active responses to Google, Booking, and MMT reviews — within 48 hours typically.',
    descHi: 'Google, Booking, MMT reviews ka jawab dete ho — usually 48 ghante mein.',
  },
  {
    itemKey: 'policies_visible_on_gbp', category: 'TRUST_SIGNALS',
    kind: 'SELF_ATTESTED', linkedVisibilitySignalKey: null, displayOrder: 53,
    fixModule: 'SETTINGS',
    labelEn: 'Policies visible on GBP (cancellation, check-in/out, child/pet)',
    labelHi: 'Policies GBP par dikh rahi hain (cancellation, check-in/out, child/pet)',
    descEn: 'Add policy details to GBP description or attributes. Reduces post-booking disputes.',
    descHi: 'Policies GBP description ya attributes mein add karo. Booking ke baad disputes kam honge.',
  },
  {
    itemKey: 'amenities_visible_on_gbp', category: 'TRUST_SIGNALS',
    kind: 'AUTO_DERIVED', linkedVisibilitySignalKey: null, displayOrder: 54,
    fixModule: 'SETTINGS',
    labelEn: 'Amenities listed (≥3 in property settings)',
    labelHi: 'Amenities listed hain (property settings mein ≥3)',
    descEn: 'Auto-derived from amenities array in property settings.',
    descHi: 'Property settings ke amenities se auto-detect hota hai.',
  },

  // ─── EXPERIENCE_READINESS ───────────────────────────────────────────────
  {
    itemKey: 'packages_available', category: 'EXPERIENCE_READINESS',
    kind: 'LINKED_VISIBILITY', linkedVisibilitySignalKey: 'package_live', displayOrder: 60,
    fixModule: 'PACKAGE_BUILDER',
    labelEn: 'At least one experience package live',
    labelHi: 'Ek experience package live hai',
    descEn: 'Published package gives guests a concrete reason to book direct (vs OTA).',
    descHi: 'Published package se guest direct book karne ka reason milta hai.',
  },
  {
    itemKey: 'local_attractions_listed', category: 'EXPERIENCE_READINESS',
    kind: 'SELF_ATTESTED', linkedVisibilitySignalKey: null, displayOrder: 61,
    fixModule: 'SEO_PLANNER',
    labelEn: 'Local attractions listed (in GBP posts or website)',
    labelHi: 'Local attractions listed hain (GBP posts ya website par)',
    descEn: 'List nearby places guests typically visit. Helps capture intent searches.',
    descHi: 'Paas ki famous jagahein list karo. Intent search capture karne mein madad karta hai.',
  },
  {
    itemKey: 'seasonal_experiences_documented', category: 'EXPERIENCE_READINESS',
    kind: 'SELF_ATTESTED', linkedVisibilitySignalKey: null, displayOrder: 62,
    fixModule: 'SEASONAL_CALENDAR',
    labelEn: 'Seasonal experiences documented',
    labelHi: 'Seasonal experiences document kiye hain',
    descEn: 'Winter trekking, monsoon viewpoints, festival packages — documented in Seasonal Calendar.',
    descHi: 'Winter trek, monsoon view, festival package — Seasonal Calendar mein document karo.',
  },

  // ─── VERIFICATION_READINESS ─────────────────────────────────────────────
  {
    itemKey: 'signboard_photo_ready', category: 'VERIFICATION_READINESS',
    kind: 'SELF_ATTESTED', linkedVisibilitySignalKey: null, displayOrder: 70,
    fixModule: 'DAM',
    labelEn: 'Signboard photo available for verification',
    labelHi: 'Signboard photo verification ke liye ready hai',
    descEn: 'Clear photo of property signboard with the property name. Required for GBP verification.',
    descHi: 'Property naam ke saath signboard ka clear photo. GBP verification ke liye required.',
  },
  {
    itemKey: 'business_proof_ready', category: 'VERIFICATION_READINESS',
    kind: 'SELF_ATTESTED', linkedVisibilitySignalKey: null, displayOrder: 71,
    fixModule: 'DAM',
    labelEn: 'Business proof document ready (GST / Shop Act / etc.)',
    labelHi: 'Business proof document ready hai (GST / Shop Act / etc.)',
    descEn: 'A government-issued business proof — GST certificate, Shop Act licence, or similar.',
    descHi: 'Government issued business proof — GST certificate, Shop Act licence, ya similar.',
  },
  {
    itemKey: 'invoice_template_ready', category: 'VERIFICATION_READINESS',
    kind: 'SELF_ATTESTED', linkedVisibilitySignalKey: null, displayOrder: 72,
    fixModule: 'DAM',
    labelEn: 'Branded invoice template ready',
    labelHi: 'Branded invoice template ready hai',
    descEn: 'A printable invoice template with property name + address + GST.',
    descHi: 'Property name + address + GST wala printable invoice template.',
  },
  {
    itemKey: 'letterhead_ready', category: 'VERIFICATION_READINESS',
    kind: 'SELF_ATTESTED', linkedVisibilitySignalKey: null, displayOrder: 73,
    fixModule: 'DAM',
    labelEn: 'Property letterhead ready',
    labelHi: 'Property letterhead ready hai',
    descEn: 'Branded letterhead for correspondence. Required for certain verification flows.',
    descHi: 'Property branding wala letterhead. Verification ke kuch flows mein required.',
  },
];

// ── Catalog lookup helpers ─────────────────────────────────────────────────

export function findGBPCatalogItem(itemKey: string): GBPCatalogItem | null {
  return GBP_CATALOG.find((c) => c.itemKey === itemKey) ?? null;
}

export function gbpCatalogForCategory(category: GBPCategory): GBPCatalogItem[] {
  return GBP_CATALOG
    .filter((c) => c.category === category)
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

/** True iff at least 70% (CEIL) of items are satisfied. Mirrors SQL threshold. */
export function meetsGBPReadyThreshold(satisfiedCount: number, totalCount: number): boolean {
  if (totalCount === 0) return false;
  return satisfiedCount >= Math.ceil(totalCount * (GBP_READY_THRESHOLD_PCT / 100));
}

// Sanity: catalog must have exactly 30 items (load-time guard).
if (GBP_CATALOG.length !== 30) {
  // eslint-disable-next-line no-console
  console.error('[gbpChecklist] catalog has', GBP_CATALOG.length, 'items — expected 30');
}
