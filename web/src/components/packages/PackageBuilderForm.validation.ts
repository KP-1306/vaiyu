// web/src/components/packages/PackageBuilderForm.validation.ts
//
// Pure validation for the Package Builder form. Same pattern as
// LeadQuickAddModal.validation / LeadConvertModal.validation.

import type { PackageCategory, PackagePricingBasis } from '../../types/package';
import { slugify } from '../../config/packages';

export interface PackageFormDraft {
  name: string;
  slug: string;
  category: PackageCategory;
  targetGuestType: string;
  heroImageUrl: string;
  shortPitch: string;
  longDescription: string;
  durationNights: number;
  minPartyAdults: number;
  maxPartyAdults: number | null;
  roomTypeId: string | null;
  seasonMonths: number[];
  validFrom: string;
  validUntil: string;
  foodInclusions: string[];
  activityInclusions: string[];
  transferInclusions: string[];
  customInclusions: string[];
  basePriceRupees: number | null;
  basePriceBasis: PackagePricingBasis;
  startingPriceText: string;
  enquiryCtaLabel: string;
  internalNotes: string;
}

export type FieldError =
  | 'NAME_REQUIRED'
  | 'NAME_TOO_LONG'
  | 'SLUG_REQUIRED'
  | 'SLUG_INVALID_CHARS'
  | 'SLUG_TOO_LONG'
  | 'DURATION_OUT_OF_RANGE'
  | 'MIN_PARTY_INVALID'
  | 'MAX_PARTY_LESS_THAN_MIN'
  | 'STARTING_PRICE_TEXT_REQUIRED'
  | 'STARTING_PRICE_TEXT_TOO_LONG'
  | 'CTA_LABEL_REQUIRED'
  | 'CTA_LABEL_TOO_LONG'
  | 'SHORT_PITCH_TOO_LONG'
  | 'LONG_DESCRIPTION_TOO_LONG'
  | 'BASE_PRICE_NEGATIVE'
  | 'DATE_WINDOW_INVERTED'
  | 'SEASON_MONTH_INVALID';

export interface ValidationResult {
  ok: boolean;
  errors: Partial<Record<keyof PackageFormDraft, FieldError>>;
}

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,80}[a-z0-9]$/;

export function emptyDraft(): PackageFormDraft {
  return {
    name: '',
    slug: '',
    category: 'WEEKEND_ESCAPE',
    targetGuestType: '',
    heroImageUrl: '',
    shortPitch: '',
    longDescription: '',
    durationNights: 2,
    minPartyAdults: 2,
    maxPartyAdults: null,
    roomTypeId: null,
    seasonMonths: [],
    validFrom: '',
    validUntil: '',
    foodInclusions: [],
    activityInclusions: [],
    transferInclusions: [],
    customInclusions: [],
    basePriceRupees: null,
    basePriceBasis: 'PER_ROOM_PER_NIGHT',
    startingPriceText: '',
    enquiryCtaLabel: 'Enquire now',
    internalNotes: '',
  };
}

export function autoSlugFromName(name: string): string {
  return slugify(name);
}

export function validate(draft: PackageFormDraft): ValidationResult {
  const errors: Partial<Record<keyof PackageFormDraft, FieldError>> = {};

  if (!draft.name.trim()) errors.name = 'NAME_REQUIRED';
  else if (draft.name.length > 120) errors.name = 'NAME_TOO_LONG';

  if (!draft.slug.trim()) errors.slug = 'SLUG_REQUIRED';
  else if (draft.slug.length > 80) errors.slug = 'SLUG_TOO_LONG';
  else if (!SLUG_REGEX.test(draft.slug)) errors.slug = 'SLUG_INVALID_CHARS';

  if (!Number.isFinite(draft.durationNights) || draft.durationNights < 1 || draft.durationNights > 30) {
    errors.durationNights = 'DURATION_OUT_OF_RANGE';
  }

  if (!Number.isFinite(draft.minPartyAdults) || draft.minPartyAdults < 1) {
    errors.minPartyAdults = 'MIN_PARTY_INVALID';
  }
  if (
    draft.maxPartyAdults != null &&
    Number.isFinite(draft.maxPartyAdults) &&
    draft.maxPartyAdults < draft.minPartyAdults
  ) {
    errors.maxPartyAdults = 'MAX_PARTY_LESS_THAN_MIN';
  }

  if (!draft.startingPriceText.trim()) errors.startingPriceText = 'STARTING_PRICE_TEXT_REQUIRED';
  else if (draft.startingPriceText.length > 100) errors.startingPriceText = 'STARTING_PRICE_TEXT_TOO_LONG';

  if (!draft.enquiryCtaLabel.trim()) errors.enquiryCtaLabel = 'CTA_LABEL_REQUIRED';
  else if (draft.enquiryCtaLabel.length > 40) errors.enquiryCtaLabel = 'CTA_LABEL_TOO_LONG';

  if (draft.shortPitch.length > 280) errors.shortPitch = 'SHORT_PITCH_TOO_LONG';
  if (draft.longDescription.length > 8000) errors.longDescription = 'LONG_DESCRIPTION_TOO_LONG';

  if (draft.basePriceRupees != null && Number.isFinite(draft.basePriceRupees) && draft.basePriceRupees < 0) {
    errors.basePriceRupees = 'BASE_PRICE_NEGATIVE';
  }

  if (draft.validFrom && draft.validUntil && draft.validUntil < draft.validFrom) {
    errors.validUntil = 'DATE_WINDOW_INVERTED';
  }

  for (const m of draft.seasonMonths) {
    if (m < 1 || m > 12) {
      errors.seasonMonths = 'SEASON_MONTH_INVALID';
      break;
    }
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

/** Map a FieldError code to a human message. */
export function humanizeError(code: FieldError): string {
  switch (code) {
    case 'NAME_REQUIRED': return 'Package name is required.';
    case 'NAME_TOO_LONG': return 'Name is too long (max 120 characters).';
    case 'SLUG_REQUIRED': return 'URL slug is required.';
    case 'SLUG_INVALID_CHARS': return 'Slug can use only lowercase letters, digits and dashes.';
    case 'SLUG_TOO_LONG': return 'Slug is too long (max 80 characters).';
    case 'DURATION_OUT_OF_RANGE': return 'Duration must be between 1 and 30 nights.';
    case 'MIN_PARTY_INVALID': return 'Minimum party must be at least 1.';
    case 'MAX_PARTY_LESS_THAN_MIN': return 'Maximum party must be at least the minimum.';
    case 'STARTING_PRICE_TEXT_REQUIRED': return 'Starting-price text is required (e.g. "Starting ₹8,500 per couple per night").';
    case 'STARTING_PRICE_TEXT_TOO_LONG': return 'Starting-price text is too long (max 100 characters).';
    case 'CTA_LABEL_REQUIRED': return 'CTA label is required.';
    case 'CTA_LABEL_TOO_LONG': return 'CTA label is too long (max 40 characters).';
    case 'SHORT_PITCH_TOO_LONG': return 'Short pitch is too long (max 280 characters).';
    case 'LONG_DESCRIPTION_TOO_LONG': return 'Long description is too long (max 8000 characters).';
    case 'BASE_PRICE_NEGATIVE': return 'Base price cannot be negative.';
    case 'DATE_WINDOW_INVERTED': return 'Valid-until must be on or after valid-from.';
    case 'SEASON_MONTH_INVALID': return 'Season month must be between 1 and 12.';
  }
}
