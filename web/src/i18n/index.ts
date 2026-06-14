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

export default i18n;
