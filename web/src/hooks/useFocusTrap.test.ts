import { describe, expect, it } from 'vitest';
import { getNextFocusable } from './useFocusTrap';

describe('getNextFocusable', () => {
  const items = ['a', 'b', 'c'];

  it('returns null for empty list', () => {
    expect(getNextFocusable([], 0, 'next')).toBeNull();
    expect(getNextFocusable([], 0, 'prev')).toBeNull();
  });

  it('moves forward', () => {
    expect(getNextFocusable(items, 0, 'next')).toBe('b');
    expect(getNextFocusable(items, 1, 'next')).toBe('c');
  });

  it('wraps from last to first on next', () => {
    expect(getNextFocusable(items, 2, 'next')).toBe('a');
  });

  it('moves backward', () => {
    expect(getNextFocusable(items, 2, 'prev')).toBe('b');
    expect(getNextFocusable(items, 1, 'prev')).toBe('a');
  });

  it('wraps from first to last on prev', () => {
    expect(getNextFocusable(items, 0, 'prev')).toBe('c');
  });

  it('handles currentIndex=-1 (nothing focused) sanely', () => {
    expect(getNextFocusable(items, -1, 'next')).toBe('a');
    expect(getNextFocusable(items, -1, 'prev')).toBe('a');
  });

  it('handles single-item list (focus stays put on wrap)', () => {
    expect(getNextFocusable(['only'], 0, 'next')).toBe('only');
    expect(getNextFocusable(['only'], 0, 'prev')).toBe('only');
  });
});
