// web/src/i18n/OwnerLangToggle.tsx
// EN | हिं toggle for the owner console. A thin gate around the shared
// LanguageToggle: renders nothing while owner i18n is reveal-gated, so it can be
// safely mounted in every owner shell now and "turns on" the day OWNER_I18N_ENABLED
// flips to true (final tranche). Reuses the guest toggle's markup/styling, which
// is already dark-themed and sits cleanly on the owner shells.

import { LanguageToggle } from './LanguageToggle';
import { OWNER_I18N_ENABLED } from './useOwnerT';
import './ownerConsole.css';

export function OwnerLangToggle({ className = '' }: { className?: string }) {
  if (!OWNER_I18N_ENABLED) return null;
  return <LanguageToggle className={className} />;
}
