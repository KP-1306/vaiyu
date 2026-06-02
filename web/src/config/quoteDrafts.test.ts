// web/src/config/quoteDrafts.test.ts
//
// Unit tests for the deterministic quote-draft template + helpers.

import { describe, expect, it } from 'vitest';
import {
  AI_QUOTE_DRAFTS_V0_ENABLED,
  MOCK_PACKAGES,
  QUOTE_DISCLAIMER,
  buildQuoteDraft,
  computeNights,
  emptyForm,
  emptyVerified,
  findPackage,
  formatDateForDraft,
  isApprovalReady,
} from './quoteDrafts';
import type { QuoteLeadSnapshot, QuoteVerifiedInputs } from '../types/quoteDraft';

function mkLead(overrides: Partial<QuoteLeadSnapshot> = {}): QuoteLeadSnapshot {
  return {
    id: 'lead-uuid-1',
    name: 'Sample Guest',
    partyAdults: 2,
    partyChildren: 0,
    roomCount: 1,
    checkIn: '2026-06-10',
    checkOut: '2026-06-12',
    source: 'WEBSITE',
    notePreview: null,
    ...overrides,
  };
}

function mkVerified(overrides: Partial<QuoteVerifiedInputs> = {}): QuoteVerifiedInputs {
  return {
    ...emptyVerified(),
    roomTypeId: 'rt-1',
    roomTypeName: 'Deluxe Room',
    manualPriceText: '₹8,500 per room per night (inclusive)',
    nights: 2,
    selectedInclusions: [],
    ownerNotes: '',
    availabilityConfirmed: true,
    termsConfirmed: true,
    ...overrides,
  };
}

describe('feature flag + invariants', () => {
  it('flag is on for v0', () => {
    expect(AI_QUOTE_DRAFTS_V0_ENABLED).toBe(true);
  });

  it('exports a non-empty disclaimer that is referenced verbatim by the brief', () => {
    expect(QUOTE_DISCLAIMER).toMatch(/manually confirmed by the property team/i);
  });

  it('ships at least 3 mock packages with required fields', () => {
    expect(MOCK_PACKAGES.length).toBeGreaterThanOrEqual(3);
    for (const p of MOCK_PACKAGES) {
      expect(p.code).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.durationNights).toBeGreaterThan(0);
      expect(p.startingPriceText).toBeTruthy();
      expect(Array.isArray(p.inclusions)).toBe(true);
    }
  });
});

describe('findPackage', () => {
  it('returns null for null code', () => {
    expect(findPackage(null)).toBeNull();
  });
  it('returns null for unknown code', () => {
    expect(findPackage('does-not-exist')).toBeNull();
  });
  it('returns the package by code', () => {
    expect(findPackage('honeymoon-3n')?.name).toMatch(/honeymoon/i);
  });
});

describe('computeNights', () => {
  it('returns 0 when either date is missing', () => {
    expect(computeNights(null, '2026-06-12')).toBe(0);
    expect(computeNights('2026-06-10', null)).toBe(0);
    expect(computeNights(null, null)).toBe(0);
  });

  it('returns 0 when checkOut is not strictly after checkIn', () => {
    expect(computeNights('2026-06-10', '2026-06-10')).toBe(0);
    expect(computeNights('2026-06-12', '2026-06-10')).toBe(0);
  });

  it('returns the day difference for valid ranges', () => {
    expect(computeNights('2026-06-10', '2026-06-12')).toBe(2);
    expect(computeNights('2026-06-10', '2026-06-17')).toBe(7);
  });
});

describe('formatDateForDraft', () => {
  it('returns an em-dash placeholder for null', () => {
    expect(formatDateForDraft(null)).toBe('—');
  });

  it('formats valid YYYY-MM-DD as friendly en-IN format', () => {
    const out = formatDateForDraft('2026-06-10');
    // Don't pin exact locale string but ensure pieces are present.
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/Jun/);
    expect(out).toMatch(/10/);
  });

  it('returns the raw string when unparseable', () => {
    expect(formatDateForDraft('not-a-date')).toBe('not-a-date');
  });
});

describe('isApprovalReady', () => {
  it('returns false when either checkbox is unticked', () => {
    expect(isApprovalReady(mkVerified({ availabilityConfirmed: false }))).toBe(false);
    expect(isApprovalReady(mkVerified({ termsConfirmed: false }))).toBe(false);
  });

  it('returns true only when BOTH checkboxes are ticked', () => {
    expect(
      isApprovalReady(mkVerified({ availabilityConfirmed: true, termsConfirmed: true })),
    ).toBe(true);
  });
});

describe('emptyForm', () => {
  it('starts with no lead, no package, empty draft, both checkboxes unticked', () => {
    const f = emptyForm();
    expect(f.lead).toBeNull();
    expect(f.packageCode).toBeNull();
    expect(f.draftText).toBe('');
    expect(f.draftDirty).toBe(false);
    expect(f.verified.availabilityConfirmed).toBe(false);
    expect(f.verified.termsConfirmed).toBe(false);
  });
});

describe('buildQuoteDraft — deterministic template', () => {
  it('always ends with the verbatim disclaimer line', () => {
    const draft = buildQuoteDraft({
      lead: mkLead(),
      package: findPackage('honeymoon-3n'),
      verified: mkVerified(),
    });
    expect(draft.trim().endsWith(QUOTE_DISCLAIMER)).toBe(true);
  });

  it('greets by guest name when a lead is selected', () => {
    const draft = buildQuoteDraft({
      lead: mkLead({ name: 'Mrs Sharma' }),
      package: null,
      verified: mkVerified(),
    });
    expect(draft).toMatch(/^Dear Mrs Sharma,/);
  });

  it('falls back to "Dear guest," when no lead is selected', () => {
    const draft = buildQuoteDraft({
      lead: null,
      package: null,
      verified: mkVerified(),
    });
    expect(draft).toMatch(/^Dear guest,/);
  });

  it('renders the operator-typed price line verbatim', () => {
    const draft = buildQuoteDraft({
      lead: mkLead(),
      package: null,
      verified: mkVerified({ manualPriceText: '₹12,000 / night all-inclusive' }),
    });
    expect(draft).toContain('₹12,000 / night all-inclusive');
  });

  it('shows "To be confirmed" placeholder when manual price is blank', () => {
    const draft = buildQuoteDraft({
      lead: mkLead(),
      package: null,
      verified: mkVerified({ manualPriceText: '   ' }),
    });
    expect(draft).toMatch(/To be confirmed by our team\./);
  });

  it('includes nights count when computable', () => {
    const draft = buildQuoteDraft({
      lead: mkLead({ checkIn: '2026-06-10', checkOut: '2026-06-13' }),
      package: null,
      verified: mkVerified({ nights: 3 }),
    });
    expect(draft).toMatch(/3 nights/);
  });

  it('includes the package name + inclusions when a package is selected', () => {
    const pkg = findPackage('family-4n')!;
    const draft = buildQuoteDraft({
      lead: mkLead(),
      package: pkg,
      verified: mkVerified(),
    });
    expect(draft).toContain(pkg.name);
    for (const inc of pkg.inclusions) {
      expect(draft).toContain(inc);
    }
  });

  it('honours selectedInclusions subset when provided', () => {
    const pkg = findPackage('family-4n')!;
    const subset = [pkg.inclusions[0]]; // only the first
    const draft = buildQuoteDraft({
      lead: mkLead(),
      package: pkg,
      verified: mkVerified({ selectedInclusions: subset }),
    });
    expect(draft).toContain(subset[0]);
    // dropped inclusions should NOT appear under the inclusion bullet
    const dropped = pkg.inclusions.slice(1);
    for (const dr of dropped) {
      // it might still appear if it overlaps with policy/notes; package_4n
      // has distinct inclusion items so safe to assert.
      expect(draft.includes(`– ${dr}`)).toBe(false);
    }
  });

  it('is a pure function — same inputs always produce same output', () => {
    const args = {
      lead: mkLead(),
      package: findPackage('honeymoon-3n'),
      verified: mkVerified(),
    } as const;
    expect(buildQuoteDraft(args)).toEqual(buildQuoteDraft(args));
  });

  it('never contains the literal "TODO" or "FIXME" string', () => {
    const draft = buildQuoteDraft({
      lead: mkLead(),
      package: findPackage('business-2n'),
      verified: mkVerified(),
    });
    expect(draft).not.toMatch(/TODO|FIXME/);
  });

  it('does not leak the future-AI governance line into the customer-facing draft body', () => {
    // The Hinglish governance line is for staff UI only — must NOT end up in the
    // text the operator might paste to a guest.
    const draft = buildQuoteDraft({
      lead: mkLead(),
      package: findPackage('business-2n'),
      verified: mkVerified(),
    });
    expect(draft).not.toMatch(/AI draft future mein/);
  });
});
