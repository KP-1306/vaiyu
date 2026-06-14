// web/src/i18n/detect.ts
// Language resolution for the guest-facing portal.
//
// Priority order (highest wins):
//   1. ?lang=hi|en  URL param  — forward-compatible hook so future server-sent
//      links (WhatsApp/SMS) can deep-link a guest straight into their language.
//   2. localStorage saved choice — the guest's last explicit toggle on this device.
//   3. navigator.language — the device language (a Hindi-set phone → Hindi, zero taps).
//   4. fallback → English.
//
// No DB, no account: the device remembers. (A server-side preferred_language
// column only earns its keep once server-sent messages are translated.)

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

  // 3. device language
  const fromNav = normalize(
    typeof navigator !== 'undefined' ? navigator.language : null,
  );
  if (fromNav) return fromNav;

  // 4. fallback
  return 'en';
}

export function persistLanguage(lang: AppLang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage blocked — the in-memory i18n state still holds for this session */
  }
}
