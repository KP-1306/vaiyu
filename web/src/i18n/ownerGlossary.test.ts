import { describe, it, expect } from 'vitest';
import { OWNER_GLOSSARY, ENGLISH_RETAINED } from './ownerGlossary';

// Guardrail for owner-console Hindi consistency. Auto-discovers every
// locales/{en,hi}/owner-*.json, so new screens are covered with no edits here.
//
//   1. ENGLISH_RETAINED — wherever an English value contains an industry token
//      (RevPAR, GST, UPI…), the Hindi value must contain it verbatim. Catches
//      anyone Devanagari-ising a term that should stay English.
//   2. OWNER_GLOSSARY — any value that is EXACTLY a glossary term must use the
//      one canonical Hindi everywhere (बुकिंग, रूम, चेक-इन …). Catches drift.

type Json = Record<string, unknown>;

const enMods = import.meta.glob('./locales/en/owner-*.json', { eager: true });
const hiMods = import.meta.glob('./locales/hi/owner-*.json', { eager: true });

function nsName(path: string): string {
  return path.replace(/^.*\/([^/]+)\.json$/, '$1');
}
function asNs(mods: Record<string, unknown>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [path, mod] of Object.entries(mods)) {
    out[nsName(path)] = ((mod as { default?: Json }).default ?? mod) as Json;
  }
  return out;
}
/** Flatten nested JSON to { "a.b.c": "leaf string" }. */
function flatten(obj: Json, prefix = '', out: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v as Json, p, out);
    else if (typeof v === 'string') out[p] = v;
  }
  return out;
}
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const en = asNs(enMods);
const hi = asNs(hiMods);

describe('owner glossary consistency', () => {
  it('English-retained terms survive verbatim into Hindi', () => {
    const violations: string[] = [];
    for (const ns of Object.keys(en)) {
      const e = flatten(en[ns]);
      const h = flatten(hi[ns] ?? {});
      for (const [key, enVal] of Object.entries(e)) {
        const hiVal = h[key];
        if (hiVal == null) continue; // parity test owns missing-key failures
        for (const term of ENGLISH_RETAINED) {
          const re = new RegExp(`\\b${escapeRegExp(term)}\\b`);
          if (re.test(enVal) && !re.test(hiVal)) {
            violations.push(`${ns}.${key}: "${term}" missing in hi ("${hiVal}")`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('exact glossary terms use the one canonical Hindi', () => {
    const violations: string[] = [];
    for (const ns of Object.keys(en)) {
      const e = flatten(en[ns]);
      const h = flatten(hi[ns] ?? {});
      for (const [key, enVal] of Object.entries(e)) {
        const canon = OWNER_GLOSSARY[enVal.trim().toLowerCase()];
        if (!canon) continue;
        const hiVal = (h[key] ?? '').trim();
        if (hiVal && hiVal !== canon) {
          violations.push(`${ns}.${key}: "${enVal}" → expected "${canon}", got "${hiVal}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
