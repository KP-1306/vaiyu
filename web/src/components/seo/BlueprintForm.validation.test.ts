// web/src/components/seo/BlueprintForm.validation.test.ts
//
// Pure tests for the Policy-Shield classifier + form validation. The
// classifier here MUST match public._classify_seo_blueprint() in the
// migration byte-for-byte in behaviour — any drift is a bug.

import { describe, expect, it } from 'vitest';
import {
  classifyDraft,
  defaultProofFor,
  emptyDraft,
  humanizeError,
  toggleProof,
  validate,
} from './BlueprintForm.validation';
import { classifyBlueprint } from '../../config/localSeoPlanner';
import type { SeoBlueprintCategory, SeoProofItem } from '../../types/seoBlueprint';

const ALL_PROOF = (items: SeoProofItem[]) => items.map((p) => ({ ...p, satisfied: true }));

describe('Policy Shield — classifyBlueprint (mirrors SQL _classify_seo_blueprint)', () => {
  it('duplicate beats every other signal', () => {
    expect(
      classifyBlueprint({
        title: 'Family stay in Mukteshwar',
        category: 'GEOGRAPHIC_FOCUS',
        proof: ALL_PROOF(defaultProofFor('GEOGRAPHIC_FOCUS')),
        isDuplicate: true,
      }),
    ).toBe('DUPLICATE_LOW_VALUE');
  });

  it('superlative title → RISKY_DOORWAY even with full proof', () => {
    for (const word of [
      'Best stay in Mukteshwar',
      'Cheapest hotel in Rishikesh',
      'Top resort near Char Dham',
      'Number one homestay',
      'No. 1 family hotel',
      '#1 family hotel',
      'Lowest price stay',
      'Guaranteed lowest rate',
      '5 star experience',
      'Five star deluxe stay',
      'World class wellness retreat',
    ]) {
      expect(
        classifyBlueprint({
          title: word,
          category: 'TRAVELER_NICHE',
          proof: ALL_PROOF(defaultProofFor('TRAVELER_NICHE')),
          isDuplicate: false,
        }),
      ).toBe('RISKY_DOORWAY');
    }
  });

  it('GEOGRAPHIC_FOCUS with no proof → NEEDS_PROOF', () => {
    expect(
      classifyBlueprint({
        title: 'Family stay in Mukteshwar',
        category: 'GEOGRAPHIC_FOCUS',
        proof: defaultProofFor('GEOGRAPHIC_FOCUS'), // none satisfied
        isDuplicate: false,
      }),
    ).toBe('NEEDS_PROOF');
  });

  it('GEOGRAPHIC_FOCUS with empty proof array → NEEDS_PROOF (never accidentally SAFE)', () => {
    expect(
      classifyBlueprint({
        title: 'Family stay in Mukteshwar',
        category: 'GEOGRAPHIC_FOCUS',
        proof: [],
        isDuplicate: false,
      }),
    ).toBe('NEEDS_PROOF');
  });

  it('GEOGRAPHIC_FOCUS with all proof satisfied → SAFE_BLUEPRINT', () => {
    expect(
      classifyBlueprint({
        title: 'Family stay in Mukteshwar',
        category: 'GEOGRAPHIC_FOCUS',
        proof: ALL_PROOF(defaultProofFor('GEOGRAPHIC_FOCUS')),
        isDuplicate: false,
      }),
    ).toBe('SAFE_BLUEPRINT');
  });

  it('AMENITY_TRUST + TARGET_MARKET are needs-proof categories too', () => {
    for (const cat of ['AMENITY_TRUST', 'TARGET_MARKET'] as const) {
      expect(
        classifyBlueprint({
          title: 'Parking-friendly stay',
          category: cat,
          proof: defaultProofFor(cat),
          isDuplicate: false,
        }),
      ).toBe('NEEDS_PROOF');
    }
  });

  it('SEASONAL_POSITION / TRAVELER_NICHE / PACKAGE_LED with no proof items → SAFE_BLUEPRINT', () => {
    for (const cat of ['SEASONAL_POSITION', 'TRAVELER_NICHE', 'PACKAGE_LED'] as const) {
      expect(
        classifyBlueprint({
          title: 'Monsoon retreat in Uttarakhand',
          category: cat,
          proof: [],
          isDuplicate: false,
        }),
      ).toBe('SAFE_BLUEPRINT');
    }
  });

  it('partial proof (one unsatisfied) → NEEDS_PROOF regardless of category', () => {
    expect(
      classifyBlueprint({
        title: 'Monsoon retreat in Uttarakhand',
        category: 'SEASONAL_POSITION',
        proof: [
          { key: 'a', label_en: 'A', label_hi: 'A', satisfied: true },
          { key: 'b', label_en: 'B', label_hi: 'B', satisfied: false },
        ],
        isDuplicate: false,
      }),
    ).toBe('NEEDS_PROOF');
  });

  it('superlative matching is word-boundary safe (no false positives inside other words)', () => {
    expect(
      classifyBlueprint({
        title: 'Bestowed family stay', // "best" inside "bestowed" should not trigger
        category: 'TRAVELER_NICHE',
        proof: [],
        isDuplicate: false,
      }),
    ).toBe('SAFE_BLUEPRINT');
  });

  it('classifier is case-insensitive on superlatives', () => {
    expect(
      classifyBlueprint({
        title: 'CHEAPEST hotel ever',
        category: 'TRAVELER_NICHE',
        proof: [],
        isDuplicate: false,
      }),
    ).toBe('RISKY_DOORWAY');
  });
});

describe('emptyDraft + defaultProofFor', () => {
  it('emptyDraft seeds proof items for the chosen category', () => {
    const d = emptyDraft('GEOGRAPHIC_FOCUS');
    expect(d.targetCategory).toBe('GEOGRAPHIC_FOCUS');
    expect(d.requiredProof.length).toBeGreaterThan(0);
    expect(d.requiredProof.every((p) => p.satisfied === false)).toBe(true);
  });

  it('defaultProofFor returns a fresh clone each call', () => {
    const a = defaultProofFor('AMENITY_TRUST');
    const b = defaultProofFor('AMENITY_TRUST');
    a[0].satisfied = true;
    expect(b[0].satisfied).toBe(false);
  });

  it('every category has at least one proof item', () => {
    const cats: SeoBlueprintCategory[] = [
      'GEOGRAPHIC_FOCUS', 'TRAVELER_NICHE', 'SEASONAL_POSITION',
      'TARGET_MARKET', 'AMENITY_TRUST', 'PACKAGE_LED',
    ];
    for (const c of cats) expect(defaultProofFor(c).length).toBeGreaterThan(0);
  });
});

describe('toggleProof', () => {
  it('flips only the matching key, immutably', () => {
    const items: SeoProofItem[] = [
      { key: 'a', label_en: 'A', label_hi: 'A', satisfied: false },
      { key: 'b', label_en: 'B', label_hi: 'B', satisfied: false },
    ];
    const next = toggleProof(items, 'a');
    expect(items[0].satisfied).toBe(false); // original untouched
    expect(next[0].satisfied).toBe(true);
    expect(next[1].satisfied).toBe(false);
  });
});

describe('validate', () => {
  it('rejects empty title', () => {
    const d = emptyDraft();
    expect(validate(d).ok).toBe(false);
    expect(validate(d).errors.TITLE_REQUIRED).toBe(true);
  });

  it('rejects over-long title', () => {
    const d = emptyDraft();
    d.pageTitleConcept = 'x'.repeat(161);
    expect(validate(d).errors.TITLE_TOO_LONG).toBe(true);
  });

  it('requires reason when an override is provided', () => {
    const d = emptyDraft();
    d.pageTitleConcept = 'Family stay in Mukteshwar';
    expect(
      validate(d, { riskOverride: 'FAKE_LOCAL_CLAIM', overrideReason: '' }).errors.OVERRIDE_REASON_REQUIRED,
    ).toBe(true);
    expect(
      validate(d, { riskOverride: 'FAKE_LOCAL_CLAIM', overrideReason: 'verified false claim' }).ok,
    ).toBe(true);
  });

  it('passes for a well-formed draft with no override', () => {
    const d = emptyDraft();
    d.pageTitleConcept = 'Family stay in Mukteshwar';
    expect(validate(d).ok).toBe(true);
  });
});

describe('classifyDraft (form-side helper)', () => {
  it('passes the draft through to classifyBlueprint', () => {
    const d = emptyDraft('GEOGRAPHIC_FOCUS');
    d.pageTitleConcept = 'Family stay in Mukteshwar';
    expect(classifyDraft(d, false)).toBe('NEEDS_PROOF');
    d.requiredProof = ALL_PROOF(d.requiredProof);
    expect(classifyDraft(d, false)).toBe('SAFE_BLUEPRINT');
    expect(classifyDraft(d, true)).toBe('DUPLICATE_LOW_VALUE');
  });
});

describe('humanizeError', () => {
  it('renders each key to a non-empty string', () => {
    for (const k of ['TITLE_REQUIRED', 'TITLE_TOO_LONG', 'CATEGORY_INVALID', 'OVERRIDE_REASON_REQUIRED'] as const) {
      expect(humanizeError(k).length).toBeGreaterThan(0);
    }
  });
});
