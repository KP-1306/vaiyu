// web/src/i18n/LanguageToggle.tsx
// EN | हिं segmented toggle. The guest's explicit override; persists per device.

import { useTranslation } from 'react-i18next';
import { persistLanguage, SUPPORTED_LANGS, type AppLang } from './detect';
import './languageToggle.css';

const LABELS: Record<AppLang, string> = { en: 'EN', hi: 'हिं' };

export function LanguageToggle({ className = '' }: { className?: string }) {
  const { i18n, t } = useTranslation('common');
  const current = (i18n.resolvedLanguage || i18n.language || 'en').split(
    '-',
  )[0] as AppLang;

  const switchTo = (lang: AppLang) => {
    if (lang === current) return;
    persistLanguage(lang);
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
