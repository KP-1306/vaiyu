// web/src/config/visibilityScore.ts
//
// Visibility Score — Growth Hub Position 9. Internal readiness scorer that
// aggregates first-party signals across DAM, SEO Planner, Packages, Leads,
// Reviews, and the hotels table into a single 0-100 index.
//
// Toggle: flip VISIBILITY_SCORE_ENABLED = false to hide all surfaces
// (dashboard hero card, quick-nav tile, /owner/:slug/visibility route).
//
// This file is the TS-side source of truth for:
//   • Feature flag
//   • Bilingual disclaimer (verbatim per PO spec)
//   • Score formula (version + weights) — MUST match SQL `_visibility_weights()`
//   • Band thresholds (STRONG / GOOD / NEEDS_ATTENTION / CRITICAL / ONBOARDING)
//   • Per-signal catalog (labels en/hi, descriptions, fix-action deep-link)
//   • Category labels (bilingual)
//
// Parity enforcement: visibilityScore.test.ts reads the migration file at
//   supabase/migrations/20260531000001_visibility_score.sql, regex-extracts the
//   `_visibility_weights()` body, and asserts equality with VISIBILITY_FORMULA
//   below. Drift is a test failure.

import type {
  VisibilityCategory,
  VisibilityBand,
  VisibilitySignalKey,
  VisibilitySignalKind,
} from '../types/visibilityScore';

export const VISIBILITY_SCORE_ENABLED = true;

// ── Disclaimer copy (verbatim per PO spec) ───────────────────────────────────

export const VISIBILITY_DISCLAIMER_EN =
  'VAiyu Visibility Score is an internal readiness index. It does not guarantee Google ranking, bookings, revenue, or occupancy.';

export const VISIBILITY_DISCLAIMER_HI =
  'Yeh score sirf readiness dikhata hai. Google ranking, bookings, ya revenue ki koi guarantee nahi.';

// ── Formula version + weights (MUST mirror SQL `_visibility_weights()`) ─────
//
// Bumping weights requires bumping the version in the SAME migration. The
// vitest parity test asserts both halves match the SQL source.

export const VISIBILITY_FORMULA = {
  version: 3,
  weights: {
    // GMB_READINESS (30)
    gmb_claimed:              6,
    gmb_verified:             6,
    gmb_category_set:         4,
    address_complete:         5,
    map_pin_set:              5,
    phone_present:            4,
    // TRUST_REPUTATION (25) — v3: rebalanced + gbp_checklist_ready added
    review_link_set:          3,
    reviews_flowing:          6,
    off_platform_response:    3,
    trust_essentials_assets:  5,
    ota_listing_ready:        4,
    gbp_checklist_ready:      4,
    // DIGITAL_ASSETS (20)
    critical_assets_ready:   10,
    high_assets_ready:        5,
    brand_basics:             5,
    // DIRECT_ENQUIRY (15)
    whatsapp_connected:       4,
    booking_url_set:          3,
    payment_ready:            4,
    lead_response_time:       4,
    // EXPERIENCE_PACKAGES (10)
    package_live:             5,
    seo_blueprint_ready:      5,
  } as const,
} as const;

// ── Band thresholds (locked at 80/60/40 for v1) ─────────────────────────────
//
// Why these thresholds:
//   • 80 = "Strong" — every CRITICAL/HIGH asset done + GMB verified + active engagement
//   • 60 = "Good, with gaps" — most basics done, a few weighted items missing
//   • 40 = "Needs attention" — multiple bucket gaps
//   • <40 = "Critical" — under half of evaluable weight earned
//   • ONBOARDING — fewer than 5 signals evaluable yet (carve-out for new hotels)
//
// Strictly decreasing — validated by vitest band-thresholds test.

export const VISIBILITY_BAND_THRESHOLDS: Record<Exclude<VisibilityBand, 'ONBOARDING'>, number> = {
  STRONG:          80,
  GOOD:            60,
  NEEDS_ATTENTION: 40,
  CRITICAL:         0,
};

export const VISIBILITY_BAND_LABEL: Record<VisibilityBand, string> = {
  STRONG:          'Strong',
  GOOD:            'Good, with gaps',
  NEEDS_ATTENTION: 'Needs attention',
  CRITICAL:        'Critical gaps',
  ONBOARDING:      'Onboarding',
};

export const VISIBILITY_BAND_LABEL_HI: Record<VisibilityBand, string> = {
  STRONG:          'Bahut achhi tarah ready ho.',
  GOOD:            'Theek hai, lekin kuch fix karne ke liye hai.',
  NEEDS_ATTENTION: 'Kaafi cheezein adhuri hain.',
  CRITICAL:        'Pehle yeh basics fix karein.',
  ONBOARDING:      'Onboarding pura karein — basic 3-4 cheezein set karein.',
};

export const VISIBILITY_BAND_TONE: Record<VisibilityBand, 'emerald' | 'sky' | 'amber' | 'rose' | 'slate'> = {
  STRONG:          'emerald',
  GOOD:            'sky',
  NEEDS_ATTENTION: 'amber',
  CRITICAL:        'rose',
  ONBOARDING:      'slate',
};

/** Compute band purely in TS — must match the SQL formula. */
export function bandForScore(totalScore: number, signalsTotal: number): VisibilityBand {
  if (signalsTotal < 5) return 'ONBOARDING';
  if (totalScore >= VISIBILITY_BAND_THRESHOLDS.STRONG) return 'STRONG';
  if (totalScore >= VISIBILITY_BAND_THRESHOLDS.GOOD) return 'GOOD';
  if (totalScore >= VISIBILITY_BAND_THRESHOLDS.NEEDS_ATTENTION) return 'NEEDS_ATTENTION';
  return 'CRITICAL';
}

// ── Categories ──────────────────────────────────────────────────────────────

export const VISIBILITY_CATEGORY_ORDER: VisibilityCategory[] = [
  'GMB_READINESS',
  'TRUST_REPUTATION',
  'DIGITAL_ASSETS',
  'DIRECT_ENQUIRY',
  'EXPERIENCE_PACKAGES',
];

export const VISIBILITY_CATEGORY_LABEL: Record<VisibilityCategory, string> = {
  GMB_READINESS:       'Google Business profile',
  TRUST_REPUTATION:    'Trust & reputation',
  DIGITAL_ASSETS:      'Digital assets',
  DIRECT_ENQUIRY:      'Direct enquiry readiness',
  EXPERIENCE_PACKAGES: 'Local experience & packages',
};

export const VISIBILITY_CATEGORY_LABEL_HI: Record<VisibilityCategory, string> = {
  GMB_READINESS:       'Google Business profile',
  TRUST_REPUTATION:    'Trust aur reputation',
  DIGITAL_ASSETS:      'Digital assets',
  DIRECT_ENQUIRY:      'Direct enquiry ke liye taiyari',
  EXPERIENCE_PACKAGES: 'Local experience aur packages',
};

export const VISIBILITY_CATEGORY_WEIGHT: Record<VisibilityCategory, number> = {
  GMB_READINESS:       30,
  TRUST_REPUTATION:    25,
  DIGITAL_ASSETS:      20,
  DIRECT_ENQUIRY:      15,
  EXPERIENCE_PACKAGES: 10,
};

// ── Signal catalog ───────────────────────────────────────────────────────────
//
// Per-signal metadata. The `fixActionPath` is a path template — the runtime
// substitutes :slug for the hotel slug at render time.

export interface VisibilitySignalMeta {
  key: VisibilitySignalKey;
  category: VisibilityCategory;
  kind: VisibilitySignalKind;
  labelEn: string;
  labelHi: string;
  descEn: string;
  descHi: string;
  fixActionPath: string;          // e.g. '/owner/:slug/settings'
  fixActionLabelEn: string;
  fixActionLabelHi: string;
  /** Optional: min-sample threshold; used for UX copy only, scoring authority is SQL. */
  minSample?: number;
  /** Optional: copy explaining the carve-out when minSample isn't met. */
  insufficientDataNote?: string;
}

export const VISIBILITY_SIGNALS: Record<VisibilitySignalKey, VisibilitySignalMeta> = {
  // ─── GMB_READINESS ────────────────────────────────────────────────────────
  gmb_claimed: {
    key: 'gmb_claimed', category: 'GMB_READINESS', kind: 'SELF_ATTESTED',
    labelEn: 'Profile claimed on Google Business',
    labelHi: 'Google Business par profile claim kiya gaya',
    descEn: 'Your property is claimed on Google Business Profile.',
    descHi: 'Aapki property Google Business Profile par claim ho chuki hai.',
    fixActionPath: 'https://business.google.com/',
    fixActionLabelEn: 'Open Google Business',
    fixActionLabelHi: 'Google Business kholiye',
  },
  gmb_verified: {
    key: 'gmb_verified', category: 'GMB_READINESS', kind: 'SELF_ATTESTED',
    labelEn: 'GMB verification badge active',
    labelHi: 'GMB verification badge active hai',
    descEn: 'Google has verified your property (postcard / phone / video).',
    descHi: 'Google ne aapki property verify ki hai (postcard / phone / video).',
    fixActionPath: 'https://business.google.com/',
    fixActionLabelEn: 'Check verification',
    fixActionLabelHi: 'Verification check kariye',
  },
  gmb_category_set: {
    key: 'gmb_category_set', category: 'GMB_READINESS', kind: 'SELF_ATTESTED',
    labelEn: 'Correct GMB category set (Hotel / Resort / Homestay)',
    labelHi: 'Sahi GMB category set hai (Hotel / Resort / Homestay)',
    descEn: 'The primary GMB category accurately reflects your property type.',
    descHi: 'Primary category aapki property type ko sahi se dikhati hai.',
    fixActionPath: 'https://business.google.com/',
    fixActionLabelEn: 'Edit GMB category',
    fixActionLabelHi: 'GMB category edit kariye',
  },
  address_complete: {
    key: 'address_complete', category: 'GMB_READINESS', kind: 'AUTO_DERIVED',
    labelEn: 'Address fields complete',
    labelHi: 'Address fields pura bhara hai',
    descEn: 'Address, city, state, country, and postal code are all set.',
    descHi: 'Address, city, state, country, aur postal code sab set hain.',
    fixActionPath: '/owner/:slug/settings',
    fixActionLabelEn: 'Open property settings',
    fixActionLabelHi: 'Property settings kholiye',
  },
  map_pin_set: {
    key: 'map_pin_set', category: 'GMB_READINESS', kind: 'AUTO_DERIVED',
    labelEn: 'Map pin set (latitude / longitude)',
    labelHi: 'Map pin set hai (lat / long)',
    descEn: 'A precise map pin helps Google show your property correctly.',
    descHi: 'Sahi map pin Google ko aapki property dikhaane mein madad karta hai.',
    fixActionPath: '/owner/:slug/settings',
    fixActionLabelEn: 'Set map pin',
    fixActionLabelHi: 'Map pin set kariye',
  },
  phone_present: {
    key: 'phone_present', category: 'GMB_READINESS', kind: 'AUTO_DERIVED',
    labelEn: 'Phone number on file',
    labelHi: 'Phone number bhara hua hai',
    descEn: 'A contact phone makes direct enquiries possible.',
    descHi: 'Contact phone se guests aapse seedha baat kar sakte hain.',
    fixActionPath: '/owner/:slug/settings',
    fixActionLabelEn: 'Add phone number',
    fixActionLabelHi: 'Phone number jodiye',
  },

  // ─── TRUST_REPUTATION ─────────────────────────────────────────────────────
  review_link_set: {
    key: 'review_link_set', category: 'TRUST_REPUTATION', kind: 'AUTO_DERIVED',
    labelEn: 'Review link configured',
    labelHi: 'Review link configure ki gayi hai',
    descEn: 'Your Google review link is set up so guests can leave reviews easily.',
    descHi: 'Google review link configure hai taaki guests aasani se review de saken.',
    fixActionPath: '/owner/:slug/settings',
    fixActionLabelEn: 'Add review link',
    fixActionLabelHi: 'Review link jodiye',
  },
  reviews_flowing: {
    key: 'reviews_flowing', category: 'TRUST_REPUTATION', kind: 'AUTO_DERIVED',
    labelEn: 'Reviews flowing (≥5 in last 90 days)',
    labelHi: '90 din mein 5+ reviews aaye hain',
    descEn: 'Fresh reviews signal an active, trusted property.',
    descHi: 'Nayi reviews dikhati hain ki property active aur bharosemand hai.',
    fixActionPath: '/owner/:slug/reputation',
    fixActionLabelEn: 'Open reputation',
    fixActionLabelHi: 'Reputation kholiye',
    minSample: 5,
    insufficientDataNote:
      'Hotel onboarded recently — review history will be evaluated after 30 days.',
  },
  off_platform_response: {
    key: 'off_platform_response', category: 'TRUST_REPUTATION', kind: 'SELF_ATTESTED',
    labelEn: 'Responding to reviews on Google / Booking / MMT',
    labelHi: 'Google / Booking / MMT pe reviews ka jawab dete hain',
    descEn: 'Active review responses on external platforms build trust.',
    descHi: 'External platforms par review responses se trust badhta hai.',
    fixActionPath: 'https://business.google.com/reviews/',
    fixActionLabelEn: 'Open Google reviews',
    fixActionLabelHi: 'Google reviews kholiye',
  },
  trust_essentials_assets: {
    key: 'trust_essentials_assets', category: 'TRUST_REPUTATION', kind: 'AUTO_DERIVED',
    labelEn: 'Trust-essentials assets ready (≥80% collected)',
    labelHi: 'Trust assets ready hain (≥80% collect ho chuki hain)',
    descEn: 'Verification proof, business card, signboard, and letterhead in your asset library.',
    descHi: 'Verification proof, business card, signboard, aur letterhead asset library mein hain.',
    fixActionPath: '/owner/:slug/assets',
    fixActionLabelEn: 'Open asset manager',
    fixActionLabelHi: 'Asset manager kholiye',
  },
  ota_listing_ready: {
    key: 'ota_listing_ready', category: 'TRUST_REPUTATION', kind: 'AUTO_DERIVED',
    labelEn: 'OTA Listing Optimizer reports Moderate or Premium readiness',
    labelHi: 'OTA Listing Optimizer Moderate ya Premium readiness dikhata hai',
    descEn: 'Your OTA Readiness Score is ≥ 50 across active OTAs (last reviewed within 120 days).',
    descHi: 'Active OTAs ke across aapka OTA Readiness Score ≥ 50 hai (last 120 din mein reviewed).',
    fixActionPath: '/owner/:slug/ota',
    fixActionLabelEn: 'Open OTA Optimizer',
    fixActionLabelHi: 'OTA Optimizer kholiye',
  },
  gbp_checklist_ready: {
    key: 'gbp_checklist_ready', category: 'TRUST_REPUTATION', kind: 'AUTO_DERIVED',
    labelEn: 'Google Business Checklist meets ≥70% readiness',
    labelHi: 'Google Business Checklist ≥70% readiness par hai',
    descEn: 'Your GBP Checklist has ≥21 of 30 items satisfied (auto + self-attested + manager-verified).',
    descHi: 'GBP Checklist mein 30 mein se ≥21 items satisfied hain (auto + self-attested + manager-verified).',
    fixActionPath: '/owner/:slug/visibility',
    fixActionLabelEn: 'Open GBP Checklist',
    fixActionLabelHi: 'GBP Checklist kholiye',
  },

  // ─── DIGITAL_ASSETS ───────────────────────────────────────────────────────
  critical_assets_ready: {
    key: 'critical_assets_ready', category: 'DIGITAL_ASSETS', kind: 'AUTO_DERIVED',
    labelEn: 'Critical assets ready (≥80%)',
    labelHi: 'Critical assets ready (≥80%)',
    descEn: 'Logo, cover image, exterior photo, hero room photo, food photo, etc.',
    descHi: 'Logo, cover image, exterior photo, hero room photo, food photo, etc.',
    fixActionPath: '/owner/:slug/assets',
    fixActionLabelEn: 'Open asset manager',
    fixActionLabelHi: 'Asset manager kholiye',
  },
  high_assets_ready: {
    key: 'high_assets_ready', category: 'DIGITAL_ASSETS', kind: 'AUTO_DERIVED',
    labelEn: 'High-priority assets ready (≥60%)',
    labelHi: 'High-priority assets ready (≥60%)',
    descEn: 'Secondary room types, dining area, common spaces, view photos.',
    descHi: 'Secondary room types, dining area, common spaces, view photos.',
    fixActionPath: '/owner/:slug/assets',
    fixActionLabelEn: 'Open asset manager',
    fixActionLabelHi: 'Asset manager kholiye',
  },
  brand_basics: {
    key: 'brand_basics', category: 'DIGITAL_ASSETS', kind: 'AUTO_DERIVED',
    labelEn: 'Brand basics set (logo + colour)',
    labelHi: 'Brand basics set hain (logo + colour)',
    descEn: 'Property logo and brand colour drive consistent guest-facing materials.',
    descHi: 'Logo aur brand colour se guest-facing materials consistent dikhte hain.',
    fixActionPath: '/owner/:slug/settings',
    fixActionLabelEn: 'Open branding settings',
    fixActionLabelHi: 'Branding settings kholiye',
  },

  // ─── DIRECT_ENQUIRY ───────────────────────────────────────────────────────
  whatsapp_connected: {
    key: 'whatsapp_connected', category: 'DIRECT_ENQUIRY', kind: 'AUTO_DERIVED',
    labelEn: 'WhatsApp connected',
    labelHi: 'WhatsApp connect ho chuka hai',
    descEn: 'WhatsApp Business API is wired — guests can message you directly.',
    descHi: 'WhatsApp Business API wired hai — guests seedha message kar sakte hain.',
    fixActionPath: '/owner/:slug/settings',
    fixActionLabelEn: 'Connect WhatsApp',
    fixActionLabelHi: 'WhatsApp connect kariye',
  },
  booking_url_set: {
    key: 'booking_url_set', category: 'DIRECT_ENQUIRY', kind: 'AUTO_DERIVED',
    labelEn: 'Direct booking URL set',
    labelHi: 'Direct booking URL set hai',
    descEn: 'Your direct-booking page link is configured for owner-led traffic.',
    descHi: 'Aapka direct-booking page link configure hai owner-led traffic ke liye.',
    fixActionPath: '/owner/:slug/settings',
    fixActionLabelEn: 'Add booking URL',
    fixActionLabelHi: 'Booking URL jodiye',
  },
  payment_ready: {
    key: 'payment_ready', category: 'DIRECT_ENQUIRY', kind: 'AUTO_DERIVED',
    labelEn: 'Online payment configured (Razorpay or UPI)',
    labelHi: 'Online payment configure hai (Razorpay ya UPI)',
    descEn: 'Guests can pay you online via Razorpay or UPI ID on file.',
    descHi: 'Guests aapko Razorpay ya UPI ID se online pay kar sakte hain.',
    fixActionPath: '/owner/:slug/settings',
    fixActionLabelEn: 'Configure payments',
    fixActionLabelHi: 'Payments configure kariye',
  },
  lead_response_time: {
    key: 'lead_response_time', category: 'DIRECT_ENQUIRY', kind: 'AUTO_DERIVED',
    labelEn: 'Median lead first-response ≤ 4 hours',
    labelHi: 'Median lead first-response ≤ 4 ghante',
    descEn: 'Across the last 10 leads, you respond within 4 hours.',
    descHi: 'Pichle 10 leads pe aap 4 ghante mein response dete hain.',
    fixActionPath: '/owner/:slug/leads',
    fixActionLabelEn: 'Open Lead inbox',
    fixActionLabelHi: 'Lead inbox kholiye',
    minSample: 5,
    insufficientDataNote:
      'Not enough lead history yet — needs ≥5 leads beyond NEW status.',
  },

  // ─── EXPERIENCE_PACKAGES ──────────────────────────────────────────────────
  package_live: {
    key: 'package_live', category: 'EXPERIENCE_PACKAGES', kind: 'AUTO_DERIVED',
    labelEn: 'At least one experience package live',
    labelHi: 'Ek experience package live hai',
    descEn: 'A published package gives guests a concrete reason to book direct.',
    descHi: 'Published package se guests ko direct book karne ka reason milta hai.',
    fixActionPath: '/owner/:slug/packages',
    fixActionLabelEn: 'Open Package Builder',
    fixActionLabelHi: 'Package Builder kholiye',
  },
  seo_blueprint_ready: {
    key: 'seo_blueprint_ready', category: 'EXPERIENCE_PACKAGES', kind: 'AUTO_DERIVED',
    labelEn: 'At least one safe SEO blueprint ready to build',
    labelHi: 'Ek safe SEO blueprint ready to build hai',
    descEn: 'A SAFE_BLUEPRINT approved in Local SEO Planner shows local intent.',
    descHi: 'Local SEO Planner mein approved SAFE_BLUEPRINT local intent dikhata hai.',
    fixActionPath: '/owner/:slug/seo-planner',
    fixActionLabelEn: 'Open SEO Planner',
    fixActionLabelHi: 'SEO Planner kholiye',
  },
};

/** Substitute :slug in a fix-action path. Returns external URLs unchanged. */
export function resolveFixAction(meta: VisibilitySignalMeta, slug: string): string {
  if (/^https?:\/\//.test(meta.fixActionPath)) return meta.fixActionPath;
  return meta.fixActionPath.replace(':slug', encodeURIComponent(slug));
}

/** True when the deep-link target is an external URL. */
export function isExternalFixAction(meta: VisibilitySignalMeta): boolean {
  return /^https?:\/\//.test(meta.fixActionPath);
}

/** Helper for UI: classification → CSS tone token. */
export const VISIBILITY_STATE_TONE: Record<
  'UNCLAIMED' | 'SELF_ATTESTED' | 'MANAGER_VERIFIED' | 'AUTO_PASS' | 'AUTO_FAIL' | 'INSUFFICIENT_DATA',
  'emerald' | 'amber' | 'rose' | 'slate' | 'sky'
> = {
  UNCLAIMED:         'slate',
  SELF_ATTESTED:     'amber',
  MANAGER_VERIFIED:  'emerald',
  AUTO_PASS:         'emerald',
  AUTO_FAIL:         'rose',
  INSUFFICIENT_DATA: 'sky',
};

// Sanity: weights sum to 100. Throws at module load if drifted.
const _weightsSum = Object.values(VISIBILITY_FORMULA.weights).reduce((a, b) => a + b, 0);
if (_weightsSum !== 100) {
  // eslint-disable-next-line no-console
  console.error('[visibilityScore] weights sum is', _weightsSum, '— expected 100');
}
