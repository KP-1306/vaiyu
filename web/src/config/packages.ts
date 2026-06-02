// web/src/config/packages.ts
//
// Feature flag + labels + helpers for the Experience Package Builder.

import type {
  PackageApprovalStatus,
  PackageCategory,
  PackagePricingBasis,
  PackageStatus,
} from '../types/package';

export const PACKAGE_BUILDER_V0_ENABLED = true;

// Mandatory disclaimer — appended to every public landing page and shown on
// the workspace + builder form.
export const PACKAGE_DISCLAIMER =
  'Package prices and details are promotional guidelines only. Final availability and rates must be manually confirmed by property staff before sharing with guests.';

export const PACKAGE_CATEGORY_LABEL: Record<PackageCategory, string> = {
  WEEKEND_ESCAPE: 'Weekend Escape',
  ADVENTURE_TREKKING: 'Adventure & Trekking',
  RELIGIOUS_SPIRITUAL: 'Religious / Spiritual',
  WELLNESS_YOGA: 'Wellness & Yoga',
  WORKATION_MONSOON: 'Workation / Monsoon',
  FAMILY_STAY: 'Family Stay',
  COUPLE_RETREAT: 'Couple Retreat',
  CUSTOM: 'Custom',
};

export const PACKAGE_CATEGORY_OPTIONS: PackageCategory[] = [
  'WEEKEND_ESCAPE',
  'ADVENTURE_TREKKING',
  'RELIGIOUS_SPIRITUAL',
  'WELLNESS_YOGA',
  'WORKATION_MONSOON',
  'FAMILY_STAY',
  'COUPLE_RETREAT',
  'CUSTOM',
];

export const PACKAGE_STATUS_LABEL: Record<PackageStatus, string> = {
  DRAFT: 'Draft',
  READY: 'Ready for review',
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  ARCHIVED: 'Archived',
};

export const PACKAGE_APPROVAL_LABEL: Record<PackageApprovalStatus, string> = {
  PENDING_REVIEW: 'Awaiting review',
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
};

export const PACKAGE_PRICING_BASIS_LABEL: Record<PackagePricingBasis, string> = {
  PER_ROOM_PER_NIGHT: 'per room per night',
  PER_PERSON_PER_NIGHT: 'per person per night',
  PER_PACKAGE: 'per package (total)',
};

export const PACKAGE_PRICING_BASIS_OPTIONS: PackagePricingBasis[] = [
  'PER_ROOM_PER_NIGHT',
  'PER_PERSON_PER_NIGHT',
  'PER_PACKAGE',
];

export const MONTH_LABEL: Record<number, string> = {
  1: 'Jan', 2: 'Feb', 3: 'Mar', 4: 'Apr', 5: 'May', 6: 'Jun',
  7: 'Jul', 8: 'Aug', 9: 'Sep', 10: 'Oct', 11: 'Nov', 12: 'Dec',
};

// ── Helpers ───────────────────────────────────────────────────────────────

/** Slugify a name into a URL-safe slug. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Format paise → rupee text. Returns null when no price set. */
export function paiseToRupeeText(paise: number | null): string | null {
  if (paise == null || !Number.isFinite(paise)) return null;
  const rupees = Math.round(paise / 100);
  return `₹${rupees.toLocaleString('en-IN')}`;
}

/**
 * Build a default starting_price_text from the numeric + basis pair.
 * Operator can override; this is just a sensible default suggestion.
 */
export function suggestStartingPriceText(
  paise: number | null,
  basis: PackagePricingBasis,
): string {
  const amount = paiseToRupeeText(paise);
  if (!amount) return '';
  return `Starting ${amount} ${PACKAGE_PRICING_BASIS_LABEL[basis]}`;
}

/** Render season_months as "Jan – Mar, Sep – Dec" style ranges. */
export function monthsToLabel(months: number[]): string {
  if (!months || months.length === 0) return 'Year-round';
  if (months.length === 12) return 'Year-round';
  const sorted = [...new Set(months.filter((m) => m >= 1 && m <= 12))].sort((a, b) => a - b);
  if (sorted.length === 0) return 'Year-round';

  // Group into contiguous ranges
  const ranges: Array<[number, number]> = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
    } else {
      ranges.push([start, prev]);
      start = sorted[i];
      prev = sorted[i];
    }
  }
  ranges.push([start, prev]);
  return ranges
    .map(([a, b]) => (a === b ? MONTH_LABEL[a] : `${MONTH_LABEL[a]}–${MONTH_LABEL[b]}`))
    .join(', ');
}

/** Returns true if the package is active in the calendar month of `when`. */
export function seasonMatches(months: number[], when: Date = new Date()): boolean {
  if (!months || months.length === 0 || months.length === 12) return true;
  return months.includes(when.getMonth() + 1);
}

/** Default Hinglish + English category description for the picker tooltip. */
export const CATEGORY_HINGLISH_HINT: Record<PackageCategory, string> = {
  WEEKEND_ESCAPE: 'Delhi-NCR / Chandigarh / Lucknow se aane wale short-stay guests.',
  ADVENTURE_TREKKING: 'Trekkers, river rafting, mountain biking — fit guests.',
  RELIGIOUS_SPIRITUAL: 'Char Dham yatra, temple tours, dharmik bhraman.',
  WELLNESS_YOGA: 'Yoga retreats, meditation, detox stays.',
  WORKATION_MONSOON: 'Remote workers, monsoon special long stays.',
  FAMILY_STAY: 'Families with kids, parents, sightseeing-friendly.',
  COUPLE_RETREAT: 'Honeymoon, anniversary, romantic getaways.',
  CUSTOM: 'Anything that doesn’t fit above — describe in pitch.',
};
