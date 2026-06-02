// web/src/services/quotePackageAdapter.ts
//
// Bridge between the Experience Package Builder real packages and the
// AI Quote Drafts picker. Quote Drafts pre-dates Packages and was wired to
// in-memory `MOCK_PACKAGES`; this adapter lets the picker show real packages
// for hotels that have published them, while preserving mock fallback when
// the hotel has no active packages yet.
//
// Codes follow a stable convention:
//   - mock packages keep their existing codes (e.g. "honeymoon-3n")
//   - real packages use `pkg:<uuid>` so they never collide with mock codes

import type { Package } from '../types/package';
import type { QuotePackage } from '../types/quoteDraft';
import { paiseToRupeeText, PACKAGE_PRICING_BASIS_LABEL } from '../config/packages';
import { MOCK_PACKAGES } from '../config/quoteDrafts';

const REAL_PACKAGE_PREFIX = 'pkg:';

export function realPackageCode(packageId: string): string {
  return `${REAL_PACKAGE_PREFIX}${packageId}`;
}

export function isRealPackageCode(code: string | null): boolean {
  return !!code && code.startsWith(REAL_PACKAGE_PREFIX);
}

export function extractRealPackageId(code: string | null): string | null {
  if (!code || !isRealPackageCode(code)) return null;
  return code.slice(REAL_PACKAGE_PREFIX.length);
}

/**
 * Convert a real Package row into the QuotePackage shape used by the picker
 * and the draft template. The package's text price wins for display; if the
 * operator has a numeric price set, append it as a fallback line.
 */
export function packageToQuotePackage(pkg: Package): QuotePackage {
  const inclusions: string[] = [
    ...pkg.food_inclusions,
    ...pkg.activity_inclusions,
    ...pkg.transfer_inclusions,
    ...pkg.custom_inclusions,
  ];

  const numericFallback = paiseToRupeeText(pkg.base_price_paise);
  const startingPriceText =
    pkg.starting_price_text ||
    (numericFallback
      ? `${numericFallback} ${PACKAGE_PRICING_BASIS_LABEL[pkg.base_price_basis]}`
      : '—');

  const policyParts: string[] = [];
  if (pkg.target_guest_type) policyParts.push(`Ideal for: ${pkg.target_guest_type}`);
  if (pkg.short_pitch) policyParts.push(pkg.short_pitch);

  return {
    code: realPackageCode(pkg.id),
    name: pkg.name,
    durationNights: pkg.duration_nights,
    inclusions,
    startingPriceText,
    policyNotes: policyParts.join(' · '),
  };
}

/**
 * Build the merged picker list. Real, hotel-specific packages appear first;
 * mock templates are appended as fallback only when no real packages exist
 * (otherwise the picker would be cluttered with generic stand-ins).
 */
export function mergeQuotePackages(realPackages: Package[]): QuotePackage[] {
  const real = realPackages.map(packageToQuotePackage);
  if (real.length === 0) return [...MOCK_PACKAGES];
  return real;
}

/** Resolve any package code (real or mock) to its QuotePackage. */
export function resolveQuotePackage(
  code: string | null,
  realPackages: Package[],
): QuotePackage | null {
  if (!code) return null;
  if (isRealPackageCode(code)) {
    const id = extractRealPackageId(code);
    if (!id) return null;
    const pkg = realPackages.find((p) => p.id === id);
    return pkg ? packageToQuotePackage(pkg) : null;
  }
  return MOCK_PACKAGES.find((p) => p.code === code) ?? null;
}
