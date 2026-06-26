// web/src/i18n/detect.ts
// Language resolution for the whole app (public site + guest portal; the owner
// console reads the same saved choice via useOwnerT).
//
// English is the default everywhere. The language NEVER changes on its own —
// only an explicit user action (the EN|हिं toggle) or a server-sent deep link
// flips it. Priority order (highest wins):
//   1. ?lang=hi|en  URL param  — lets server-sent links (WhatsApp/SMS) deep-link
//      a guest straight into their language; consumed into the saved choice.
//   2. localStorage saved choice — the user's last explicit toggle on this device.
//   3. fallback → English.
//
// Device language (navigator.language) is deliberately NOT consulted: a phone set
// to Hindi must still open VAiyu in English until the user chooses Hindi, so every
// first-time visitor gets a consistent English experience (product decision,
// 2026-06-27). No DB, no account: the device remembers the explicit choice.

export const SUPPORTED_LANGS = ['en', 'hi'] as const;
export type AppLang = (typeof SUPPORTED_LANGS)[number];

export const STORAGE_KEY = 'vaiyu.lang';

function normalize(raw: string | null | undefined): AppLang | null {
  if (!raw) return null;
  const base = raw.toLowerCase().split('-')[0];
  return (SUPPORTED_LANGS as readonly string[]).includes(base)
    ? (base as AppLang)
    : null;
}

export function resolveInitialLanguage(): AppLang {
  // 1. explicit ?lang= — one-shot: consume it into the saved choice, then strip
  //    it from the URL. Otherwise a stale ?lang in the address bar would override
  //    a later in-app toggle on every reload.
  try {
    const url = new URL(window.location.href);
    const fromParam = normalize(url.searchParams.get('lang'));
    if (fromParam) {
      persistLanguage(fromParam);
      url.searchParams.delete('lang');
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      return fromParam;
    }
  } catch {
    /* window/URL not available — ignore */
  }

  // 2. saved choice
  try {
    const fromStore = normalize(localStorage.getItem(STORAGE_KEY));
    if (fromStore) return fromStore;
  } catch {
    /* storage blocked (private mode) — ignore */
  }

  // 3. fallback → English. Device language is intentionally not consulted (see
  //    header): the app only switches to Hindi on an explicit choice or ?lang.
  return 'en';
}

export function persistLanguage(lang: AppLang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage blocked — the in-memory i18n state still holds for this session */
  }
}

/**
 * Subscribe to cross-tab changes of the saved language. The `storage` event fires
 * ONLY in OTHER tabs/windows of the same origin (never the tab that wrote it), so
 * this is purely for keeping a second open tab in sync — toggling the language in
 * one tab flips every other open tab live, instead of leaving it stale until a
 * reload. `cb` is called with the new normalised AppLang on a valid `vaiyu.lang`
 * write; clears / invalid values are ignored (the tab keeps its current language).
 * Returns an unsubscribe fn; no-op where `window` is unavailable (SSR/node tests).
 */
export function subscribeStoredLanguage(cb: (lang: AppLang) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    const lang = normalize(e.newValue);
    if (lang) cb(lang);
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
