// localizeRoomType — display-only localization of owner-authored room-type names.
//
// Room-type names are merchant data (authored by the hotel, stored in the DB), so
// they are NOT translated by react-i18next. But for Indian-market Hindi we want the
// common catalog ("Standard Room", "Deluxe Valley View Room") to read naturally in
// Devanagari without any translation API.
//
// Approach (matches Booking.com / Airbnb taxonomy localization):
//   - A curated, transliteration-leaning dictionary of the canonical hospitality
//     vocabulary. Transliteration ("स्टैंडर्ड रूम") not literal translation
//     ("मानक कमरा") — that's the register Indian guests recognize (cf. MakeMyTrip/OYO).
//   - Compositional: a name is tokenised on whitespace and each known token is mapped
//     independently, so multi-word names ("Super Deluxe Valley View Room") localise
//     cleanly. Unknown tokens are kept verbatim, so a fully custom name degrades to the
//     original string (raw fallback) and a partly-known name localises what it can.
//   - Zero network calls; deterministic; pure function.
//
// This is the default tier. A future owner-supplied `name_i18n.hi` override (Phase 2)
// would take precedence over this dictionary at the data layer.

// Per-language token → translation. Keys are lowercase; lookups are case-insensitive.
// Extend by adding more languages or tokens — no other code changes needed.
const ROOM_TYPE_TOKENS: Record<string, Record<string, string>> = {
  hi: {
    // base room classes
    standard: "स्टैंडर्ड",
    classic: "क्लासिक",
    economy: "इकोनॉमी",
    budget: "बजट",
    deluxe: "डीलक्स",
    superior: "सुपीरियर",
    premium: "प्रीमियम",
    executive: "एग्जीक्यूटिव",
    luxury: "लक्ज़री",
    grand: "ग्रैंड",
    royal: "रॉयल",
    imperial: "इम्पीरियल",
    presidential: "प्रेसिडेंशियल",
    junior: "जूनियर",
    accessible: "एक्सेसिबल",
    connecting: "कनेक्टिंग",
    // space / unit types
    room: "रूम",
    rooms: "रूम",
    suite: "सुइट",
    suites: "सुइट",
    studio: "स्टूडियो",
    apartment: "अपार्टमेंट",
    villa: "विला",
    cottage: "कॉटेज",
    penthouse: "पेंटहाउस",
    tent: "टेंट",
    tents: "टेंट",
    dormitory: "डॉर्मिटरी",
    dorm: "डॉर्म",
    bed: "बेड",
    beds: "बेड",
    cabin: "केबिन",
    bungalow: "बंगला",
    // occupancy
    single: "सिंगल",
    double: "डबल",
    twin: "ट्विन",
    triple: "ट्रिपल",
    quad: "क्वाड",
    family: "फैमिली",
    king: "किंग",
    queen: "क्वीन",
    // modifiers
    super: "सुपर",
    ac: "एसी",
    "non-ac": "नॉन-एसी",
    non: "नॉन",
    cozy: "कोज़ी",
    cosy: "कोज़ी",
    pool: "पूल",
    poolside: "पूलसाइड",
    garden: "गार्डन",
    valley: "वैली",
    sea: "सी",
    lake: "लेक",
    mountain: "माउंटेन",
    hill: "हिल",
    river: "रिवर",
    riverside: "रिवरसाइड",
    city: "सिटी",
    view: "व्यू",
    facing: "फेसिंग",
    balcony: "बालकनी",
    // connectors guests commonly type
    with: "विद",
    and: "एंड",
  },
};

/**
 * Localize a single owner-authored room-type name for display.
 * Returns the name unchanged when there is no dictionary for `lang` (e.g. English)
 * or when no tokens are recognised.
 */
export function localizeRoomType(
  name: string | null | undefined,
  lang: string,
): string {
  if (!name) return name ?? "";
  const dict = ROOM_TYPE_TOKENS[lang];
  if (!dict) return name;
  // Split keeping the original whitespace runs so we can rejoin exactly.
  return name
    .split(/(\s+)/)
    .map((tok) => {
      if (tok === "" || /^\s+$/.test(tok)) return tok;
      // strip surrounding punctuation for the lookup, preserve it around the result
      const m = tok.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
      const [, pre, core, post] = m ?? [null, "", tok, ""];
      const hit = dict[core.toLowerCase()];
      return hit ? `${pre}${hit}${post}` : tok;
    })
    .join("");
}

/**
 * Localize a list of room-type names and join them for display.
 * When the list is empty/missing, localizes `fallback` (so the hardcoded
 * "Standard Room" default also reads in the active language).
 */
export function localizeRoomTypeList(
  names: string[] | null | undefined,
  lang: string,
  fallback = "",
): string {
  if (!names || names.length === 0) return localizeRoomType(fallback, lang);
  return names.map((n) => localizeRoomType(n, lang)).join(", ");
}
