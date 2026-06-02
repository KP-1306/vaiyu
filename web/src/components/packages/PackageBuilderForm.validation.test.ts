// web/src/components/packages/PackageBuilderForm.validation.test.ts

import { describe, expect, it } from 'vitest';
import {
  autoSlugFromName,
  emptyDraft,
  validate,
  type PackageFormDraft,
} from './PackageBuilderForm.validation';

function mk(over: Partial<PackageFormDraft> = {}): PackageFormDraft {
  return {
    ...emptyDraft(),
    name: 'Char Dham Yatra 4N',
    slug: 'char-dham-yatra-4n',
    durationNights: 4,
    startingPriceText: 'Starting ₹12,500 per person',
    enquiryCtaLabel: 'Plan my yatra',
    ...over,
  };
}

describe('autoSlugFromName', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(autoSlugFromName('Char Dham Yatra 4N')).toBe('char-dham-yatra-4n');
  });

  it('strips punctuation', () => {
    expect(autoSlugFromName("Mom & Dad's Special!")).toBe('mom-dad-s-special');
  });

  it('trims leading/trailing dashes', () => {
    expect(autoSlugFromName('  ---weekend---  ')).toBe('weekend');
  });

  it('truncates to 80 chars', () => {
    const long = 'a'.repeat(120);
    expect(autoSlugFromName(long).length).toBe(80);
  });
});

describe('validate — happy path', () => {
  it('passes on a complete valid draft', () => {
    const r = validate(mk());
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual({});
  });
});

describe('validate — required fields', () => {
  it('flags missing name', () => {
    const r = validate(mk({ name: '   ' }));
    expect(r.ok).toBe(false);
    expect(r.errors.name).toBe('NAME_REQUIRED');
  });

  it('flags missing slug', () => {
    expect(validate(mk({ slug: '' })).errors.slug).toBe('SLUG_REQUIRED');
  });

  it('flags missing starting_price_text', () => {
    expect(validate(mk({ startingPriceText: '' })).errors.startingPriceText)
      .toBe('STARTING_PRICE_TEXT_REQUIRED');
  });

  it('flags missing CTA label', () => {
    expect(validate(mk({ enquiryCtaLabel: '   ' })).errors.enquiryCtaLabel)
      .toBe('CTA_LABEL_REQUIRED');
  });
});

describe('validate — slug format', () => {
  it('rejects uppercase', () => {
    expect(validate(mk({ slug: 'Char-Dham' })).errors.slug).toBe('SLUG_INVALID_CHARS');
  });

  it('rejects leading dash', () => {
    expect(validate(mk({ slug: '-foo' })).errors.slug).toBe('SLUG_INVALID_CHARS');
  });

  it('rejects trailing dash', () => {
    expect(validate(mk({ slug: 'foo-' })).errors.slug).toBe('SLUG_INVALID_CHARS');
  });

  it('rejects spaces', () => {
    expect(validate(mk({ slug: 'char dham' })).errors.slug).toBe('SLUG_INVALID_CHARS');
  });

  it('accepts a-z, 0-9, and dashes', () => {
    expect(validate(mk({ slug: 'char-dham-2n-2026' })).errors.slug).toBeUndefined();
  });
});

describe('validate — duration', () => {
  it('rejects 0', () => {
    expect(validate(mk({ durationNights: 0 })).errors.durationNights).toBe('DURATION_OUT_OF_RANGE');
  });
  it('rejects > 30', () => {
    expect(validate(mk({ durationNights: 31 })).errors.durationNights).toBe('DURATION_OUT_OF_RANGE');
  });
  it('rejects NaN', () => {
    expect(validate(mk({ durationNights: NaN })).errors.durationNights).toBe('DURATION_OUT_OF_RANGE');
  });
});

describe('validate — party size', () => {
  it('rejects min < 1', () => {
    expect(validate(mk({ minPartyAdults: 0 })).errors.minPartyAdults).toBe('MIN_PARTY_INVALID');
  });
  it('rejects max < min', () => {
    expect(validate(mk({ minPartyAdults: 4, maxPartyAdults: 2 })).errors.maxPartyAdults)
      .toBe('MAX_PARTY_LESS_THAN_MIN');
  });
  it('accepts max == min', () => {
    expect(validate(mk({ minPartyAdults: 2, maxPartyAdults: 2 })).errors.maxPartyAdults).toBeUndefined();
  });
  it('accepts null max', () => {
    expect(validate(mk({ maxPartyAdults: null })).errors.maxPartyAdults).toBeUndefined();
  });
});

describe('validate — date window', () => {
  it('accepts equal dates', () => {
    expect(validate(mk({ validFrom: '2026-06-01', validUntil: '2026-06-01' })).errors.validUntil).toBeUndefined();
  });
  it('rejects inverted window', () => {
    expect(validate(mk({ validFrom: '2026-06-30', validUntil: '2026-06-01' })).errors.validUntil)
      .toBe('DATE_WINDOW_INVERTED');
  });
  it('accepts open-ended (only from)', () => {
    expect(validate(mk({ validFrom: '2026-06-01', validUntil: '' })).errors.validUntil).toBeUndefined();
  });
});

describe('validate — season months', () => {
  it('rejects 0', () => {
    expect(validate(mk({ seasonMonths: [3, 0, 5] })).errors.seasonMonths).toBe('SEASON_MONTH_INVALID');
  });
  it('rejects 13', () => {
    expect(validate(mk({ seasonMonths: [13] })).errors.seasonMonths).toBe('SEASON_MONTH_INVALID');
  });
  it('accepts empty (year-round)', () => {
    expect(validate(mk({ seasonMonths: [] })).errors.seasonMonths).toBeUndefined();
  });
  it('accepts 1..12', () => {
    expect(validate(mk({ seasonMonths: [1,2,3,4,5,6,7,8,9,10,11,12] })).errors.seasonMonths).toBeUndefined();
  });
});

describe('validate — length caps', () => {
  it('flags short_pitch > 280', () => {
    expect(validate(mk({ shortPitch: 'x'.repeat(281) })).errors.shortPitch).toBe('SHORT_PITCH_TOO_LONG');
  });
  it('flags long_description > 8000', () => {
    expect(validate(mk({ longDescription: 'x'.repeat(8001) })).errors.longDescription)
      .toBe('LONG_DESCRIPTION_TOO_LONG');
  });
  it('flags CTA label > 40', () => {
    expect(validate(mk({ enquiryCtaLabel: 'x'.repeat(41) })).errors.enquiryCtaLabel).toBe('CTA_LABEL_TOO_LONG');
  });
  it('flags starting_price_text > 100', () => {
    expect(validate(mk({ startingPriceText: 'x'.repeat(101) })).errors.startingPriceText).toBe('STARTING_PRICE_TEXT_TOO_LONG');
  });
});

describe('validate — base price', () => {
  it('accepts null', () => {
    expect(validate(mk({ basePriceRupees: null })).errors.basePriceRupees).toBeUndefined();
  });
  it('accepts 0', () => {
    expect(validate(mk({ basePriceRupees: 0 })).errors.basePriceRupees).toBeUndefined();
  });
  it('rejects negative', () => {
    expect(validate(mk({ basePriceRupees: -100 })).errors.basePriceRupees).toBe('BASE_PRICE_NEGATIVE');
  });
});
