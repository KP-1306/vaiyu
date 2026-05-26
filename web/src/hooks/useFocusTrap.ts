// web/src/hooks/useFocusTrap.ts
//
// Lightweight focus trap for modals. Cycles Tab/Shift+Tab between focusable
// elements within the container.
//
// Pure logic lives in getNextFocusable() — testable without DOM.
// The hook itself is a thin React wrapper around DOM listeners.

import { useEffect } from 'react';
import type { RefObject } from 'react';

export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Pure: given a list of focusable elements + the currently-focused index
 * (or -1 if none), return the next/prev focusable element with wrap-around.
 */
export function getNextFocusable<T>(
  focusables: T[],
  currentIndex: number,
  direction: 'next' | 'prev',
): T | null {
  if (focusables.length === 0) return null;
  // No element currently focused: both directions should return the first
  // focusable. This matches the operator expectation that pressing Tab/Shift+Tab
  // inside a modal with no active focus should jump into the modal at the start.
  if (currentIndex < 0) return focusables[0] ?? null;
  const nextIndex =
    direction === 'next'
      ? (currentIndex + 1) % focusables.length
      : (currentIndex - 1 + focusables.length) % focusables.length;
  return focusables[nextIndex] ?? null;
}

/** DOM-bound: collect visible focusable descendants. */
export function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
  );
}

/**
 * useFocusTrap — when active, intercepts Tab/Shift+Tab inside the container
 * and cycles focus among focusable descendants. Also focuses the first
 * focusable element on activation.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement>,
  isActive: boolean,
): void {
  useEffect(() => {
    if (!isActive) return;
    const container = containerRef.current;
    if (!container) return;

    // Focus first focusable on activation (gives keyboard users a sane starting point)
    const initial = getFocusableElements(container);
    initial[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const els = getFocusableElements(container);
      if (els.length === 0) return;
      const currentIndex = els.indexOf(document.activeElement as HTMLElement);
      const next = getNextFocusable(els, currentIndex, e.shiftKey ? 'prev' : 'next');
      if (next) {
        e.preventDefault();
        next.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => container.removeEventListener('keydown', onKeyDown);
  }, [isActive, containerRef]);
}
