// web/src/config/otaOptimizer.ts
//
// OTA Listing Optimizer v0 — TS config + catalog mirror.
//
// Toggle: flip OTA_LISTING_OPTIMIZER_V0_ENABLED = false to hide all surfaces
// (dashboard card + quick-nav tile + /owner/:slug/ota route).
//
// This is an INTERNAL self-audit workbook. It does NOT:
//   • Connect to any OTA API
//   • Scrape any OTA website
//   • Sync inventory/rates/bookings
//   • Automate descriptions/photos
//
// SQL is authoritative for weights + applicability rules (see
// _ota_catalog() in supabase/migrations/20260601000002_ota_listing_optimizer.sql).
// This TS mirror carries labels, descriptions, fix-action routes, and tone
// tokens. The vitest parity test in otaOptimizer.test.ts asserts SQL ↔ TS
// key-set match.

import type {
  OTAPlatform,
  OTAReadinessBand,
  OTAReadinessCategory,
  OTAReadinessStatus,
  OTACatalogItem,
  OTAFixModule,
} from '../types/otaOptimizer';

export const OTA_LISTING_OPTIMIZER_V0_ENABLED = true;

// ── Disclaimers (verbatim per PO spec) ──────────────────────────────────────

export const OTA_DISCLAIMER_EN =
  'OTA Listing Optimizer is an internal readiness tool. It does not connect to OTA platforms, change listings, sync inventory, guarantee rankings, bookings, revenue, or occupancy.';

export const OTA_DISCLAIMER_HI =
  'Yeh tool sirf readiness dikhata hai. OTA ranking ya booking ki koi guarantee nahi hai. VAiyu se koi OTA pe seedha kuch nahi badalta — sirf checklist hai.';

// ── OTA labels ──────────────────────────────────────────────────────────────

export const OTA_PLATFORM_LABEL: Record<OTAPlatform, string> = {
  MMT:         'MakeMyTrip',
  GOIBIBO:     'Goibibo',
  BOOKING_COM: 'Booking.com',
  AGODA:       'Agoda',
  AIRBNB:      'Airbnb',
  EXPEDIA:     'Expedia',
  YATRA:       'Yatra',
  TRIPADVISOR: 'TripAdvisor',
};

/** Compact 3-5 char labels for dense UI like dashboard pills + matrix headers. */
export const OTA_PLATFORM_SHORT: Record<OTAPlatform, string> = {
  MMT:         'MMT',
  GOIBIBO:     'GOIB',
  BOOKING_COM: 'BKG',
  AGODA:       'AGO',
  AIRBNB:      'ABNB',
  EXPEDIA:     'EXP',
  YATRA:       'YAT',
  TRIPADVISOR: 'TRIP',
};

export const OTA_PLATFORM_LABEL_HI: Record<OTAPlatform, string> = {
  MMT:         'MakeMyTrip',
  GOIBIBO:     'Goibibo',
  BOOKING_COM: 'Booking.com',
  AGODA:       'Agoda',
  AIRBNB:      'Airbnb',
  EXPEDIA:     'Expedia',
  YATRA:       'Yatra',
  TRIPADVISOR: 'TripAdvisor',
};

export const OTA_PLATFORM_ORDER: OTAPlatform[] = [
  'MMT',
  'GOIBIBO',
  'BOOKING_COM',
  'AGODA',
  'AIRBNB',
  'EXPEDIA',
  'YATRA',
  'TRIPADVISOR',
];

// Brief one-line description of each OTA for the wizard's active-toggle step.

export const OTA_PLATFORM_DESC_EN: Record<OTAPlatform, string> = {
  MMT:         'India\'s largest OTA — wide reach, especially leisure',
  GOIBIBO:     'Indian OTA owned by MMT — overlapping but distinct audience',
  BOOKING_COM: 'Global OTA — strong for foreign travellers + business',
  AGODA:       'Global OTA — Asia/Pacific focus',
  AIRBNB:      'Home-share OTA — best fit for villas, homestays, single-unit',
  EXPEDIA:     'Global OTA — packaged bookings',
  YATRA:       'Indian OTA — bus/train + hotel combos',
  TRIPADVISOR: 'Review platform with booking redirects',
};

export const OTA_PLATFORM_DESC_HI: Record<OTAPlatform, string> = {
  MMT:         'Bharat ka sabse bada OTA — leisure ke liye accha',
  GOIBIBO:     'MMT ka hi platform — thoda alag audience',
  BOOKING_COM: 'Global OTA — foreign aur business travellers ke liye',
  AGODA:       'Global OTA — Asia/Pacific focus',
  AIRBNB:      'Home-share OTA — villa, homestay, single-unit ke liye sahi',
  EXPEDIA:     'Global OTA — package bookings',
  YATRA:       'Indian OTA — bus/train + hotel combos',
  TRIPADVISOR: 'Review platform; booking redirect bhi karta hai',
};

// ── Category labels ────────────────────────────────────────────────────────

export const OTA_CATEGORY_LABEL: Record<OTAReadinessCategory, string> = {
  LISTING_QUALITY:          'Listing quality',
  PHOTOS_MEDIA:             'Photos & media',
  ROOM_NAMING:              'Room naming',
  AMENITIES_FACILITIES:     'Amenities & facilities',
  POLICIES:                 'Policies',
  REVIEW_DISCIPLINE:        'Review discipline',
  PAYMENT_BOOKING_CLARITY:  'Payment & booking clarity',
  SEASONAL_POSITIONING:     'Seasonal positioning',
  TRUST_SIGNALS:            'Trust signals',
  DIRECT_BOOKING_READINESS: 'Direct booking readiness',
  MOUNTAIN_DISCLOSURE:      'Mountain disclosures',
};

export const OTA_CATEGORY_LABEL_HI: Record<OTAReadinessCategory, string> = {
  LISTING_QUALITY:          'Listing quality',
  PHOTOS_MEDIA:             'Photos aur media',
  ROOM_NAMING:              'Room naming',
  AMENITIES_FACILITIES:     'Amenities aur facilities',
  POLICIES:                 'Policies',
  REVIEW_DISCIPLINE:        'Review discipline',
  PAYMENT_BOOKING_CLARITY:  'Payment aur booking clarity',
  SEASONAL_POSITIONING:     'Seasonal positioning',
  TRUST_SIGNALS:            'Trust signals',
  DIRECT_BOOKING_READINESS: 'Direct booking ke liye taiyari',
  MOUNTAIN_DISCLOSURE:      'Mountain property disclosures',
};

export const OTA_CATEGORY_ORDER: OTAReadinessCategory[] = [
  'LISTING_QUALITY',
  'PHOTOS_MEDIA',
  'ROOM_NAMING',
  'AMENITIES_FACILITIES',
  'POLICIES',
  'REVIEW_DISCIPLINE',
  'PAYMENT_BOOKING_CLARITY',
  'SEASONAL_POSITIONING',
  'TRUST_SIGNALS',
  'DIRECT_BOOKING_READINESS',
  'MOUNTAIN_DISCLOSURE',
];

// ── Status labels ──────────────────────────────────────────────────────────

export const OTA_STATUS_LABEL: Record<OTAReadinessStatus, string> = {
  COMPLETE:       'Complete',
  PARTIAL:        'Partial',
  MISSING:        'Missing',
  UNKNOWN:        'Not reviewed',
  NOT_APPLICABLE: 'N/A',
};

export const OTA_STATUS_LABEL_HI: Record<OTAReadinessStatus, string> = {
  COMPLETE:       'Pura ho gaya',
  PARTIAL:        'Aadha',
  MISSING:        'Nahi hai',
  UNKNOWN:        'Check nahi kiya',
  NOT_APPLICABLE: 'Lagu nahi',
};

export type StatusTone = 'emerald' | 'amber' | 'rose' | 'slate' | 'sky';

export const OTA_STATUS_TONE: Record<OTAReadinessStatus, StatusTone> = {
  COMPLETE:       'emerald',
  PARTIAL:        'amber',
  MISSING:        'rose',
  UNKNOWN:        'slate',
  NOT_APPLICABLE: 'sky',
};

// ── Band labels + thresholds ────────────────────────────────────────────────
// Thresholds locked: Critical < 50, Moderate 50–80, Premium ≥ 80.

export const OTA_BAND_LABEL: Record<OTAReadinessBand, string> = {
  CRITICAL: 'Critical gaps',
  MODERATE: 'Moderate ready',
  PREMIUM:  'Premium ready',
};

export const OTA_BAND_LABEL_HI: Record<OTAReadinessBand, string> = {
  CRITICAL: 'Bahut kuch baki hai',
  MODERATE: 'Theek hai, aur sudhar sakte hain',
  PREMIUM:  'Bahut achhi tarah ready ho',
};

export const OTA_BAND_TONE: Record<OTAReadinessBand, StatusTone> = {
  CRITICAL: 'rose',
  MODERATE: 'amber',
  PREMIUM:  'emerald',
};

export const OTA_BAND_THRESHOLDS = {
  PREMIUM:  80,
  MODERATE: 50,
  CRITICAL: 0,
} as const;

/** Pure-TS band classifier (must match the SQL view CASE branches). */
export function bandForOtaScore(score: number): OTAReadinessBand {
  if (score >= OTA_BAND_THRESHOLDS.PREMIUM) return 'PREMIUM';
  if (score >= OTA_BAND_THRESHOLDS.MODERATE) return 'MODERATE';
  return 'CRITICAL';
}

// ── Staleness UI thresholds (must match SQL view: 90d stale, 120d expired) ──

export const OTA_STALE_DAYS = 90;
export const OTA_EXPIRED_DAYS = 120;

/** Returns 'fresh' | 'stale' | 'expired' for the UI badge given an ISO timestamp. */
export function freshnessForReviewedAt(reviewedAt: string | null | undefined, atMs?: number): 'fresh' | 'stale' | 'expired' | 'never' {
  if (!reviewedAt) return 'never';
  const reviewedMs = new Date(reviewedAt).getTime();
  if (!Number.isFinite(reviewedMs)) return 'never';
  const nowMs = typeof atMs === 'number' ? atMs : Date.now();
  const daysOld = (nowMs - reviewedMs) / (1000 * 60 * 60 * 24);
  if (daysOld >= OTA_EXPIRED_DAYS) return 'expired';
  if (daysOld >= OTA_STALE_DAYS) return 'stale';
  return 'fresh';
}

// ── Fix-action route resolution ────────────────────────────────────────────
// Returns an in-app route under /owner/:slug/. Falls back to /settings for
// modules not yet routed (defensive — we only emit shipped routes today).

export function otaFixActionRoute(hotelSlug: string, fixModule: OTAFixModule): string {
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

export const OTA_FIX_MODULE_LABEL: Record<OTAFixModule, string> = {
  DAM:               'Asset Manager',
  PACKAGE_BUILDER:   'Package Builder',
  SEO_PLANNER:       'SEO Planner',
  SEASONAL_CALENDAR: 'Seasonal Calendar',
  VISIBILITY:        'Visibility Score',
  SETTINGS:          'Property settings',
};

// ── Mountain states (must match _ota_mountain_states() SQL) ─────────────────

export const OTA_MOUNTAIN_STATES = [
  'Uttarakhand',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Ladakh',
  'Sikkim',
  'Arunachal Pradesh',
] as const;

export function isStateMountain(state: string | null | undefined): boolean {
  if (!state) return false;
  return (OTA_MOUNTAIN_STATES as readonly string[]).includes(state);
}

// ── Catalog (TS mirror of _ota_catalog() SQL function) ─────────────────────
// Weight + applicability rules MUST match SQL. Vitest parity test enforces.
// Labels + descriptions + fix modules are TS-side only.

export const OTA_CATALOG: OTACatalogItem[] = [
  // ─── LISTING_QUALITY ─────────────────────────────────────────────────────
  {
    category: 'LISTING_QUALITY', itemKey: 'title_quality', weight: 4,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 10, fixModule: 'SEO_PLANNER',
    labelEn: 'Property title clearly conveys what you offer',
    labelHi: 'Title clearly batata hai aap kya offer karte hain',
    descEn: 'Strong titles include property type + location + a hook (e.g. "Family resort with snow view, Mussoorie").',
    descHi: 'Property type + location + ek hook (jaise "Snow view ke saath family resort, Mussoorie") accha title banata hai.',
  },
  {
    category: 'LISTING_QUALITY', itemKey: 'description_clear', weight: 4,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 11, fixModule: 'SEO_PLANNER',
    labelEn: 'Description is clear, benefit-led, no jargon',
    labelHi: 'Description clear hai, benefit-led hai, jargon-free hai',
    descEn: 'Tell guests what they get and why it matters. Short paragraphs, no marketing fluff.',
    descHi: 'Guest ko clearly batao kya milega aur kyon. Short paragraphs, marketing-speak nahi.',
  },
  {
    category: 'LISTING_QUALITY', itemKey: 'uniqueness', weight: 2,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 12, fixModule: 'SEO_PLANNER',
    labelEn: 'Listing has a unique angle vs neighbouring properties',
    labelHi: 'Listing mein ek unique angle hai (paas ke hotels se alag)',
    descEn: 'Identify one thing only you offer (view, signature dish, activity, history) and lead with it.',
    descHi: 'Ek aisi cheez highlight karo jo sirf aapke paas hai — view, khaana, activity, history.',
  },
  {
    category: 'LISTING_QUALITY', itemKey: 'consistency_across_otas', weight: 2,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 13, fixModule: 'SETTINGS',
    labelEn: 'Title and description consistent across all OTAs',
    labelHi: 'Title aur description sab OTAs mein same hai',
    descEn: 'Inconsistent listings confuse repeat guests and reduce trust. Audit MMT/Booking/Agoda for drift.',
    descHi: 'Alag-alag OTAs pe alag-alag description guest ko confuse karta hai. Sab platform pe ek hi version rakho.',
  },

  // ─── PHOTOS_MEDIA ───────────────────────────────────────────────────────
  {
    category: 'PHOTOS_MEDIA', itemKey: 'exterior_photos', weight: 4,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 20, fixModule: 'DAM',
    labelEn: '3+ exterior photos uploaded (front, side, entrance)',
    labelHi: '3+ exterior photos hain (front, side, entrance)',
    descEn: 'Exteriors set first impressions. Daylight, no compression artefacts, no obstructions.',
    descHi: 'Exterior photo pehla impression banata hai. Din ki roshni mein, saaf, bina obstruction ke.',
  },
  {
    category: 'PHOTOS_MEDIA', itemKey: 'room_photos', weight: 4,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 21, fixModule: 'DAM',
    labelEn: '2+ photos per room type',
    labelHi: 'Har room type ke 2+ photos hain',
    descEn: 'Bed + window angle minimum. Make-up the room before shooting.',
    descHi: 'Bed + window se ek angle minimum. Photo lene se pehle room properly set karo.',
  },
  {
    category: 'PHOTOS_MEDIA', itemKey: 'bathroom_photos', weight: 2,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 22, fixModule: 'DAM',
    labelEn: 'Bathroom photo for each room type',
    labelHi: 'Har room type ke bathroom ka photo hai',
    descEn: 'Guests look for cleanliness signals. One well-lit bathroom shot per room type.',
    descHi: 'Guest cleanliness check karta hai. Har room type ke bathroom ka ek accha photo.',
  },
  {
    category: 'PHOTOS_MEDIA', itemKey: 'dining_photos', weight: 2,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 23, fixModule: 'DAM',
    labelEn: 'Restaurant or dining area photo (if served)',
    labelHi: 'Restaurant ya dining area ka photo (agar khaana milta hai)',
    descEn: 'If you offer meals, show the dining setting. Better than just a food close-up.',
    descHi: 'Agar khaana milta hai, dining area ka photo dikhao. Sirf khaane ka close-up kaafi nahi.',
  },
  {
    category: 'PHOTOS_MEDIA', itemKey: 'common_area_photos', weight: 2,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 24, fixModule: 'DAM',
    labelEn: 'Lobby/reception/garden photo',
    labelHi: 'Lobby ya reception ya garden ka photo hai',
    descEn: 'Common spaces convey the property\'s character. One well-framed shot is enough.',
    descHi: 'Common areas se property ka character pata chalta hai. Ek accha framed shot kaafi hai.',
  },
  {
    category: 'PHOTOS_MEDIA', itemKey: 'parking_photos', weight: 2,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 25, fixModule: 'DAM',
    labelEn: 'Parking visible in at least one photo',
    labelHi: 'Parking kam-se-kam ek photo mein dikh raha hai',
    descEn: 'Parking is a top guest question. Visible parking reduces "where do I park?" anxiety.',
    descHi: 'Parking guests ka top sawaal hota hai. Visible parking se "kahan park karoon" wala stress kam hota hai.',
  },
  {
    category: 'PHOTOS_MEDIA', itemKey: 'attraction_photos', weight: 2,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 26, fixModule: 'DAM',
    labelEn: 'Nearby attraction or scenic view photo',
    labelHi: 'Paas ki attraction ya view ka photo hai',
    descEn: 'Sell the location, not just the property. A view shot or attraction photo helps.',
    descHi: 'Sirf property nahi, location bhi bechni hai. View ya attraction photo helpful hota hai.',
  },

  // ─── ROOM_NAMING (N/A on Airbnb) ────────────────────────────────────────
  {
    category: 'ROOM_NAMING', itemKey: 'naming_consistency', weight: 2,
    isMountainOnly: false, notApplicableOtas: ['AIRBNB'], displayOrder: 30, fixModule: 'SETTINGS',
    labelEn: 'Same room name format across all OTAs',
    labelHi: 'Room ka naam sab OTAs pe same format mein hai',
    descEn: '"Deluxe Mountain View" on MMT but "Premium Hill View" on Booking creates trust issues for repeat guests.',
    descHi: 'MMT pe "Deluxe Mountain View" aur Booking pe "Premium Hill View" likhna repeat guest ke liye confusing hai.',
  },
  {
    category: 'ROOM_NAMING', itemKey: 'differentiation', weight: 2,
    isMountainOnly: false, notApplicableOtas: ['AIRBNB'], displayOrder: 31, fixModule: 'SETTINGS',
    labelEn: 'Each room type has a clear feature differentiator',
    labelHi: 'Har room type ka ek clear differentiator hai',
    descEn: 'Don\'t list two room types as "Deluxe" and "Deluxe Plus". State what makes them different.',
    descHi: 'Do room type ko "Deluxe" aur "Deluxe Plus" mat likho. Difference clearly batao (kya extra hai).',
  },
  {
    category: 'ROOM_NAMING', itemKey: 'occupancy_clarity', weight: 2,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 32, fixModule: 'SETTINGS',
    labelEn: 'Max adults + children clearly stated per room',
    labelHi: 'Har room mein kitne adults + bachche aa sakte hain — clearly likha hai',
    descEn: 'Avoid "Max 3" without telling whether that\'s 3 adults or 2A+1C. Be specific.',
    descHi: '"Max 3" likhne se confusion hota hai. "2 adults + 1 child" jaise specific likho.',
  },

  // ─── AMENITIES_FACILITIES ───────────────────────────────────────────────
  {
    category: 'AMENITIES_FACILITIES', itemKey: 'amenities_complete', weight: 3,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 40, fixModule: 'SETTINGS',
    labelEn: 'All amenities accurately ticked on every OTA',
    labelHi: 'Sab amenities sab OTAs pe sahi ticked hain',
    descEn: 'Missed amenity boxes hurt search filters. Take 10 minutes per OTA to verify the full list.',
    descHi: 'Amenity box miss karne se search mein dikhna kam ho jaata hai. Har OTA pe 10 minute mein check karo.',
  },
  {
    category: 'AMENITIES_FACILITIES', itemKey: 'facilities_clear', weight: 3,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 41, fixModule: 'SETTINGS',
    labelEn: 'Facilities (parking, pool, gym) clearly listed',
    labelHi: 'Facilities (parking, pool, gym) clearly listed hain',
    descEn: 'If you have a facility, it should appear in the OTA structured fields, not just the description.',
    descHi: 'Jo facility hai, OTA ke structured field mein bhi likho — sirf description mein nahi.',
  },
  {
    category: 'AMENITIES_FACILITIES', itemKey: 'service_visibility', weight: 3,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 42, fixModule: 'SETTINGS',
    labelEn: 'Services (laundry, cab, breakfast) visible to guests',
    labelHi: 'Services (laundry, cab, breakfast) guests ko clearly dikhti hain',
    descEn: 'List services with whether they\'re free or paid. Hidden service surprises lead to bad reviews.',
    descHi: 'Service free hai ya paid hai — yeh bhi likho. Hidden charges ka surprise bad reviews laata hai.',
  },

  // ─── POLICIES ───────────────────────────────────────────────────────────
  {
    category: 'POLICIES', itemKey: 'cancellation_policy', weight: 4,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 50, fixModule: 'SETTINGS',
    labelEn: 'Cancellation policy clearly stated',
    labelHi: 'Cancellation policy clearly likhi hai',
    descEn: 'State the cutoff (e.g. "Free cancellation up to 48 hrs before check-in"). Vague policies trigger disputes.',
    descHi: 'Cutoff time clear likho (jaise "48 ghante pehle tak free cancellation"). Vague policy se disputes hote hain.',
  },
  {
    category: 'POLICIES', itemKey: 'child_policy', weight: 2,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 51, fixModule: 'SETTINGS',
    labelEn: 'Child age and pricing policy stated',
    labelHi: 'Bachchon ki age aur pricing policy likhi hai',
    descEn: 'State free-stay age cap and extra-bed pricing. Indian families always ask.',
    descHi: 'Kis age tak bachcha free hai, aur extra bed ki kya price hai — likho. Family travellers yeh poochte hain.',
  },
  {
    category: 'POLICIES', itemKey: 'pet_policy', weight: 2,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 52, fixModule: 'SETTINGS',
    labelEn: 'Pet policy stated (allowed or not allowed)',
    labelHi: 'Pet policy likhi hai (allowed ya nahi)',
    descEn: 'Even a clear "no pets" is better than silence. Pet owners filter heavily.',
    descHi: 'Clear "pets allowed nahi" bhi silence se behtar hai. Pet rakhne wale specifically filter karte hain.',
  },
  {
    category: 'POLICIES', itemKey: 'checkin_policy', weight: 2,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 53, fixModule: 'SETTINGS',
    labelEn: 'Check-in time and ID requirements clear',
    labelHi: 'Check-in time aur ID requirements clear hain',
    descEn: 'State the standard check-in time and whether early check-in is possible (and at what cost).',
    descHi: 'Standard check-in time aur early check-in possible hai ya nahi — likho. Cost bhi mention karo agar paid hai.',
  },
  {
    category: 'POLICIES', itemKey: 'checkout_policy', weight: 2,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 54, fixModule: 'SETTINGS',
    labelEn: 'Check-out time and late-checkout policy stated',
    labelHi: 'Check-out time aur late check-out policy likhi hai',
    descEn: 'Standard checkout + late checkout charges. Avoid surprise charges that trigger refund requests.',
    descHi: 'Standard checkout time + late checkout ki charges — likho. Surprise charges se refund requests aate hain.',
  },

  // ─── REVIEW_DISCIPLINE ──────────────────────────────────────────────────
  {
    category: 'REVIEW_DISCIPLINE', itemKey: 'review_collection', weight: 3,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 60, fixModule: 'VISIBILITY',
    labelEn: 'Active process to ask guests for OTA reviews',
    labelHi: 'Guests se OTA review maangne ka process hai',
    descEn: 'Have a check-out script or follow-up message. Don\'t just hope reviews appear.',
    descHi: 'Check-out time pe ya baad mein follow-up message bhejo. Sirf hope karne se reviews nahi aate.',
  },
  {
    category: 'REVIEW_DISCIPLINE', itemKey: 'review_response', weight: 4,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 61, fixModule: 'VISIBILITY',
    labelEn: 'Responding to recent OTA reviews',
    labelHi: 'Recent OTA reviews ka jawab de rahe hain',
    descEn: 'Respond to every review within 48 hours. Unanswered reviews send a "doesn\'t care" signal.',
    descHi: 'Har review ka 48 ghante mein jawab do. Bina jawab ke review chhodna "doesn\'t care" signal deta hai.',
  },
  {
    category: 'REVIEW_DISCIPLINE', itemKey: 'trust_management', weight: 3,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 62, fixModule: 'VISIBILITY',
    labelEn: 'Professional responses to negative reviews',
    labelHi: 'Negative reviews ka professional jawab dete ho',
    descEn: 'Apologise, fix, follow up. Defensive replies look worse than the original complaint.',
    descHi: 'Sorry bolo, fix karo, follow-up karo. Defensive reply original complaint se zyada bura lagta hai.',
  },

  // ─── PAYMENT_BOOKING_CLARITY (N/A on TripAdvisor) ───────────────────────
  {
    category: 'PAYMENT_BOOKING_CLARITY', itemKey: 'payment_methods', weight: 3,
    isMountainOnly: false, notApplicableOtas: ['TRIPADVISOR'], displayOrder: 70, fixModule: 'SETTINGS',
    labelEn: 'Payment methods clearly listed',
    labelHi: 'Payment methods clearly listed hain',
    descEn: 'State accepted methods: card, UPI, cash on arrival, partial advance. Reduces booking friction.',
    descHi: 'Accept kya karte ho — card, UPI, cash on arrival, partial advance — clearly batao. Booking friction kam hoga.',
  },
  {
    category: 'PAYMENT_BOOKING_CLARITY', itemKey: 'booking_policy', weight: 3,
    isMountainOnly: false, notApplicableOtas: ['TRIPADVISOR'], displayOrder: 71, fixModule: 'SETTINGS',
    labelEn: 'Booking confirmation and advance policy stated',
    labelHi: 'Booking confirmation aur advance ki policy likhi hai',
    descEn: 'How much advance is needed? When is the booking confirmed? Owners often leave this implicit.',
    descHi: 'Kitna advance lagta hai? Booking kab confirm hoti hai? Yeh saaf likho — owners chhod dete hain.',
  },
  {
    category: 'PAYMENT_BOOKING_CLARITY', itemKey: 'refund_policy', weight: 2,
    isMountainOnly: false, notApplicableOtas: ['TRIPADVISOR'], displayOrder: 72, fixModule: 'SETTINGS',
    labelEn: 'Refund policy clearly stated',
    labelHi: 'Refund policy clearly likhi hai',
    descEn: 'Refund timelines + deduction rules. Refund disputes are the #1 OTA-mediated friction.',
    descHi: 'Refund timeline + deduction rules — likho. Refund disputes OTA pe sabse zyada hote hain.',
  },

  // ─── SEASONAL_POSITIONING ───────────────────────────────────────────────
  {
    category: 'SEASONAL_POSITIONING', itemKey: 'summer_readiness', weight: 2,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 80, fixModule: 'PACKAGE_BUILDER',
    labelEn: 'Summer offer or positioning visible',
    labelHi: 'Summer ka offer ya positioning visible hai',
    descEn: 'Even a banner saying "Cool summer escape, AC rooms, ₹3000 off" sets seasonal intent.',
    descHi: '"Garmi mein cool escape, AC rooms, ₹3000 off" jaisa banner bhi seasonal intent dikhata hai.',
  },
  {
    category: 'SEASONAL_POSITIONING', itemKey: 'winter_readiness', weight: 2,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 81, fixModule: 'SEASONAL_CALENDAR',
    labelEn: 'Winter offer or positioning visible',
    labelHi: 'Winter ka offer ya positioning visible hai',
    descEn: 'For mountains, snow + heating focus. For plains, fog/family-getaway angle.',
    descHi: 'Pahad ke liye snow + heating focus. Plains ke liye fog/family getaway angle.',
  },
  {
    category: 'SEASONAL_POSITIONING', itemKey: 'monsoon_readiness', weight: 2,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 82, fixModule: 'SEASONAL_CALENDAR',
    labelEn: 'Monsoon offer or positioning visible',
    labelHi: 'Monsoon ka offer ya positioning visible hai',
    descEn: 'Monsoon is high season for many destinations. Lead with greenery, indoor amenities, road updates.',
    descHi: 'Monsoon kai jagah peak season hai. Hariyali, indoor amenities, road update — yeh highlight karo.',
  },
  {
    category: 'SEASONAL_POSITIONING', itemKey: 'festival_readiness', weight: 2,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 83, fixModule: 'SEASONAL_CALENDAR',
    labelEn: 'Festival offer or positioning visible (Diwali, Holi, NYE)',
    labelHi: 'Festival ka offer ya positioning hai (Diwali, Holi, NYE)',
    descEn: 'Festival packages get more searches in the 2-3 weeks before. Use Seasonal Calendar for timing.',
    descHi: 'Festival package 2-3 hafte pehle searches mein top karte hain. Timing ke liye Seasonal Calendar dekho.',
  },

  // ─── TRUST_SIGNALS ──────────────────────────────────────────────────────
  {
    category: 'TRUST_SIGNALS', itemKey: 'verification_ready', weight: 3,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 90, fixModule: 'DAM',
    labelEn: 'OTA verification proof uploaded (where required)',
    labelHi: 'OTA verification proof upload kiya hua hai (jahan required hai)',
    descEn: 'Booking.com, Airbnb, and some others verify host identity. Verified badges drive trust.',
    descHi: 'Booking.com, Airbnb verification kar lete hain. Verified badge se trust badhta hai.',
  },
  {
    category: 'TRUST_SIGNALS', itemKey: 'brand_assets', weight: 3,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 91, fixModule: 'DAM',
    labelEn: 'Logo and brand assets uploaded to OTA',
    labelHi: 'Logo aur brand assets OTA pe upload kiye hain',
    descEn: 'Branded listings look more professional than text-only. Upload your logo where supported.',
    descHi: 'Branded listing text-only se zyada professional dikhti hai. Logo upload karo jahan support karte hain.',
  },
  {
    category: 'TRUST_SIGNALS', itemKey: 'business_proof', weight: 2,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 92, fixModule: 'DAM',
    labelEn: 'GST or business proof uploaded',
    labelHi: 'GST ya business proof upload kiya hai',
    descEn: 'Required for B2B bookings on some OTAs. Reduces verification delays.',
    descHi: 'Kuch OTAs pe B2B bookings ke liye chahiye. Verification delays kam karta hai.',
  },

  // ─── DIRECT_BOOKING_READINESS ───────────────────────────────────────────
  {
    category: 'DIRECT_BOOKING_READINESS', itemKey: 'website_ready', weight: 3,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 100, fixModule: 'SETTINGS',
    labelEn: 'Direct booking website or page exists',
    labelHi: 'Direct booking website ya page hai',
    descEn: 'OTA-only is risky. Build a basic direct page even if it\'s just a contact form.',
    descHi: 'Sirf OTA pe rehna risky hai. Ek basic direct page bana lo — kam-se-kam contact form ke saath.',
  },
  {
    category: 'DIRECT_BOOKING_READINESS', itemKey: 'microsite_ready', weight: 2,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 101, fixModule: 'SETTINGS',
    labelEn: 'Microsite or landing page exists for property',
    labelHi: 'Property ke liye microsite ya landing page hai',
    descEn: 'A simple branded microsite captures direct-search traffic that OTAs can\'t reach.',
    descHi: 'Branded microsite OTAs ke bahar wala direct-search traffic capture karta hai.',
  },
  {
    category: 'DIRECT_BOOKING_READINESS', itemKey: 'whatsapp_ready', weight: 2,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 102, fixModule: 'SETTINGS',
    labelEn: 'WhatsApp business number visible on listings',
    labelHi: 'WhatsApp business number listings pe dikhta hai',
    descEn: 'Indian guests strongly prefer WhatsApp. Visible number drives direct enquiries.',
    descHi: 'Indian guests WhatsApp pe baat karna prefer karte hain. Number visible hone se direct enquiries aati hain.',
  },
  {
    category: 'DIRECT_BOOKING_READINESS', itemKey: 'enquiry_ready', weight: 2,
    isMountainOnly: false, notApplicableOtas: [], displayOrder: 103, fixModule: 'SETTINGS',
    labelEn: 'Direct enquiry contact visible on listings',
    labelHi: 'Direct enquiry ka contact listings pe dikhta hai',
    descEn: 'Phone or enquiry form visible. Guests with specific questions skip OTAs and reach out direct.',
    descHi: 'Phone ya enquiry form visible. Specific questions wale guests OTA chhod ke seedha aate hain.',
  },

  // ─── MOUNTAIN_DISCLOSURE (mountain-only) ────────────────────────────────
  {
    category: 'MOUNTAIN_DISCLOSURE', itemKey: 'parking_visibility', weight: 3,
    isMountainOnly: true, notApplicableOtas: [], displayOrder: 200, fixModule: 'SETTINGS',
    labelEn: 'Parking situation described (location, capacity)',
    labelHi: 'Parking situation likhi hai (location, kitni cars)',
    descEn: 'Mountain properties often have remote/limited parking. Set expectations upfront.',
    descHi: 'Mountain properties mein parking aksar door ya limited hota hai. Pehle se clear batao.',
  },
  {
    category: 'MOUNTAIN_DISCLOSURE', itemKey: 'road_approach', weight: 3,
    isMountainOnly: true, notApplicableOtas: [], displayOrder: 201, fixModule: 'SETTINGS',
    labelEn: 'Road approach described (paved/unpaved, last-mile)',
    labelHi: 'Road approach likhi hai (paved/unpaved, last-mile)',
    descEn: 'Is the last 1km on a paved road? Owners must state this to avoid arrival surprises.',
    descHi: 'Last 1km tak paved road hai? Owner ko likhna chahiye taaki guest ko surprise na ho.',
  },
  {
    category: 'MOUNTAIN_DISCLOSURE', itemKey: 'steep_road_disclosure', weight: 3,
    isMountainOnly: true, notApplicableOtas: [], displayOrder: 202, fixModule: 'SETTINGS',
    labelEn: 'Steep road or difficult drive disclosed',
    labelHi: 'Steep road ya difficult drive disclose kiya hai',
    descEn: 'Sedans struggle on some Himalayan roads. Disclose if 4x4 or SUV is recommended.',
    descHi: 'Kuch Himalayan roads pe sedan struggle karta hai. SUV/4x4 recommended ho to clearly batao.',
  },
  {
    category: 'MOUNTAIN_DISCLOSURE', itemKey: 'monsoon_access', weight: 3,
    isMountainOnly: true, notApplicableOtas: [], displayOrder: 203, fixModule: 'SETTINGS',
    labelEn: 'Monsoon-season road access info',
    labelHi: 'Monsoon season mein road access ki info hai',
    descEn: 'Landslides and washouts are real. State if roads remain accessible Jul-Sep.',
    descHi: 'Landslide aur washout hota hai. July-September mein road accessible hai ya nahi — likho.',
  },
  {
    category: 'MOUNTAIN_DISCLOSURE', itemKey: 'winter_snow_readiness', weight: 2,
    isMountainOnly: true, notApplicableOtas: [], displayOrder: 204, fixModule: 'SETTINGS',
    labelEn: 'Winter/snow access information',
    labelHi: 'Winter ya snow ke time access ki info hai',
    descEn: 'If snow blocks the road in Dec-Feb, say so. If road stays clear, that\'s a selling point.',
    descHi: 'Dec-Feb mein barf se road band ho jaaye to batao. Agar khulta hai, to selling point hai.',
  },
  {
    category: 'MOUNTAIN_DISCLOSURE', itemKey: 'heating_info', weight: 2,
    isMountainOnly: true, notApplicableOtas: [], displayOrder: 205, fixModule: 'SETTINGS',
    labelEn: 'Room heating availability stated',
    labelHi: 'Room heating availability likhi hai',
    descEn: 'State whether heaters are in-room or on-request. Mountain guests check this carefully.',
    descHi: 'Heater room mein already hai ya on-request hai — likho. Mountain guest yeh dhyaan se check karta hai.',
  },
  {
    category: 'MOUNTAIN_DISCLOSURE', itemKey: 'hot_water_info', weight: 2,
    isMountainOnly: true, notApplicableOtas: [], displayOrder: 206, fixModule: 'SETTINGS',
    labelEn: 'Hot water 24h or fixed-hours stated',
    labelHi: 'Hot water 24h hai ya fixed hours mein — likha hai',
    descEn: 'Fixed-hour hot water is fine, but disclose it. Geyser solar/diesel matters in mountains.',
    descHi: 'Fixed-hour hot water OK hai, par disclose karo. Solar ya diesel geyser yeh mountain mein important hai.',
  },
  {
    category: 'MOUNTAIN_DISCLOSURE', itemKey: 'wifi_quality', weight: 2,
    isMountainOnly: true, notApplicableOtas: [], displayOrder: 207, fixModule: 'SETTINGS',
    labelEn: 'WiFi quality stated honestly (not over-promised)',
    labelHi: 'WiFi quality honestly likhi hai (over-promise nahi)',
    descEn: 'Bad WiFi tanks reviews. Say "Basic, suitable for messaging" not "High-speed broadband".',
    descHi: 'Bad WiFi se reviews kharab hote hain. "Basic, messaging ke liye theek" likho — "high-speed" nahi.',
  },
  {
    category: 'MOUNTAIN_DISCLOSURE', itemKey: 'power_backup', weight: 2,
    isMountainOnly: true, notApplicableOtas: [], displayOrder: 208, fixModule: 'SETTINGS',
    labelEn: 'Power backup or generator info',
    labelHi: 'Power backup ya generator ki info hai',
    descEn: 'Power cuts are common. Say "Inverter for 3 hours" or "Generator for full duration of outage".',
    descHi: 'Bijli jaana common hai. "Inverter 3 ghante" ya "generator full time" — clearly likho.',
  },
  {
    category: 'MOUNTAIN_DISCLOSURE', itemKey: 'workation_ready', weight: 2,
    isMountainOnly: true, notApplicableOtas: [], displayOrder: 209, fixModule: 'SETTINGS',
    labelEn: 'Workation features (long stay, workspace, internet)',
    labelHi: 'Workation features likhe hain (long stay, workspace, internet)',
    descEn: 'Long-stay discount + good desk + WiFi: this is a real OTA filter in 2026.',
    descHi: 'Long-stay discount + accha desk + WiFi — yeh 2026 ka real filter hai OTAs pe.',
  },
  {
    category: 'MOUNTAIN_DISCLOSURE', itemKey: 'driver_stay_availability', weight: 2,
    isMountainOnly: true, notApplicableOtas: [], displayOrder: 210, fixModule: 'SETTINGS',
    labelEn: 'Driver stay availability and charges',
    labelHi: 'Driver stay availability aur charges likhi hain',
    descEn: 'Indian guests often travel with drivers. Disclose driver-room policy clearly.',
    descHi: 'Indian guests aksar driver ke saath aate hain. Driver-room policy clearly batao.',
  },
  {
    category: 'MOUNTAIN_DISCLOSURE', itemKey: 'pet_policy_mountain', weight: 2,
    isMountainOnly: true, notApplicableOtas: [], displayOrder: 211, fixModule: 'SETTINGS',
    labelEn: 'Pet policy clearly stated (mountain trips often include pets)',
    labelHi: 'Pet policy clearly likhi hai (mountain trip mein pets aksar saath aate hain)',
    descEn: 'Mountain road trips with pets are common. Pet policy matters more here than for city hotels.',
    descHi: 'Pet ke saath mountain trip common hai. Pet policy mountain hotels ke liye city se zyada matter karti hai.',
  },
  {
    category: 'MOUNTAIN_DISCLOSURE', itemKey: 'early_checkin_clarity', weight: 2,
    isMountainOnly: true, notApplicableOtas: [], displayOrder: 212, fixModule: 'SETTINGS',
    labelEn: 'Early check-in policy (for guests arriving after long drives)',
    labelHi: 'Early check-in policy likhi hai (lambi drive ke baad aane wale guests ke liye)',
    descEn: 'Mountain arrivals from Delhi/Chandigarh often hit 9-10am. Pre-3pm policy is a real selling point.',
    descHi: 'Delhi/Chandigarh se aane wale guest aksar 9-10am tak pahunch jaate hain. Early check-in policy real plus hai.',
  },
];

// ── Catalog lookup helpers ─────────────────────────────────────────────────

/** Returns the catalog item for a (category, itemKey) pair, or null. */
export function findOtaCatalogItem(
  category: OTAReadinessCategory,
  itemKey: string,
): OTACatalogItem | null {
  return OTA_CATALOG.find((c) => c.category === category && c.itemKey === itemKey) ?? null;
}

/** Returns catalog items for a category (in display order). */
export function otaCatalogForCategory(category: OTAReadinessCategory): OTACatalogItem[] {
  return OTA_CATALOG
    .filter((c) => c.category === category)
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

/** Returns true when an item applies to a hotel (considering mountain + OTA NA). */
export function isItemApplicable(
  item: OTACatalogItem,
  ota: OTAPlatform,
  isMountainHotel: boolean,
): boolean {
  if (item.isMountainOnly && !isMountainHotel) return false;
  if (item.notApplicableOtas.includes(ota)) return false;
  return true;
}

/** Convenience: catalog items applicable to a given OTA for a given hotel. */
export function applicableCatalogItems(ota: OTAPlatform, isMountainHotel: boolean): OTACatalogItem[] {
  return OTA_CATALOG
    .filter((c) => isItemApplicable(c, ota, isMountainHotel))
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

// Sanity: non-mountain weight sum (must match SQL non-mountain total = 100).
// Throws at module load if drifted. Hard guarantee for the parity test.
const _nonMtnSum = OTA_CATALOG
  .filter((c) => !c.isMountainOnly)
  .reduce((acc, c) => acc + c.weight, 0);
if (_nonMtnSum !== 100) {
  // eslint-disable-next-line no-console
  console.error('[otaOptimizer] non-mountain weights sum is', _nonMtnSum, '— expected 100');
}
const _mtnSum = OTA_CATALOG
  .filter((c) => c.isMountainOnly)
  .reduce((acc, c) => acc + c.weight, 0);
if (_mtnSum !== 30) {
  // eslint-disable-next-line no-console
  console.error('[otaOptimizer] mountain weights sum is', _mtnSum, '— expected 30');
}
