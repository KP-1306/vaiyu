// web/src/config/otaOptimizer.test.ts
//
// Parity tests for OTA Listing Optimizer. The TS-side OTA_CATALOG MUST
// match the SQL-side `_ota_catalog()` function rows or the UI will silently
// disagree with the view aggregation.
//
// This test reads the migration file as text, regex-extracts the VALUES rows
// from `_ota_catalog()`, and asserts byte-equality with OTA_CATALOG entries.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  OTA_BAND_THRESHOLDS,
  OTA_CATALOG,
  OTA_CATEGORY_ORDER,
  OTA_MOUNTAIN_STATES,
  OTA_PLATFORM_ORDER,
  applicableCatalogItems,
  bandForOtaScore,
  findOtaCatalogItem,
  freshnessForReviewedAt,
  isItemApplicable,
  isStateMountain,
  otaCatalogForCategory,
} from './otaOptimizer';
import type { OTAPlatform } from '../types/otaOptimizer';

const MIGRATION_PATH = resolve(
  __dirname,
  '../../../supabase/migrations/20260601000002_ota_listing_optimizer.sql',
);
const migrationSql = readFileSync(MIGRATION_PATH, 'utf8');

// Extract the VALUES rows from _ota_catalog() function body.
function extractSqlCatalogRows(): Array<{
  category: string;
  itemKey: string;
  weight: number;
  isMountainOnly: boolean;
  notApplicableOtas: string[];
  displayOrder: number;
}> {
  const fnStart = migrationSql.indexOf(
    'CREATE OR REPLACE FUNCTION public._ota_catalog()',
  );
  expect(fnStart).toBeGreaterThan(-1);
  const bodyOpenIdx = migrationSql.indexOf('AS $$', fnStart);
  expect(bodyOpenIdx).toBeGreaterThan(-1);
  const bodyCloseIdx = migrationSql.indexOf('$$;', bodyOpenIdx + 5);
  expect(bodyCloseIdx).toBeGreaterThan(-1);
  const body = migrationSql.slice(bodyOpenIdx, bodyCloseIdx);

  // Match VALUES rows. Format:
  //   ('CATEGORY'[::public.ota_readiness_category], 'item_key', N[::numeric],
  //    true|false, ARRAY[...], M)
  // Tolerates the optional ::numeric and ::public.ota_readiness_category casts.
  const rowRe =
    /\(\s*'([A-Z_]+)'(?:::[a-z._]+)?\s*,\s*'([a-z_]+)'\s*,\s*([0-9]+(?:\.[0-9]+)?)(?:::numeric)?\s*,\s*(true|false)\s*,\s*ARRAY\[([^\]]*)\]::public\.ota_platform\[\]\s*,\s*([0-9]+)\s*\)/g;
  const rows: Array<{
    category: string;
    itemKey: string;
    weight: number;
    isMountainOnly: boolean;
    notApplicableOtas: string[];
    displayOrder: number;
  }> = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(body)) !== null) {
    const naOtas = m[5]
      .split(',')
      .map((s) => s.trim().replace(/^'/, '').replace(/'$/, ''))
      .filter((s) => s.length > 0);
    rows.push({
      category: m[1],
      itemKey: m[2],
      weight: Number(m[3]),
      isMountainOnly: m[4] === 'true',
      notApplicableOtas: naOtas,
      displayOrder: parseInt(m[6], 10),
    });
  }
  return rows;
}

describe('OTA catalog SQL ↔ TS parity', () => {
  it('parses the SQL catalog rows', () => {
    const rows = extractSqlCatalogRows();
    expect(rows.length).toBe(52); // 4+7+3+3+5+3+3+4+3+4+13 = 52
  });

  it('every SQL row has a matching TS catalog entry', () => {
    const rows = extractSqlCatalogRows();
    for (const r of rows) {
      const ts = OTA_CATALOG.find(
        (c) => c.category === r.category && c.itemKey === r.itemKey,
      );
      expect(ts, `SQL row missing in TS: ${r.category}/${r.itemKey}`).toBeDefined();
      if (ts) {
        expect(ts.weight, `weight drift for ${r.itemKey}`).toBe(r.weight);
        expect(ts.isMountainOnly, `mountain drift for ${r.itemKey}`).toBe(r.isMountainOnly);
        expect(ts.displayOrder, `displayOrder drift for ${r.itemKey}`).toBe(r.displayOrder);
        expect(
          ts.notApplicableOtas.sort().join(','),
          `notApplicableOtas drift for ${r.itemKey}`,
        ).toBe(r.notApplicableOtas.sort().join(','));
      }
    }
  });

  it('every TS catalog entry has a matching SQL row', () => {
    const rows = extractSqlCatalogRows();
    for (const ts of OTA_CATALOG) {
      const sql = rows.find(
        (r) => r.category === ts.category && r.itemKey === ts.itemKey,
      );
      expect(sql, `TS row missing in SQL: ${ts.category}/${ts.itemKey}`).toBeDefined();
    }
  });
});

describe('OTA catalog weights', () => {
  it('non-mountain weights sum to exactly 100', () => {
    const sum = OTA_CATALOG
      .filter((c) => !c.isMountainOnly)
      .reduce((acc, c) => acc + c.weight, 0);
    expect(sum).toBe(100);
  });

  it('mountain weights sum to exactly 30', () => {
    const sum = OTA_CATALOG
      .filter((c) => c.isMountainOnly)
      .reduce((acc, c) => acc + c.weight, 0);
    expect(sum).toBe(30);
  });

  it('each category has at least 3 items', () => {
    for (const cat of OTA_CATEGORY_ORDER) {
      const items = OTA_CATALOG.filter((c) => c.category === cat);
      expect(items.length, `category ${cat} has fewer than 3 items`).toBeGreaterThanOrEqual(3);
    }
  });

  it('all weights are positive', () => {
    for (const item of OTA_CATALOG) {
      expect(item.weight, `weight non-positive for ${item.itemKey}`).toBeGreaterThan(0);
    }
  });

  it('display_order is strictly increasing within each category', () => {
    for (const cat of OTA_CATEGORY_ORDER) {
      const items = OTA_CATALOG.filter((c) => c.category === cat).sort(
        (a, b) => a.displayOrder - b.displayOrder,
      );
      for (let i = 1; i < items.length; i++) {
        expect(
          items[i].displayOrder,
          `display_order not strictly increasing in ${cat}`,
        ).toBeGreaterThan(items[i - 1].displayOrder);
      }
    }
  });
});

describe('OTA band thresholds', () => {
  it('thresholds are strictly decreasing', () => {
    expect(OTA_BAND_THRESHOLDS.PREMIUM).toBeGreaterThan(OTA_BAND_THRESHOLDS.MODERATE);
    expect(OTA_BAND_THRESHOLDS.MODERATE).toBeGreaterThan(OTA_BAND_THRESHOLDS.CRITICAL);
  });

  it('bandForOtaScore matches SQL view CASE branches', () => {
    expect(bandForOtaScore(95)).toBe('PREMIUM');
    expect(bandForOtaScore(80)).toBe('PREMIUM');
    expect(bandForOtaScore(79.9)).toBe('MODERATE');
    expect(bandForOtaScore(50)).toBe('MODERATE');
    expect(bandForOtaScore(49.9)).toBe('CRITICAL');
    expect(bandForOtaScore(0)).toBe('CRITICAL');
  });

  it('SQL view band CASE matches TS thresholds', () => {
    expect(migrationSql).toMatch(/100\.0\s*\*\s*SUM\(earned\)\s*\/\s*SUM\(possible\)\s*>=\s*80\s+THEN\s+'PREMIUM'/);
    expect(migrationSql).toMatch(/100\.0\s*\*\s*SUM\(earned\)\s*\/\s*SUM\(possible\)\s*>=\s*50\s+THEN\s+'MODERATE'/);
    expect(migrationSql).toMatch(/ELSE\s+'CRITICAL'::public\.ota_readiness_band/);
  });
});

describe('freshnessForReviewedAt', () => {
  const NOW = new Date('2026-06-01T12:00:00Z').getTime();

  it('returns "never" when timestamp is null/undefined', () => {
    expect(freshnessForReviewedAt(null, NOW)).toBe('never');
    expect(freshnessForReviewedAt(undefined, NOW)).toBe('never');
  });

  it('returns "fresh" for items reviewed within 90 days', () => {
    const yesterday = new Date(NOW - 24 * 3600 * 1000).toISOString();
    expect(freshnessForReviewedAt(yesterday, NOW)).toBe('fresh');
    const sixtyDaysAgo = new Date(NOW - 60 * 24 * 3600 * 1000).toISOString();
    expect(freshnessForReviewedAt(sixtyDaysAgo, NOW)).toBe('fresh');
    const eightyNineDaysAgo = new Date(NOW - 89 * 24 * 3600 * 1000).toISOString();
    expect(freshnessForReviewedAt(eightyNineDaysAgo, NOW)).toBe('fresh');
  });

  it('returns "stale" for items 90 to 120 days old', () => {
    const ninetyDaysAgo = new Date(NOW - 90 * 24 * 3600 * 1000).toISOString();
    expect(freshnessForReviewedAt(ninetyDaysAgo, NOW)).toBe('stale');
    const oneHundredDaysAgo = new Date(NOW - 100 * 24 * 3600 * 1000).toISOString();
    expect(freshnessForReviewedAt(oneHundredDaysAgo, NOW)).toBe('stale');
    const oneNineteenDaysAgo = new Date(NOW - 119 * 24 * 3600 * 1000).toISOString();
    expect(freshnessForReviewedAt(oneNineteenDaysAgo, NOW)).toBe('stale');
  });

  it('returns "expired" for items 120+ days old', () => {
    const oneTwentyDaysAgo = new Date(NOW - 120 * 24 * 3600 * 1000).toISOString();
    expect(freshnessForReviewedAt(oneTwentyDaysAgo, NOW)).toBe('expired');
    const oneYearAgo = new Date(NOW - 365 * 24 * 3600 * 1000).toISOString();
    expect(freshnessForReviewedAt(oneYearAgo, NOW)).toBe('expired');
  });
});

describe('isItemApplicable', () => {
  const titleQuality = findOtaCatalogItem('LISTING_QUALITY', 'title_quality')!;
  const namingConsistency = findOtaCatalogItem('ROOM_NAMING', 'naming_consistency')!;
  const paymentMethods = findOtaCatalogItem('PAYMENT_BOOKING_CLARITY', 'payment_methods')!;
  const parkingVisibility = findOtaCatalogItem('MOUNTAIN_DISCLOSURE', 'parking_visibility')!;

  it('catalog items resolve', () => {
    expect(titleQuality).toBeDefined();
    expect(namingConsistency).toBeDefined();
    expect(paymentMethods).toBeDefined();
    expect(parkingVisibility).toBeDefined();
  });

  it('title_quality applies to every OTA for any hotel', () => {
    for (const o of OTA_PLATFORM_ORDER) {
      expect(isItemApplicable(titleQuality, o, false)).toBe(true);
      expect(isItemApplicable(titleQuality, o, true)).toBe(true);
    }
  });

  it('naming_consistency excludes Airbnb', () => {
    expect(isItemApplicable(namingConsistency, 'MMT', false)).toBe(true);
    expect(isItemApplicable(namingConsistency, 'BOOKING_COM', false)).toBe(true);
    expect(isItemApplicable(namingConsistency, 'AIRBNB', false)).toBe(false);
  });

  it('payment_methods excludes TripAdvisor', () => {
    expect(isItemApplicable(paymentMethods, 'MMT', false)).toBe(true);
    expect(isItemApplicable(paymentMethods, 'TRIPADVISOR', false)).toBe(false);
  });

  it('mountain items hidden for non-mountain hotels', () => {
    for (const o of OTA_PLATFORM_ORDER) {
      expect(isItemApplicable(parkingVisibility, o, false)).toBe(false);
      expect(isItemApplicable(parkingVisibility, o, true)).toBe(true);
    }
  });
});

describe('applicableCatalogItems matrix sizes', () => {
  it('MMT non-mountain hotel sees 39 items (52 - 13 mountain)', () => {
    const items = applicableCatalogItems('MMT', false);
    expect(items.length).toBe(52 - 13);
  });

  it('MMT mountain hotel sees all 52 items', () => {
    const items = applicableCatalogItems('MMT', true);
    expect(items.length).toBe(52);
  });

  it('Airbnb non-mountain hotel sees 37 items (52 - 13 mountain - 2 NA)', () => {
    const items = applicableCatalogItems('AIRBNB', false);
    expect(items.length).toBe(52 - 13 - 2);
  });

  it('Airbnb mountain hotel sees 50 items (52 - 2 NA)', () => {
    const items = applicableCatalogItems('AIRBNB', true);
    expect(items.length).toBe(52 - 2);
  });

  it('TripAdvisor non-mountain hotel sees 36 items (52 - 13 mountain - 3 NA)', () => {
    const items = applicableCatalogItems('TRIPADVISOR', false);
    expect(items.length).toBe(52 - 13 - 3);
  });

  it('TripAdvisor mountain hotel sees 49 items (52 - 3 NA)', () => {
    const items = applicableCatalogItems('TRIPADVISOR', true);
    expect(items.length).toBe(52 - 3);
  });
});

describe('catalog helpers', () => {
  it('otaCatalogForCategory returns sorted items per category', () => {
    for (const cat of OTA_CATEGORY_ORDER) {
      const items = otaCatalogForCategory(cat);
      expect(items.length).toBeGreaterThan(0);
      for (let i = 1; i < items.length; i++) {
        expect(items[i].displayOrder).toBeGreaterThan(items[i - 1].displayOrder);
      }
    }
  });

  it('findOtaCatalogItem returns null for missing items', () => {
    expect(findOtaCatalogItem('LISTING_QUALITY', 'does_not_exist')).toBeNull();
  });
});

describe('mountain states', () => {
  it('TS mountain states match SQL _ota_mountain_states()', () => {
    // Parse the SQL function body
    const fnStart = migrationSql.indexOf(
      'CREATE OR REPLACE FUNCTION public._ota_mountain_states()',
    );
    expect(fnStart).toBeGreaterThan(-1);
    const bodyOpen = migrationSql.indexOf('AS $$', fnStart);
    const bodyClose = migrationSql.indexOf('$$;', bodyOpen + 5);
    const body = migrationSql.slice(bodyOpen, bodyClose);
    // Match the array literal
    const arrRe = /ARRAY\[([\s\S]*?)\]::text\[\]/;
    const m = body.match(arrRe);
    expect(m).not.toBeNull();
    const sqlStates = m![1]
      .split(',')
      .map((s) => s.trim().replace(/^'/, '').replace(/'$/, ''))
      .filter((s) => s.length > 0);
    expect(sqlStates.sort().join(',')).toBe([...OTA_MOUNTAIN_STATES].sort().join(','));
  });

  it('isStateMountain returns true for mountain states only', () => {
    expect(isStateMountain('Uttarakhand')).toBe(true);
    expect(isStateMountain('Himachal Pradesh')).toBe(true);
    expect(isStateMountain('Jammu and Kashmir')).toBe(true);
    expect(isStateMountain('Ladakh')).toBe(true);
    expect(isStateMountain('Sikkim')).toBe(true);
    expect(isStateMountain('Arunachal Pradesh')).toBe(true);
    expect(isStateMountain('Maharashtra')).toBe(false);
    expect(isStateMountain('Tamil Nadu')).toBe(false);
    expect(isStateMountain('Karnataka')).toBe(false);
    expect(isStateMountain(null)).toBe(false);
    expect(isStateMountain('')).toBe(false);
  });
});

describe('OTA platform list', () => {
  it('OTA_PLATFORM_ORDER has exactly 8 entries', () => {
    expect(OTA_PLATFORM_ORDER.length).toBe(8);
  });

  it('TS OTA list matches SQL ota_platform enum', () => {
    // Parse enum DO block
    const enumDef = migrationSql.match(/CREATE TYPE public\.ota_platform AS ENUM\s*\(([\s\S]*?)\)/);
    expect(enumDef).not.toBeNull();
    const enumValues = enumDef![1]
      .split(',')
      .map((s) => s.trim().replace(/^'/, '').replace(/'$/, ''))
      .filter((s) => s.length > 0);
    expect(enumValues.sort().join(',')).toBe([...OTA_PLATFORM_ORDER].sort().join(','));
  });
});

// Note: extractOtaErrorCode and friendlyOtaError are exercised by service tests.
