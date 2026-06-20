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
//
// Self-hosted via @fontsource (no third-party CDN — no Google Fonts request, no
// extra DNS/preconnect, works behind strict CSPs, and the font is fingerprinted
// and served from our own origin). Each weight's CSS + woff2 is code-split by
// Vite into an on-demand chunk, so the lazy "only for Hindi" behaviour is kept.
// We pull the Devanagari subset only (`devanagari-*`); Latin glyphs fall back to
// the system stack declared in languageToggle.css. font-display: swap is built
// into the @fontsource CSS, so text stays visible in a fallback face while it loads.
const DEVANAGARI_LANGS: readonly AppLang[] = ['hi'];

let devanagariRequested = false;

export function ensureFontForLang(lang: AppLang): void {
  if (typeof document === 'undefined') return;
  if (!DEVANAGARI_LANGS.includes(lang)) return;
  if (devanagariRequested) return;
  devanagariRequested = true;

  void import('@fontsource/noto-sans-devanagari/devanagari-400.css');
  void import('@fontsource/noto-sans-devanagari/devanagari-500.css');
  void import('@fontsource/noto-sans-devanagari/devanagari-600.css');
  void import('@fontsource/noto-sans-devanagari/devanagari-700.css');
}
