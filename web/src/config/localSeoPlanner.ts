// web/src/config/localSeoPlanner.ts
//
// Local SEO Landing Planner v0 — feature flag, labels, deterministic Policy
// Shield, proof catalogs, and disclaimer copy.
//
// Toggle: flip LOCAL_SEO_LANDING_PLANNER_V0_ENABLED = false to hide all
// surfaces (dashboard card + side-nav + /owner/:slug/seo-planner route).
//
// This is an INTERNAL planning/governance tool. It publishes nothing, calls no
// AI, scrapes no keywords, and touches no sitemap/robots/metadata. All guidance
// is deterministic and rule-based.

import type {
  SeoBlueprintCategory,
  SeoBlueprintRisk,
  SeoBlueprintStatus,
  SeoReviewStatus,
  SeoProofItem,
} from '../types/seoBlueprint';

export const LOCAL_SEO_LANDING_PLANNER_V0_ENABLED = true;

// Required disclaimer — shown verbatim on the workspace + dashboard card.
export const LOCAL_SEO_DISCLAIMER =
  'Local SEO Landing Planner is an internal planning tool. It does not publish pages, modify metadata, guarantee rankings, traffic, bookings, revenue, or Google visibility.';

// Owner-facing Hinglish explainer.
export const LOCAL_SEO_DISCLAIMER_HI =
  'Yeh planner batata hai kaunse local page ideas safe hain aur kaunse spam ya fake claim jaise lag sakte hain. Public page banane se pehle real photos, packages aur location proof zaroor chahiye.';

// ── Category labels / options ───────────────────────────────────────────────

export const SEO_CATEGORY_LABEL: Record<SeoBlueprintCategory, string> = {
  GEOGRAPHIC_FOCUS: 'Geographic focus',
  TRAVELER_NICHE: 'Traveler niche',
  SEASONAL_POSITION: 'Seasonal position',
  TARGET_MARKET: 'Target market',
  AMENITY_TRUST: 'Amenity / trust',
  PACKAGE_LED: 'Package-led',
};

export const SEO_CATEGORY_OPTIONS: SeoBlueprintCategory[] = [
  'GEOGRAPHIC_FOCUS',
  'TRAVELER_NICHE',
  'SEASONAL_POSITION',
  'TARGET_MARKET',
  'AMENITY_TRUST',
  'PACKAGE_LED',
];

export const SEO_CATEGORY_HINT: Record<SeoBlueprintCategory, string> = {
  GEOGRAPHIC_FOCUS: 'Location/landmark-anchored ("Family stay in Mukteshwar"). Needs real location proof.',
  TRAVELER_NICHE: 'Audience-led ("Workation homestay", "Wellness retreat"). Substantiate with real amenities.',
  SEASONAL_POSITION: 'Time-of-year angle ("Monsoon retreat in Uttarakhand"). Tie to a real seasonal offer.',
  TARGET_MARKET: 'Source-market angle ("Weekend stay from Delhi NCR"). Needs an honest travel/route claim.',
  AMENITY_TRUST: 'Amenity/trust signal ("Parking-friendly stay"). Only if the amenity genuinely exists.',
  PACKAGE_LED: 'Built around a real Package Builder package. Strongest when the package is live.',
};

// ── Risk labels / tones ─────────────────────────────────────────────────────

export const SEO_RISK_LABEL: Record<SeoBlueprintRisk, string> = {
  SAFE_BLUEPRINT: 'Safe blueprint',
  NEEDS_PROOF: 'Needs proof',
  RISKY_DOORWAY: 'Risky / doorway',
  FAKE_LOCAL_CLAIM: 'Fake local claim',
  DUPLICATE_LOW_VALUE: 'Duplicate / low value',
  ON_HOLD: 'On hold',
};

export type RiskTone = 'safe' | 'warn' | 'danger' | 'neutral';

export const SEO_RISK_TONE: Record<SeoBlueprintRisk, RiskTone> = {
  SAFE_BLUEPRINT: 'safe',
  NEEDS_PROOF: 'warn',
  RISKY_DOORWAY: 'danger',
  FAKE_LOCAL_CLAIM: 'danger',
  DUPLICATE_LOW_VALUE: 'danger',
  ON_HOLD: 'neutral',
};

// Risk classifications a manager cannot sign off (mirrors approve RPC guard).
export const SEO_RISK_BLOCKS_APPROVAL: SeoBlueprintRisk[] = [
  'RISKY_DOORWAY',
  'FAKE_LOCAL_CLAIM',
  'DUPLICATE_LOW_VALUE',
];

// ── Status / review labels ──────────────────────────────────────────────────

export const SEO_STATUS_LABEL: Record<SeoBlueprintStatus, string> = {
  DRAFT: 'Draft',
  IN_REVIEW: 'In review',
  READY_TO_BUILD: 'Ready to build',
  ON_HOLD: 'On hold',
  ARCHIVED: 'Archived',
};

export const SEO_REVIEW_LABEL: Record<SeoReviewStatus, string> = {
  PENDING_REVIEW: 'Awaiting review',
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
};

// ── Connected-module suggestions (soft labels; not all modules exist yet) ───

export const SEO_CONNECTED_MODULE_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'PACKAGE_BUILDER', label: 'Package Builder' },
  { value: 'ASSET_MANAGER', label: 'Digital Asset Manager' },
  { value: 'SEASONAL_CALENDAR', label: 'Seasonal Calendar (coming soon)' },
] as const;

// ── Deterministic proof catalog per category ────────────────────────────────
// Seeds the proof checklist when a blueprint is created. Owners tick items as
// they gather proof; unsatisfied proof drives the NEEDS_PROOF flag.

const PROOF = (key: string, en: string, hi: string): SeoProofItem => ({
  key,
  label_en: en,
  label_hi: hi,
  satisfied: false,
});

export const SEO_PROOF_BY_CATEGORY: Record<SeoBlueprintCategory, SeoProofItem[]> = {
  GEOGRAPHIC_FOCUS: [
    PROOF('real_location', 'Property genuinely in/near this location', 'Property sach mein is location pe/paas hai'),
    PROOF('local_photos', '3+ real photos of the area/property', 'Area/property ki 3+ asli photos'),
    PROOF('distance_honest', 'Honest distance/travel-time stated', 'Sahi distance/travel-time likha hai'),
  ],
  TRAVELER_NICHE: [
    PROOF('amenity_exists', 'The niche amenity/feature actually exists', 'Niche amenity/feature sach mein hai'),
    PROOF('proof_photos', 'Photos that prove the niche fit', 'Niche fit prove karne wali photos'),
  ],
  SEASONAL_POSITION: [
    PROOF('season_offer', 'A real seasonal offer/package exists', 'Asli seasonal offer/package hai'),
    PROOF('season_window', 'Accurate season window stated', 'Sahi season window likha hai'),
  ],
  TARGET_MARKET: [
    PROOF('route_honest', 'Travel route/time from source market is honest', 'Source market se route/time sahi hai'),
    PROOF('market_relevance', 'Property genuinely suits this market', 'Property is market ke liye sach mein theek hai'),
  ],
  AMENITY_TRUST: [
    PROOF('amenity_real', 'The amenity genuinely exists', 'Amenity sach mein hai'),
    PROOF('amenity_photo', 'Photo proof of the amenity', 'Amenity ki photo proof'),
  ],
  PACKAGE_LED: [
    PROOF('package_live', 'Linked package is built (ideally active)', 'Linked package bana hua hai (ideally active)'),
    PROOF('package_photos', 'Package has real photos/inclusions', 'Package mein asli photos/inclusions hain'),
  ],
};

// ── Deterministic Policy Shield (mirrors SQL _classify_seo_blueprint EXACTLY) ─

// Categories that assert something verifiable and therefore always need proof.
const NEEDS_PROOF_CATEGORIES: ReadonlySet<SeoBlueprintCategory> = new Set([
  'GEOGRAPHIC_FOCUS',
  'AMENITY_TRUST',
  'TARGET_MARKET',
]);

// Superlative / unprovable-overclaim language. Keep in lockstep with the SQL
// classifier. The "#1" alternative is checked separately because `\b` doesn't
// anchor against `#` (a non-word char), so a single combined `\b(...)\b` regex
// would miss "#1 anything" — the most common spam pattern.
const SEO_SUPERLATIVE_REGEX =
  /\b(best|cheapest|cheap|top|number\s*one|no\.?\s*1|lowest|guaranteed|world\s*class|5\s*star|five\s*star)\b/i;
const SEO_HASH_ONE_REGEX = /#\s*1\b/;

function hasSuperlative(title: string): boolean {
  return SEO_SUPERLATIVE_REGEX.test(title) || SEO_HASH_ONE_REGEX.test(title);
}

export function allProofSatisfied(proof: SeoProofItem[]): boolean {
  return proof.length > 0 && proof.every((p) => p.satisfied);
}

/**
 * Deterministic risk classifier. MUST stay byte-for-byte equivalent in behaviour
 * to public._classify_seo_blueprint() in the migration — the server value is
 * authoritative; this mirror exists for instant in-form feedback.
 */
export function classifyBlueprint(input: {
  title: string;
  category: SeoBlueprintCategory;
  proof: SeoProofItem[];
  isDuplicate: boolean;
}): SeoBlueprintRisk {
  const { title, category, proof, isDuplicate } = input;
  if (isDuplicate) return 'DUPLICATE_LOW_VALUE';
  if (hasSuperlative(title ?? '')) return 'RISKY_DOORWAY';

  const proofOk = allProofSatisfied(proof);
  if (NEEDS_PROOF_CATEGORIES.has(category) && (proof.length === 0 || !proofOk)) {
    return 'NEEDS_PROOF';
  }
  if (proof.length > 0 && !proofOk) return 'NEEDS_PROOF';
  return 'SAFE_BLUEPRINT';
}

// ── Starter ideas (safe examples per PO spec) — pure UI scaffolding ──────────

export const SEO_STARTER_IDEAS: Array<{ title: string; category: SeoBlueprintCategory }> = [
  { title: 'Family stay in Mukteshwar', category: 'GEOGRAPHIC_FOCUS' },
  { title: 'Weekend stay from Delhi NCR', category: 'TARGET_MARKET' },
  { title: 'Workation homestay in Uttarakhand', category: 'TRAVELER_NICHE' },
  { title: 'Wellness retreat near Rishikesh', category: 'TRAVELER_NICHE' },
  { title: 'Monsoon retreat in Uttarakhand', category: 'SEASONAL_POSITION' },
  { title: 'Parking-friendly stay in Mukteshwar', category: 'AMENITY_TRUST' },
];
