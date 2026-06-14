// web/src/i18n/runtime.ts
// Side-effects that must follow the active language: the <html lang> attribute
// (screen readers + correct font fallback) and conditional font loading.

import type { AppLang } from './detect';

export function applyHtmlLang(lang: AppLang): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('lang', lang);
  }
}

// Load Noto Sans Devanagari ONLY when a Devanagari-script language is active.
// English-default users never download the (~heavy) Devanagari webfont; a Hindi
// guest pays it once on first switch, then it's cached. Idempotent.
const DEVANAGARI_LANGS: readonly AppLang[] = ['hi'];
const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap';

let devanagariRequested = false;

export function ensureFontForLang(lang: AppLang): void {
  if (typeof document === 'undefined') return;
  if (!DEVANAGARI_LANGS.includes(lang)) return;
  if (devanagariRequested) return;
  devanagariRequested = true;

  // Preconnect for a faster first paint, then the stylesheet (font-display: swap
  // keeps text visible in a fallback face while the Devanagari font loads).
  const pre1 = document.createElement('link');
  pre1.rel = 'preconnect';
  pre1.href = 'https://fonts.googleapis.com';
  const pre2 = document.createElement('link');
  pre2.rel = 'preconnect';
  pre2.href = 'https://fonts.gstatic.com';
  pre2.crossOrigin = 'anonymous';
  const sheet = document.createElement('link');
  sheet.rel = 'stylesheet';
  sheet.href = FONT_HREF;

  document.head.append(pre1, pre2, sheet);
}
