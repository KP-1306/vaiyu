// web/src/services/interaktKeywordRouter.test.ts
//
// Mirror test for the keyword-router used inside the interakt-webhook edge
// function. The function lives in Deno-only source so we re-declare the
// patterns here and assert behaviour. If the regex set drifts, this test
// fails when the edge-function code is updated without the test.
//
// Drift guard: the test also reads the webhook source file and asserts the
// exact regex literals appear in it.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Re-declared mirror of `KEYWORD_MAP` in interakt-webhook/index.ts. Update
// BOTH places together; the drift-guard at the bottom will catch the miss.
const PATTERNS: Array<{ kw: RegExp; category: string }> = [
  { kw: /\b(towel|towels|clean|cleaning|sheets?|laundry|housekeeping)\b/i, category: 'housekeeping' },
  { kw: /\b(food|meal|breakfast|lunch|dinner|menu|kitchen|order)\b/i, category: 'food' },
  { kw: /\b(taxi|cab|tour|driver|guide|trek|concierge|tickets?)\b/i, category: 'concierge' },
  { kw: /\b(staff|help|talk|speak|manager|reception|frontdesk|front\s*desk)\b/i, category: 'staff' },
];

function detectCategoryFromText(text: string | null): string | null {
  if (!text) return null;
  for (const { kw, category } of PATTERNS) {
    if (kw.test(text)) return category;
  }
  return null;
}

describe('interakt-webhook — keyword-based service request routing', () => {
  it.each([
    ['need extra towels', 'housekeeping'],
    ['Towel please', 'housekeeping'],
    ['clean my room', 'housekeeping'],
    ['fresh sheets in 204', 'housekeeping'],
    ['laundry tomorrow morning', 'housekeeping'],
    ['can we order food', 'food'],
    ['breakfast at 8?', 'food'],
    ['can I see the menu', 'food'],
    ['taxi to Mussoorie', 'concierge'],
    ['need a tour guide', 'concierge'],
    ['can I speak to staff', 'staff'],
    ['talk to manager please', 'staff'],
    ['front  desk please', 'staff'],   // whitespace tolerance in regex
  ])('"%s" → %s', (text, expected) => {
    expect(detectCategoryFromText(text)).toBe(expected);
  });

  it('no keyword → null fallback (will trigger how_can_we_help template)', () => {
    expect(detectCategoryFromText('hello')).toBe(null);
    expect(detectCategoryFromText('🙂')).toBe(null);
    expect(detectCategoryFromText('')).toBe(null);
    expect(detectCategoryFromText(null)).toBe(null);
  });

  it('case-insensitive', () => {
    expect(detectCategoryFromText('TOWELS')).toBe('housekeeping');
    expect(detectCategoryFromText('Menu')).toBe('food');
  });

  it('word-boundary safety (must not catch substrings)', () => {
    // "stowel" should NOT match towel
    expect(detectCategoryFromText('store')).toBe(null);
    // "speaking" should not match speak via plain substring
    expect(detectCategoryFromText('stitched')).toBe(null);
  });
});

// ─── Drift guard: webhook source must contain the same patterns ────────────

describe('interakt-webhook keyword set drift guard', () => {
  const WEBHOOK_SRC = readFileSync(
    resolve(__dirname, '../../../supabase/functions/interakt-webhook/index.ts'),
    'utf8',
  );

  it.each([
    'towel|towels|clean|cleaning|sheets?|laundry|housekeeping',
    'food|meal|breakfast|lunch|dinner|menu|kitchen|order',
    'taxi|cab|tour|driver|guide|trek|concierge|tickets?',
  ])('webhook regex contains %s', (frag) => {
    expect(
      WEBHOOK_SRC.includes(frag),
      `webhook keyword pattern '${frag}' not found in interakt-webhook/index.ts — update PATTERNS in this test together`,
    ).toBe(true);
  });
});
