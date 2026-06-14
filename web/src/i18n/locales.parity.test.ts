import { describe, it, expect } from 'vitest';

// Guardrail: every namespace must have the SAME logical keys in en and hi.
// This is the regression net (the repo has no ESLint to run a no-literal-string
// rule): if a new English key ships without its Hindi translation — or vice
// versa — this test fails loudly instead of the UI silently falling back to
// English for Hindi guests.
//
// Namespaces are auto-discovered, so adding a new screen's locale files is
// covered automatically. i18next plural suffixes (_one/_other/…) are normalised
// away, because CLDR plural categories legitimately differ between languages.
type Json = Record<string, unknown>;

const enMods = import.meta.glob('./locales/en/*.json', { eager: true });
const hiMods = import.meta.glob('./locales/hi/*.json', { eager: true });

function nsName(path: string): string {
  return path.replace(/^.*\/([^/]+)\.json$/, '$1');
}
function byNamespace(mods: Record<string, unknown>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [path, mod] of Object.entries(mods)) {
    out[nsName(path)] = ((mod as { default?: Json }).default ?? mod) as Json;
  }
  return out;
}

const en = byNamespace(enMods);
const hi = byNamespace(hiMods);

function keyset(obj: Json, prefix = ''): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(obj)) {
    const base = k.replace(/_(zero|one|two|few|many|other)$/, '');
    const path = prefix ? `${prefix}.${base}` : base;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const child of keyset(v as Json, path)) out.add(child);
    } else {
      out.add(path);
    }
  }
  return out;
}
const diff = (a: Set<string>, b: Set<string>) => [...a].filter((x) => !b.has(x)).sort();

describe('locale parity (en ⇄ hi)', () => {
  it('en and hi expose the same set of namespaces', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(hi).sort());
  });

  for (const ns of Object.keys(en)) {
    it(`${ns}: hi and en cover the same keys`, () => {
      const e = keyset(en[ns]);
      const h = keyset(hi[ns] ?? {});
      expect({ missingInHi: diff(e, h), missingInEn: diff(h, e) }).toEqual({
        missingInHi: [],
        missingInEn: [],
      });
    });
  }
});
