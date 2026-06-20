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
    // brand / class tiers commonly used by Indian hotels
    heritage: "हेरिटेज",
    palace: "पैलेस",
    signature: "सिग्नेचर",
    club: "क्लब",
    business: "बिज़नेस",
    comfort: "कम्फर्ट",
    smart: "स्मार्ट",
    compact: "कॉम्पैक्ट",
    value: "वैल्यू",
    regular: "रेगुलर",
    mini: "मिनी",
    maharaja: "महाराजा",
    maharani: "महारानी",
    raja: "राजा",
    rani: "रानी",
    nawab: "नवाब",
    honeymoon: "हनीमून",
    couple: "कपल",
    // unit / property types
    resort: "रिज़ॉर्ट",
    inn: "इन",
    spa: "स्पा",
    homestay: "होमस्टे",
    guesthouse: "गेस्टहाउस",
    duplex: "डुप्लेक्स",
    loft: "लॉफ्ट",
    chalet: "शैले",
    treehouse: "ट्रीहाउस",
    houseboat: "हाउसबोट",
    cabana: "कबाना",
    tower: "टावर",
    courtyard: "कोर्टयार्ड",
    terrace: "टेरेस",
    annexe: "एनेक्स",
    annex: "एनेक्स",
    wing: "विंग",
    block: "ब्लॉक",
    // views / locations
    beach: "बीच",
    beachfront: "बीचफ्रंट",
    ocean: "ओशन",
    oceanfront: "ओशनफ्रंट",
    forest: "फॉरेस्ट",
    woods: "वुड्स",
    jungle: "जंगल",
    hilltop: "हिलटॉप",
    lakeside: "लेकसाइड",
    lakefront: "लेकफ्रंट",
    seaview: "सी व्यू",
    lakeview: "लेक व्यू",
    poolview: "पूल व्यू",
    gardenview: "गार्डन व्यू",
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
 * Coverage guard for the controlled-vocabulary approach: report whether every
 * alphabetic token of `name` is known to the `lang` dictionary, and which are
 * not. Used (a) at authoring time to show the owner an honest Hindi preview and
 * flag words that will stay English, and (b) in a CI test to catch dictionary
 * gaps as the catalog grows. Numeric / punctuation tokens are ignored.
 */
export function roomTypeLocalizationCoverage(
  name: string | null | undefined,
  lang: string,
): { localized: string; fullyCovered: boolean; unresolved: string[] } {
  const localized = localizeRoomType(name, lang);
  if (!name || !name.trim()) return { localized, fullyCovered: true, unresolved: [] };
  const dict = ROOM_TYPE_TOKENS[lang];
  const unresolved: string[] = [];
  for (const tok of name.split(/\s+/)) {
    const m = tok.match(/^[^\p{L}\p{N}]*(.*?)[^\p{L}\p{N}]*$/u);
    const core = (m?.[1] ?? "").toLowerCase();
    if (!core || /^\p{N}+$/u.test(core)) continue; // skip empties + pure numbers
    if (!dict || !dict[core]) unresolved.push(core);
  }
  return { localized, fullyCovered: unresolved.length === 0, unresolved };
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
