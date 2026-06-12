// web/src/config/visibilityScore.test.ts
//
// Parity tests for Visibility Score. The TS-side weights and the SQL-side
// `_visibility_weights()` function MUST be identical or the score the UI
// shows will silently disagree with the score the snapshot writes.
//
// This test reads the migration file as text, regex-extracts the TABLE return
// from `_visibility_weights()`, and asserts byte-equality with VISIBILITY_FORMULA.
//
// Also validates: weights sum to 100, band thresholds are strictly decreasing,
// bandForScore matches the SQL CASE branches, and every signal_key in TS has
// a matching IF branch in the SQL evaluator.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  VISIBILITY_BAND_THRESHOLDS,
  VISIBILITY_FORMULA,
  VISIBILITY_SIGNALS,
  bandForScore,
} from './visibilityScore';

// v4 migration is the latest CREATE OR REPLACE for both _visibility_weights()
// and _compute_visibility_score(). v1/v2/v3 files are superseded.
const MIGRATION_V4_PATH = resolve(
  __dirname,
  '../../../supabase/migrations/20260613000003_visibility_score_v4_guest_info.sql',
);
const migrationSql = readFileSync(MIGRATION_V4_PATH, 'utf8');

describe('visibility score formula', () => {
  it('weights sum to exactly 100', () => {
    const sum = Object.values(VISIBILITY_FORMULA.weights).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it('formula version is a positive integer', () => {
    expect(Number.isInteger(VISIBILITY_FORMULA.version)).toBe(true);
    expect(VISIBILITY_FORMULA.version).toBeGreaterThanOrEqual(1);
  });

  it('TS weights match SQL _visibility_weights() exactly', () => {
    // Extract the SELECT inside _visibility_weights().
    // The function body is everything from `SELECT 1::int AS version,` up to the
    // `$$;` that ends the function body — and only inside _visibility_weights().
    const fnStart = migrationSql.indexOf(
      'CREATE OR REPLACE FUNCTION public._visibility_weights()',
    );
    expect(fnStart).toBeGreaterThan(-1);
    // Find the body delimiter ($$) that opens the function.
    const bodyOpenIdx = migrationSql.indexOf('AS $$', fnStart);
    expect(bodyOpenIdx).toBeGreaterThan(-1);
    // And the matching close ($$;) AFTER the open.
    const bodyCloseIdx = migrationSql.indexOf('$$;', bodyOpenIdx + 5);
    expect(bodyCloseIdx).toBeGreaterThan(-1);
    const body = migrationSql.slice(bodyOpenIdx, bodyCloseIdx);

    // Parse version
    const versionMatch = body.match(/SELECT\s+(\d+)::int\s+AS\s+version/i);
    expect(versionMatch).not.toBeNull();
    const sqlVersion = parseInt(versionMatch![1], 10);
    expect(sqlVersion).toBe(VISIBILITY_FORMULA.version);

    // Parse weight pairs: lines of the form: 'key', N,
    // Tolerates whitespace and trailing commas.
    const pairRe = /'([a-z_]+)'\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*[,)]/g;
    const sqlWeights: Record<string, number> = {};
    let m: RegExpExecArray | null;
    while ((m = pairRe.exec(body)) !== null) {
      sqlWeights[m[1]] = Number(m[2]);
    }

    // The pair regex also catches the version literal? No — the version literal
    // is integer-only and not inside quotes. Sanity: ensure all signal keys in
    // TS appear in SQL with the same weight.
    for (const [key, weight] of Object.entries(VISIBILITY_FORMULA.weights)) {
      expect(sqlWeights[key], `missing in SQL: ${key}`).toBe(weight);
    }
    // And no SQL keys missing from TS
    for (const sqlKey of Object.keys(sqlWeights)) {
      expect(
        Object.prototype.hasOwnProperty.call(VISIBILITY_FORMULA.weights, sqlKey),
        `unexpected SQL key not in TS: ${sqlKey}`,
      ).toBe(true);
    }
  });

  it('every signal in VISIBILITY_SIGNALS has a weight and a SQL evaluator branch', () => {
    for (const key of Object.keys(VISIBILITY_SIGNALS)) {
      expect(
        Object.prototype.hasOwnProperty.call(VISIBILITY_FORMULA.weights, key),
        `no weight for signal ${key}`,
      ).toBe(true);
      // SQL evaluator assigns v_signal_key := 'key';
      expect(
        migrationSql.includes(`v_signal_key := '${key}';`),
        `no SQL evaluator branch for signal ${key}`,
      ).toBe(true);
    }
  });
});

describe('visibility band thresholds', () => {
  it('are strictly decreasing', () => {
    const t = VISIBILITY_BAND_THRESHOLDS;
    expect(t.STRONG).toBeGreaterThan(t.GOOD);
    expect(t.GOOD).toBeGreaterThan(t.NEEDS_ATTENTION);
    expect(t.NEEDS_ATTENTION).toBeGreaterThan(t.CRITICAL);
  });

  it('bandForScore returns ONBOARDING when signals_total < 5', () => {
    expect(bandForScore(0, 0)).toBe('ONBOARDING');
    expect(bandForScore(100, 4)).toBe('ONBOARDING');
    expect(bandForScore(99, 1)).toBe('ONBOARDING');
  });

  it('bandForScore matches SQL CASE bands', () => {
    expect(bandForScore(95, 19)).toBe('STRONG');
    expect(bandForScore(80, 19)).toBe('STRONG');
    expect(bandForScore(79.9, 19)).toBe('GOOD');
    expect(bandForScore(60, 19)).toBe('GOOD');
    expect(bandForScore(59.9, 19)).toBe('NEEDS_ATTENTION');
    expect(bandForScore(40, 19)).toBe('NEEDS_ATTENTION');
    expect(bandForScore(39.9, 19)).toBe('CRITICAL');
    expect(bandForScore(0, 19)).toBe('CRITICAL');
  });

  it('SQL band CASE matches TS band CASE structure', () => {
    // Sanity-check the SQL CASE in _compute_visibility_score uses the same 80/60/40
    // thresholds as VISIBILITY_BAND_THRESHOLDS.
    expect(migrationSql).toMatch(/WHEN\s+v_total_score\s*>=\s*80\s+THEN\s+'STRONG'/);
    expect(migrationSql).toMatch(/WHEN\s+v_total_score\s*>=\s*60\s+THEN\s+'GOOD'/);
    expect(migrationSql).toMatch(/WHEN\s+v_total_score\s*>=\s*40\s+THEN\s+'NEEDS_ATTENTION'/);
    expect(migrationSql).toMatch(/ELSE\s+'CRITICAL'/);
  });
});

describe('per-category weight totals', () => {
  it('GMB_READINESS weights sum to 30', () => {
    const cat = Object.entries(VISIBILITY_SIGNALS)
      .filter(([_, m]) => m.category === 'GMB_READINESS')
      .reduce((acc, [k]) => acc + (VISIBILITY_FORMULA.weights as Record<string, number>)[k], 0);
    expect(cat).toBe(30);
  });
  it('TRUST_REPUTATION weights sum to 25', () => {
    const cat = Object.entries(VISIBILITY_SIGNALS)
      .filter(([_, m]) => m.category === 'TRUST_REPUTATION')
      .reduce((acc, [k]) => acc + (VISIBILITY_FORMULA.weights as Record<string, number>)[k], 0);
    expect(cat).toBe(25);
  });
  it('DIGITAL_ASSETS weights sum to 20', () => {
    const cat = Object.entries(VISIBILITY_SIGNALS)
      .filter(([_, m]) => m.category === 'DIGITAL_ASSETS')
      .reduce((acc, [k]) => acc + (VISIBILITY_FORMULA.weights as Record<string, number>)[k], 0);
    expect(cat).toBe(20);
  });
  it('DIRECT_ENQUIRY weights sum to 15', () => {
    const cat = Object.entries(VISIBILITY_SIGNALS)
      .filter(([_, m]) => m.category === 'DIRECT_ENQUIRY')
      .reduce((acc, [k]) => acc + (VISIBILITY_FORMULA.weights as Record<string, number>)[k], 0);
    expect(cat).toBe(15);
  });
  it('EXPERIENCE_PACKAGES weights sum to 10', () => {
    const cat = Object.entries(VISIBILITY_SIGNALS)
      .filter(([_, m]) => m.category === 'EXPERIENCE_PACKAGES')
      .reduce((acc, [k]) => acc + (VISIBILITY_FORMULA.weights as Record<string, number>)[k], 0);
    expect(cat).toBe(10);
  });
});
