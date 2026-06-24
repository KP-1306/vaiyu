// web/src/i18n/useOwnerT.ts
// Owner-console translation hook + the SINGLE reveal-gate for owner i18n.
//
// Why a wrapper over react-i18next's useTranslation:
//
//   1. Reveal-gate. The language preference (vaiyu.lang) is SHARED with the
//      guest portal. A user who switched the guest side to Hindi would otherwise
//      see owner screens flip to Hindi the moment a namespace merges — a
//      half-translated console on prod. Until OWNER_I18N_ENABLED flips to true
//      (final tranche, once the whole console is translated + visually QA'd),
//      every owner t() call is forced to resolve in ENGLISH, regardless of the
//      global language. Reveal = flip one boolean + mount <OwnerLangToggle/>.
//
//   2. No-raw-key / no-flash guarantee. Every call carries its English source as
//      defaultValue, so a not-yet-loaded lazy namespace or a missing key renders
//      the English text — never a raw "owner-x.key" string.
//
//   3. One consistent call shape across all 76 owner files:
//         const t = useOwnerT('owner-arrivals');
//         t('title', 'Arrivals')
//         t('count', '{{n}} arrivals', { n })          // interpolation
//         t('nights', '{{count}} night', { count })    // pluralisation
//
// Values used in logic/payload (status codes, role codes, payment modes, ids,
// slugs, booking codes) are NEVER passed through here as values — only their
// DISPLAY is localised, via the owner-common status./role./mode. maps keyed BY
// the code (see localizeCode / humanizeCode below).

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

// Master switch for the whole owner console. OFF during the multi-tranche build:
// prod owner console stays fully English no matter the saved language. Flip to
// true in the final tranche, after 100% is translated and screenshot-QA'd.
export const OWNER_I18N_ENABLED = true;

export type OwnerT = (
  key: string,
  defaultValue: string,
  vars?: Record<string, unknown>,
) => string;

/** Owner-scoped translator for a namespace. See file header for the call shape. */
export function useOwnerT(ns: string): OwnerT {
  const { t } = useTranslation(ns);
  return useCallback<OwnerT>(
    (key, defaultValue, vars) =>
      t(key, {
        defaultValue,
        // Force English while gated; once enabled, follow the global language.
        ...(OWNER_I18N_ENABLED ? {} : { lng: 'en' }),
        ...vars,
      }) as string,
    [t],
  );
}

/** Shorthand for the shared owner-common namespace (buttons, statuses, toasts). */
export function useOwnerCommonT(): OwnerT {
  return useOwnerT('owner-common');
}

/**
 * Locale tag for date/number formatting in the owner console. Subscribes to
 * language changes (re-renders the caller). Respects the reveal-gate: while
 * gated it's always 'en-IN' (Indian-English: DD/MM/YYYY, Latin digits — already
 * an improvement over the browser default); after reveal it follows Hindi with
 * 'hi-IN-u-nu-latn' (Hindi month/day names, Latin digits — matches the guest
 * portal). Money stays 'en-IN' everywhere (₹ + Latin digits).
 */
export function useOwnerLocale(): string {
  const { i18n } = useTranslation();
  const isHi =
    OWNER_I18N_ENABLED &&
    (i18n.resolvedLanguage || i18n.language || 'en').startsWith('hi');
  return isHi ? 'hi-IN-u-nu-latn' : 'en-IN';
}

/**
 * Returns 'hi' when the owner console is in Hindi mode, 'en' otherwise.
 * Respects the reveal-gate (always 'en' while OWNER_I18N_ENABLED = false).
 * Use this to pick bilingual data fields (e.g. meta.labelEn vs meta.labelHi)
 * without routing them through the i18n translation system.
 */
export function useOwnerLang(): 'en' | 'hi' {
  const { i18n } = useTranslation();
  if (!OWNER_I18N_ENABLED) return 'en';
  return (i18n.resolvedLanguage || i18n.language || 'en').startsWith('hi')
    ? 'hi'
    : 'en';
}

/**
 * Humanise a logic CODE into an English fallback label, e.g.
 * "CHECKED_IN" -> "Checked in", "NO_SHOW" -> "No show".
 * Used as the defaultValue when localising a status/role/mode code so an
 * unmapped code degrades to readable English rather than a raw enum.
 */
export function humanizeCode(code: string): string {
  const s = code.replace(/_/g, ' ').trim().toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : code;
}

/**
 * Localise a logic code for DISPLAY without ever translating the value itself.
 * Looks up `<group>.<CODE>` in owner-common (e.g. "status.CHECKED_IN"); falls
 * back to humanizeCode(code). The code stays the lookup key — callers keep using
 * the raw code for all logic/filtering/payloads.
 */
export function localizeCode(
  tc: OwnerT,
  group: 'status' | 'role' | 'mode',
  code: string | null | undefined,
): string {
  if (!code) return '';
  return tc(`${group}.${code}`, humanizeCode(code));
}
