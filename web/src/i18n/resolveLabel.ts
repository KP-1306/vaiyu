// resolveLabel — render an owner-supplied localized override on top of whatever
// the existing localization already produces, without disturbing it.
//
// Owner-authored catalog rows (menu items, services, room types) carry an
// OPTIONAL `name_i18n` jsonb, e.g. {"hi":"पनीर टिक्का"}. The frozen transactional
// snapshots (food_order_items.item_name_i18n, tickets.title_i18n) carry the same
// shape. This helper resolves the display string with a strict precedence:
//
//   1. English (or any non-Hindi UI) → always the `fallback` exactly as given.
//      `fallback` is the caller's current behaviour: the as-authored name, or the
//      canonical key/dictionary localization already shipped (e.g. the meal-category
//      and service-catalog Hindi, or localizeRoomType()). We never override English.
//   2. Non-English → the owner-supplied override for that language IF it is a
//      non-empty string, ELSE the `fallback` (so an item with no Hindi yet keeps
//      its current rendering — English name, or canonical dictionary Hindi).
//
// This makes the feature strictly additive: when `name_i18n` is empty ('{}' — the
// default for every existing row) the output is byte-identical to today. There is
// no machine translation anywhere; the override only ever holds owner-supplied text.

export type I18nMap = Record<string, string> | null | undefined;

/**
 * Resolve the display label for an owner-authored value.
 * @param i18n    the row's `*_i18n` map (may be null/undefined/empty)
 * @param lang    the active UI language (e.g. "en", "hi", "hi-IN")
 * @param fallback the string to show when there is no override for `lang`
 *                 — pass the caller's current display string (as-authored or
 *                 already-canonically-localized) so behaviour is unchanged.
 */
export function resolveLabel(i18n: I18nMap, lang: string, fallback: string): string {
  // Base subtag so "hi-IN" behaves like "hi" and "en-US" like "en".
  const base = (lang || "en").toLowerCase().split("-")[0];
  // English never takes an override — owner data stays as authored.
  if (base === "en") return fallback;
  const override = i18n?.[base];
  if (typeof override === "string" && override.trim() !== "") return override;
  return fallback;
}

/**
 * Resolve a service name for display with the full precedence used across every
 * guest surface (FoodMenu, My Requests, trackers, Home, Request Service):
 *   owner override (name_i18n)  >  canonical key (foodMenu:service.<key>.title)
 *   >  as-authored label.
 * The caller's `t` must have the "foodMenu" namespace available. English always
 * returns the as-authored label. Single source of truth — don't re-inline.
 */
export function localizeServiceName(
  t: (key: string, opts?: { defaultValue?: string }) => string,
  lang: string,
  svc: { key?: string | null; label?: string | null; name_i18n?: I18nMap },
): string {
  const label = svc.label ?? "";
  const base = (lang || "en").toLowerCase().split("-")[0];
  const canonical =
    base !== "en" && svc.key
      ? t(`foodMenu:service.${svc.key}.title`, { defaultValue: label })
      : label;
  return resolveLabel(svc.name_i18n, lang, canonical);
}
