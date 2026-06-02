// web/src/components/seo/BlueprintForm.validation.ts
//
// Pure validation + form-draft shape for the SEO blueprint form. No React.
// Mirrors the SQL classifier exactly (server is still authoritative).

import {
  classifyBlueprint,
  SEO_PROOF_BY_CATEGORY,
} from '../../config/localSeoPlanner';
import type {
  SeoBlueprintCategory,
  SeoBlueprintRisk,
  SeoProofItem,
} from '../../types/seoBlueprint';

export interface SeoBlueprintFormDraft {
  pageTitleConcept: string;
  targetCategory: SeoBlueprintCategory;
  requiredProof: SeoProofItem[];
  whyItMatters: string;
  hinglishGuidance: string;
  safeNextAction: string;
  connectedModuleSuggestion: string;
  ownerNotes: string;
  internalNotes: string;
}

/** Optional hotel context used to specialise generic proof labels (e.g. inject the city name into GEOGRAPHIC_FOCUS hints). */
export interface ProofContext {
  city?: string | null;
}

export function emptyDraft(
  category: SeoBlueprintCategory = 'GEOGRAPHIC_FOCUS',
  ctx?: ProofContext,
): SeoBlueprintFormDraft {
  return {
    pageTitleConcept: '',
    targetCategory: category,
    requiredProof: defaultProofFor(category, ctx),
    whyItMatters: '',
    hinglishGuidance: '',
    safeNextAction: '',
    connectedModuleSuggestion: '',
    ownerNotes: '',
    internalNotes: '',
  };
}

/**
 * Deep clone of the category's default proof checklist so edits don't leak.
 * When the hotel's city is known, the first GEOGRAPHIC_FOCUS proof item is
 * specialised ("Property genuinely in/near Mukteshwar") instead of generic.
 */
export function defaultProofFor(
  category: SeoBlueprintCategory,
  ctx?: ProofContext,
): SeoProofItem[] {
  const items = SEO_PROOF_BY_CATEGORY[category].map((p) => ({ ...p }));
  const city = ctx?.city?.trim();
  if (category === 'GEOGRAPHIC_FOCUS' && city && items[0]?.key === 'real_location') {
    items[0] = {
      ...items[0],
      label_en: `Property genuinely in/near ${city}`,
      label_hi: `Property sach mein ${city} mein/paas hai`,
    };
  }
  return items;
}

/** Toggle a proof item's satisfied state, immutably. */
export function toggleProof(items: SeoProofItem[], key: string): SeoProofItem[] {
  return items.map((p) => (p.key === key ? { ...p, satisfied: !p.satisfied } : p));
}

export type SeoBlueprintErrorKey =
  | 'TITLE_REQUIRED'
  | 'TITLE_TOO_LONG'
  | 'CATEGORY_INVALID'
  | 'OVERRIDE_REASON_REQUIRED';

export interface ValidationResult {
  ok: boolean;
  errors: Partial<Record<SeoBlueprintErrorKey, true>>;
}

const TITLE_MAX = 160;

const VALID_CATEGORIES: ReadonlySet<SeoBlueprintCategory> = new Set([
  'GEOGRAPHIC_FOCUS',
  'TRAVELER_NICHE',
  'SEASONAL_POSITION',
  'TARGET_MARKET',
  'AMENITY_TRUST',
  'PACKAGE_LED',
]);

export interface ValidateOptions {
  /** When the owner is using an override, reason must be present. */
  riskOverride?: SeoBlueprintRisk | null;
  overrideReason?: string;
}

export function validate(draft: SeoBlueprintFormDraft, options: ValidateOptions = {}): ValidationResult {
  const errors: Partial<Record<SeoBlueprintErrorKey, true>> = {};
  const title = draft.pageTitleConcept.trim();
  if (!title) errors.TITLE_REQUIRED = true;
  if (title.length > TITLE_MAX) errors.TITLE_TOO_LONG = true;
  if (!VALID_CATEGORIES.has(draft.targetCategory)) errors.CATEGORY_INVALID = true;
  if (options.riskOverride && !(options.overrideReason ?? '').trim()) {
    errors.OVERRIDE_REASON_REQUIRED = true;
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

export function humanizeError(k: SeoBlueprintErrorKey): string {
  switch (k) {
    case 'TITLE_REQUIRED': return 'Page-title concept is required.';
    case 'TITLE_TOO_LONG': return 'Page-title concept must be ≤ 160 characters.';
    case 'CATEGORY_INVALID': return 'Pick a valid target category.';
    case 'OVERRIDE_REASON_REQUIRED': return 'When overriding the risk flag, a reason is required.';
  }
}

/** Convenience for in-form Policy-Shield feedback (no isDuplicate signal client-side). */
export function classifyDraft(draft: SeoBlueprintFormDraft, isDuplicate = false): SeoBlueprintRisk {
  return classifyBlueprint({
    title: draft.pageTitleConcept,
    category: draft.targetCategory,
    proof: draft.requiredProof,
    isDuplicate,
  });
}
