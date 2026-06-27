// web/src/i18n/detect.ts
// Language resolution for the whole app (public site + guest portal; the owner
// console reads the same saved choice via useOwnerT).
//
// English is the default. The language NEVER changes on its own except for one
// scoped case (in-stay guests, below). Priority order (highest wins):
//   1. ?lang=hi|en  URL param  — lets server-sent links (WhatsApp/SMS) deep-link
//      a guest straight into their language; consumed into the saved choice.
//   2. localStorage saved choice — the user's last explicit toggle on this device.
//   3. In-stay guest entry only — when the FIRST page loaded is a personal-device
//      guest surface (room-QR / guest deep-link, see isInStayGuestEntry), honour
//      navigator.language so a Hindi-set phone opens those screens in Hindi with
//      zero taps. This is IN-MEMORY ONLY — never persisted — so it does not leak
//      to the owner console (readOwnerLang reads the saved choice) or to a later
//      marketing visit; an explicit toggle is still what sticks. Marketing, owner,
//      staff, admin and the check-in kiosk skip this and stay English.
//   4. fallback → English.
//
// The whole app therefore opens in English for marketing/owner/staff/admin (the
// 2026-06-27 product decision), with the single deliberate exception that a guest
// scanning a Hindi-phone room QR gets zero-tap Hindi (carve-out, 2026-06-27).

export const SUPPORTED_LANGS = ['en', 'hi'] as const;
export type AppLang = (typeof SUPPORTED_LANGS)[number];

export const STORAGE_KEY = 'vaiyu.lang';

// First path segments that are personal-device guest surfaces — reached by
// scanning a room QR or following a guest deep-link. Used ONLY to decide whether
// to honour the device language at first load (see resolveInitialLanguage); never
// for routing or auth. Marketing (''/about/contact/…), owner, staff/admin, the
// check-in kiosk ('checkin') and the pre-stay enquiry funnel ('p') are absent on
// purpose so they stay English.
const IN_STAY_GUEST_SEGMENTS = new Set<string>([
  'guest', // GuestNew portal: home/trips/stay/request-service/checkout/support/bills/review
  'scan', // QR entry that resolves the stay
  'hotel', // /hotel/:slug reached from a QR
  'menu', // /menu (food)
  'stay', // /stay/:code/(menu|orders)
  'bill', // guest bill
  'checkout', // guest self-checkout
  'precheckin', // /precheckin/:token
  'feedback', // /feedback/:token (post-stay)
  'regcard', // registration card
  'claim', // /claim a stay
  'requestTracker', // service-request tracker
  'track', // /track/:displayId
  'track-order', // /track-order/:id
]);

/**
 * True when `pathname`'s first segment is an in-stay guest surface (room-QR /
 * guest deep-link). Drives the device-language carve-out at first load only.
 */
export function isInStayGuestEntry(pathname: string): boolean {
  const seg = (pathname || '/').split('/')[1] || '';
  return IN_STAY_GUEST_SEGMENTS.has(seg);
}

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

  // 3. In-stay guest entry only — honour the device language (in-memory, NOT
  //    persisted) so a Hindi-set phone scanning a room QR opens the guest screens
  //    in Hindi. Marketing/owner/staff/admin/kiosk skip this and fall through to
  //    English. See header + isInStayGuestEntry.
  try {
    if (
      typeof window !== 'undefined' &&
      isInStayGuestEntry(window.location.pathname)
    ) {
      const fromDevice = normalize(
        typeof navigator !== 'undefined' ? navigator.language : null,
      );
      if (fromDevice) return fromDevice;
    }
  } catch {
    /* window/navigator unavailable — ignore */
  }

  // 4. fallback → English.
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
