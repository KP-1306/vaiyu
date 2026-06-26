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
  persistLanguage,
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
  persistLanguage(lang);
});

// Keep other open tabs in sync: when the language is toggled in one tab, every
// other tab follows live (the `storage` event fires only in the OTHER tabs). The
// resulting changeLanguage re-persists the same value, which is a no-op write that
// emits no further storage event — so there is no cross-tab feedback loop.
subscribeStoredLanguage((lang) => {
  if (i18n.language?.split('-')[0] !== lang) void i18n.changeLanguage(lang);
});

export default i18n;
