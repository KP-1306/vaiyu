// web/src/i18n/index.ts
// i18next initialisation for the guest-facing portal.
//
// Locale bundles are lazy-loaded per (language, namespace) via dynamic import,
// so the default English load never ships Hindi strings — and Hindi loads only
// when a guest actually switches. Vite code-splits each ./locales/<lng>/<ns>.json.

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import resourcesToBackend from 'i18next-resources-to-backend';
import {
  resolveInitialLanguage,
  subscribeStoredLanguage,
  SUPPORTED_LANGS,
  type AppLang,
} from './detect';
import { applyHtmlLang, ensureFontForLang } from './runtime';

const initialLng = resolveInitialLanguage();

void i18n
  .use(
    resourcesToBackend(
      (language: string, namespace: string) =>
        import(`./locales/${language}/${namespace}.json`),
    ),
  )
  .use(initReactI18next)
  .init({
    lng: initialLng,
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGS as unknown as string[],
    ns: ['common', 'home'],
    defaultNS: 'common',
    interpolation: { escapeValue: false }, // React already escapes
    returnNull: false,
    react: { useSuspense: false }, // we manage loading ourselves; no Suspense flash
  });

// Apply language side-effects now and on every change.
applyHtmlLang(initialLng);
ensureFontForLang(initialLng);

i18n.on('languageChanged', (lng) => {
  const lang = lng.split('-')[0] as AppLang;
  applyHtmlLang(lang);
  ensureFontForLang(lang);
  // NB: do NOT persist here. Persistence happens only on an explicit user choice
  // (the toggles call persistLanguage / setOwnerLang) or a ?lang deep link. That
  // keeps the in-stay device-language carve-out (resolveInitialLanguage step 3)
  // in-memory only, so it never bleeds into the saved choice the owner console
  // reads — and an English marketing/owner load never writes 'en' that would
  // later suppress a guest's zero-tap Hindi.
});

// Keep other open tabs in sync: when the saved language changes in one tab, every
// other tab follows live (the `storage` event fires only in the OTHER tabs).
// changeLanguage does not persist (see above), so there is no cross-tab write
// loop; the value is already in localStorage from the tab that made the change.
subscribeStoredLanguage((lang) => {
  if (i18n.language?.split('-')[0] !== lang) void i18n.changeLanguage(lang);
});

export default i18n;
