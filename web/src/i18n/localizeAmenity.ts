// web/src/i18n/localizeAmenity.ts
//
// Display-time localisation for hotel amenities.
//
// Amenities are a CLOSED catalogue (HotelOnboarding `AMENITY_LIST`): the owner
// toggles from a fixed set and the selected ENGLISH strings are stored in
// `hotels.amenities`. We deliberately keep the stored value as that canonical
// English code — it is the stable identity used both as the catalogue key and
// by the substring-based amenity-icon lookup (`getAmenityIcon` matches English,
// e.g. `includes('pool')`). Localising the *display* here (not the data) means:
//   • every hotel — existing and new — reads in Hindi instantly, no migration,
//   • icons keep working, and
//   • the Hindi wording is curated + consistent (no per-owner variance).
//
// Same approach as `localizeRoomType` (owner-authored catalogue data localised
// at render via the active language). Tech/brand terms (Wi-Fi, AC, EV) stay
// English — they read worse transliterated, matching the ENGLISH_RETAINED set.

// Curated Hindi for the 16 catalogue amenities, keyed by a normalised form of
// the English label so "Wi-Fi" / "WiFi" / "wi fi" all resolve.
const AMENITY_HI: Record<string, string> = {
  wifi: "Wi-Fi", // retained (brand/tech term)
  pool: "स्विमिंग पूल",
  spa: "स्पा",
  gym: "जिम",
  restaurant: "रेस्टोरेंट",
  bar: "बार",
  roomservice: "रूम सर्विस",
  parking: "पार्किंग",
  airportshuttle: "एयरपोर्ट शटल",
  laundry: "लॉन्ड्री",
  ac: "AC", // retained (tech term, written "AC" in India)
  petfriendly: "पेट फ्रेंडली",
  businesscenter: "बिज़नेस सेंटर",
  concierge: "कंसीयज",
  evcharging: "EV चार्जिंग", // EV retained
  kidsclub: "किड्स क्लब",
};

const AMENITY_DICTS: Record<string, Record<string, string>> = { hi: AMENITY_HI };

/** Lowercase + strip non-alphanumerics so label variants share one key. */
function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Localise a single amenity label for display. Returns the input unchanged for
 * English, for an unknown language, or for a value not in the catalogue (a
 * legacy / custom string) — so it degrades gracefully to the stored English.
 */
export function localizeAmenity(
  name: string | null | undefined,
  lang: string,
): string {
  if (!name) return name ?? "";
  const base = (lang || "").split("-")[0];
  const dict = AMENITY_DICTS[base];
  if (!dict) return name;
  return dict[normalizeKey(name)] ?? name;
}
