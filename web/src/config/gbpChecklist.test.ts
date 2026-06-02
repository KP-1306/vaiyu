// web/src/config/gbpChecklist.test.ts
//
// Parity tests for Google Business Checklist. The TS-side GBP_CATALOG MUST
// match the SQL-side `_gbp_catalog()` function rows or the UI will silently
// disagree with the view aggregation.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  GBP_CATALOG,
  GBP_CATEGORY_ORDER,
  GBP_READY_THRESHOLD_PCT,
  findGBPCatalogItem,
  gbpCatalogForCategory,
  meetsGBPReadyThreshold,
} from './gbpChecklist';

const MIGRATION_PATH = resolve(
  __dirname,
  '../../../supabase/migrations/20260602000001_google_business_checklist.sql',
);
const migrationSql = readFileSync(MIGRATION_PATH, 'utf8');

// Extract VALUES rows from _gbp_catalog().
//   (item_key, category[::public.gbp_category]?, kind[::public.gbp_item_kind]?,
//    linked_signal | NULL, display_order)
function extractSqlCatalogRows(): Array<{
  itemKey: string;
  category: string;
  kind: string;
  linkedVisibilitySignalKey: string | null;
  displayOrder: number;
}> {
  const fnStart = migrationSql.indexOf('CREATE OR REPLACE FUNCTION public._gbp_catalog()');
  expect(fnStart).toBeGreaterThan(-1);
  const bodyOpen = migrationSql.indexOf('AS $$', fnStart);
  const bodyClose = migrationSql.indexOf('$$;', bodyOpen + 5);
  const body = migrationSql.slice(bodyOpen, bodyClose);

  // Pattern: ('item_key', 'CATEGORY'[::cast], 'KIND'[::cast], 'linked'|NULL, N)
  const rowRe =
    /\(\s*'([a-z_]+)'\s*,\s*'([A-Z_]+)'(?:::[a-z._]+)?\s*,\s*'([A-Z_]+)'(?:::[a-z._]+)?\s*,\s*(?:'([a-z_]+)'|NULL)\s*,\s*([0-9]+)\s*\)/g;
  const rows: Array<{
    itemKey: string;
    category: string;
    kind: string;
    linkedVisibilitySignalKey: string | null;
    displayOrder: number;
  }> = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(body)) !== null) {
    rows.push({
      itemKey: m[1],
      category: m[2],
      kind: m[3],
      linkedVisibilitySignalKey: m[4] ?? null,
      displayOrder: parseInt(m[5], 10),
    });
  }
  return rows;
}

describe('GBP catalog SQL ↔ TS parity', () => {
  it('parses 30 SQL rows', () => {
    const rows = extractSqlCatalogRows();
    expect(rows.length).toBe(30);
  });

  it('every SQL row has a matching TS catalog entry', () => {
    const rows = extractSqlCatalogRows();
    for (const r of rows) {
      const ts = GBP_CATALOG.find((c) => c.itemKey === r.itemKey);
      expect(ts, `SQL row missing in TS: ${r.itemKey}`).toBeDefined();
      if (ts) {
        expect(ts.category, `category drift for ${r.itemKey}`).toBe(r.category);
        expect(ts.kind, `kind drift for ${r.itemKey}`).toBe(r.kind);
        expect(ts.displayOrder, `displayOrder drift for ${r.itemKey}`).toBe(r.displayOrder);
        expect(
          ts.linkedVisibilitySignalKey,
          `linkedVisibilitySignalKey drift for ${r.itemKey}`,
        ).toBe(r.linkedVisibilitySignalKey);
      }
    }
  });

  it('every TS catalog entry has a matching SQL row', () => {
    const rows = extractSqlCatalogRows();
    for (const ts of GBP_CATALOG) {
      const sql = rows.find((r) => r.itemKey === ts.itemKey);
      expect(sql, `TS row missing in SQL: ${ts.itemKey}`).toBeDefined();
    }
  });
});

describe('GBP catalog structure', () => {
  it('TS catalog has exactly 30 items', () => {
    expect(GBP_CATALOG.length).toBe(30);
  });

  it('kind distribution: 19 SELF_ATTESTED + 2 AUTO_DERIVED + 9 LINKED_VISIBILITY', () => {
    const self = GBP_CATALOG.filter((c) => c.kind === 'SELF_ATTESTED').length;
    const auto = GBP_CATALOG.filter((c) => c.kind === 'AUTO_DERIVED').length;
    const linked = GBP_CATALOG.filter((c) => c.kind === 'LINKED_VISIBILITY').length;
    expect(self).toBe(19);
    expect(auto).toBe(2);
    expect(linked).toBe(9);
  });

  it('linkedVisibilitySignalKey is set iff kind = LINKED_VISIBILITY', () => {
    for (const c of GBP_CATALOG) {
      if (c.kind === 'LINKED_VISIBILITY') {
        expect(c.linkedVisibilitySignalKey, `linked kind has no signal: ${c.itemKey}`).not.toBeNull();
      } else {
        expect(c.linkedVisibilitySignalKey, `non-linked kind has signal: ${c.itemKey}`).toBeNull();
      }
    }
  });

  it('per-category item counts match spec', () => {
    const expected: Record<string, number> = {
      BUSINESS_PROFILE: 4,
      LOCATION_ACCURACY: 4,
      CONTACT_READINESS: 4,
      CONTENT_READINESS: 6,
      TRUST_SIGNALS: 5,
      EXPERIENCE_READINESS: 3,
      VERIFICATION_READINESS: 4,
    };
    for (const cat of GBP_CATEGORY_ORDER) {
      const count = GBP_CATALOG.filter((c) => c.category === cat).length;
      expect(count, `category ${cat} count mismatch`).toBe(expected[cat]);
    }
  });

  it('display_order strictly increasing within each category', () => {
    for (const cat of GBP_CATEGORY_ORDER) {
      const items = GBP_CATALOG.filter((c) => c.category === cat)
        .sort((a, b) => a.displayOrder - b.displayOrder);
      for (let i = 1; i < items.length; i++) {
        expect(items[i].displayOrder).toBeGreaterThan(items[i - 1].displayOrder);
      }
    }
  });

  it('every LINKED item references a known Visibility signal key', () => {
    const knownVisibilityKeys = new Set<string>([
      'gmb_claimed','gmb_verified','gmb_category_set',
      'address_complete','map_pin_set','phone_present',
      'review_link_set','off_platform_response','package_live',
    ]);
    for (const c of GBP_CATALOG.filter((x) => x.kind === 'LINKED_VISIBILITY')) {
      expect(
        knownVisibilityKeys.has(c.linkedVisibilitySignalKey ?? ''),
        `unknown linked signal: ${c.itemKey} → ${c.linkedVisibilitySignalKey}`,
      ).toBe(true);
    }
  });
});

describe('GBP readiness threshold', () => {
  it('threshold is 70%', () => {
    expect(GBP_READY_THRESHOLD_PCT).toBe(70);
  });

  it('meetsGBPReadyThreshold matches SQL CEIL formula', () => {
    // CEIL(30 × 0.70) = CEIL(21.0) = 21
    expect(meetsGBPReadyThreshold(21, 30)).toBe(true);
    expect(meetsGBPReadyThreshold(20, 30)).toBe(false);
    expect(meetsGBPReadyThreshold(0, 30)).toBe(false);
    expect(meetsGBPReadyThreshold(30, 30)).toBe(true);
  });

  it('returns false when total is zero', () => {
    expect(meetsGBPReadyThreshold(0, 0)).toBe(false);
  });
});

describe('catalog helpers', () => {
  it('findGBPCatalogItem returns the right item', () => {
    const item = findGBPCatalogItem('profile_claimed');
    expect(item).not.toBeNull();
    expect(item?.kind).toBe('LINKED_VISIBILITY');
    expect(item?.linkedVisibilitySignalKey).toBe('gmb_claimed');
  });

  it('findGBPCatalogItem returns null for missing keys', () => {
    expect(findGBPCatalogItem('does_not_exist')).toBeNull();
  });

  it('gbpCatalogForCategory sorts by displayOrder', () => {
    const items = gbpCatalogForCategory('CONTENT_READINESS');
    expect(items.length).toBe(6);
    for (let i = 1; i < items.length; i++) {
      expect(items[i].displayOrder).toBeGreaterThan(items[i - 1].displayOrder);
    }
  });
});

describe('SQL bridge function exists', () => {
  it('_gbp_signal_for_visibility function declared in migration', () => {
    expect(migrationSql).toContain('CREATE OR REPLACE FUNCTION public._gbp_signal_for_visibility');
  });

  it('70% threshold present in bridge function', () => {
    expect(migrationSql).toMatch(/v_satisfied\s*>=\s*CEIL\(\s*v_total\s*\*\s*0\.70\s*\)/);
  });
});
