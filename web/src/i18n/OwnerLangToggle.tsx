// web/src/i18n/OwnerLangToggle.tsx
// EN | हिं toggle for the owner console.
//
// Renders nothing while owner i18n is reveal-gated (OWNER_I18N_ENABLED = false),
// so it can be mounted in every owner shell now and "turns on" the day the flag
// flips. Reuses the guest toggle's dark-themed markup/CSS.
//
// Unlike the guest LanguageToggle (whose active state follows i18n.language, i.e.
// the device default), this toggle's active state is driven by readOwnerLang():
// the owner console is ENGLISH-DEFAULT and only shows Hindi on an explicit opt-in.
// So on a Hindi-set device with no saved choice, the pill correctly reads EN and
// matches the (English) content — they never disagree.

import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGS, type AppLang } from './detect';
import {
  OWNER_I18N_ENABLED,
  setOwnerLang,
  useOwnerLangValue,
} from './useOwnerT';
import './languageToggle.css';
import './ownerConsole.css';

const LABELS: Record<AppLang, string> = { en: 'EN', hi: 'हिं' };

export function OwnerLangToggle({ className = '' }: { className?: string }) {
  const { i18n, t } = useTranslation('owner-common');
  // Active state = the owner's explicit choice (default English), NOT the device
  // language. Reactive via the owner-language store.
  const current = useOwnerLangValue();
  if (!OWNER_I18N_ENABLED) return null;

  const switchTo = (lang: AppLang) => {
    if (lang === current) return;
    // Persist the explicit choice + re-render owner consumers via the store.
    setOwnerLang(lang);
    // Also flip the global i18n language so guest screens stay coherent in-session
    // (a later guest view follows the same saved choice without a reload).
    void i18n.changeLanguage(lang);
  };

  return (
    <div
      className={`gn-lang-toggle ${className}`.trim()}
      role="group"
      aria-label={t('language.label', 'Language')}
    >
      {SUPPORTED_LANGS.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={current === code}
          onClick={() => switchTo(code)}
          className={`gn-lang-toggle__btn ${current === code ? 'is-active' : ''}`}
        >
          {LABELS[code]}
        </button>
      ))}
    </div>
  );
}
