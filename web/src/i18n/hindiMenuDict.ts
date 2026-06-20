// hindiMenuDict — a curated, compositional English→Devanagari token dictionary
// for the Indian hotel F&B + service-catalog vocabulary. Used to PRE-FILL an
// editable owner suggestion (never auto-shown to a guest). Curated spellings are
// the only way to get conventional forms right offline (वेज, कॉफ़ी, सैंडविच,
// मसाला, थाली) — a rule engine cannot derive these. Unknown tokens fall back to
// the phonetic engine (transliterateHi).
//
// Same pattern as localizeRoomType: lowercase token → Devanagari, looked up
// case-insensitively and composed word-by-word so multi-word names work
// ("paneer tikka masala" → पनीर टिक्का मसाला, "butter chicken" → बटर चिकन).
//
// Conventions: dish/ingredient names use the real Hindi word (आलू, मसाला, दही);
// established English loanwords use their conventional Devanagari spelling
// (सैंडविच, बर्गर, कॉफ़ी). Keys are singular+plural where both are common.
// Extend freely — it is a suggestion aid, so partial coverage is fine.

export const HINDI_MENU_DICT: Record<string, string> = {
  // ---- connectors ----
  with: "विद", and: "एंड", "in": "इन", of: "ऑफ़", the: "द", n: "एन", or: "या",

  // ---- proteins / mains ----
  veg: "वेज", vegetable: "वेजिटेबल", vegetables: "वेजिटेबल", vegetarian: "वेजिटेरियन",
  nonveg: "नॉन-वेज", non: "नॉन", chicken: "चिकन", mutton: "मटन", fish: "फ़िश", egg: "एग", eggs: "एग",
  paneer: "पनीर", prawn: "प्रॉन", prawns: "प्रॉन", lamb: "लैंब", beef: "बीफ़", pork: "पोर्क",
  soya: "सोया", tofu: "टोफ़ू", keema: "कीमा", kheema: "कीमा",

  // ---- prep styles / gravies ----
  masala: "मसाला", tikka: "टिक्का", tandoori: "तंदूरी", curry: "करी", gravy: "ग्रेवी",
  butter: "बटर", makhani: "मखनी", korma: "कोरमा", kadai: "कड़ाही", kadhai: "कड़ाही",
  bhuna: "भुना", fried: "फ़्राइड", grilled: "ग्रिल्ड", roasted: "रोस्टेड", roast: "रोस्ट",
  steamed: "स्टीम्ड", crispy: "क्रिस्पी", spicy: "स्पाइसी", shahi: "शाही", malai: "मलाई",
  achari: "अचारी", lababdar: "लबाबदार", do: "दो", pyaza: "प्याज़ा", handi: "हांडी",
  saagwala: "सागवाला", kolhapuri: "कोल्हापुरी", hyderabadi: "हैदराबादी", afghani: "अफ़गानी",

  // ---- dishes / snacks ----
  kebab: "कबाब", kabab: "कबाब", seekh: "सीख", tikki: "टिक्की", pakora: "पकौड़ा",
  pakoda: "पकौड़ा", samosa: "समोसा", samosas: "समोसे", chaat: "चाट", bhaji: "भाजी",
  pav: "पाव", vada: "वड़ा", sabzi: "सब्ज़ी", sabji: "सब्ज़ी", dal: "दाल", daal: "दाल",
  rajma: "राजमा", chole: "छोले", chana: "चना", chhole: "छोले", kadhi: "कढ़ी",
  raita: "रायता", papad: "पापड़", achar: "अचार", chutney: "चटनी", manchurian: "मंचूरियन",
  hakka: "हक्का", schezwan: "शेज़वान", spring: "स्प्रिंग", roll: "रोल", rolls: "रोल",
  momo: "मोमो", momos: "मोमोज़", maggi: "मैगी", maggie: "मैगी", omelette: "ऑमलेट", omelet: "ऑमलेट",
  bhurji: "भुर्जी", thali: "थाली", platter: "प्लैटर", combo: "कॉम्बो",

  // ---- breads ----
  roti: "रोटी", naan: "नान", paratha: "पराठा", parantha: "पराठा", kulcha: "कुलचा",
  puri: "पूरी", poori: "पूरी", bhatura: "भटूरा", bhature: "भटूरे", chapati: "चपाती",
  rumali: "रुमाली", lachha: "लच्छा", garlic: "गार्लिक", missi: "मिस्सी", bread: "ब्रेड",

  // ---- rice / staples ----
  rice: "राइस", pulao: "पुलाव", pulav: "पुलाव", biryani: "बिरयानी", biriyani: "बिरयानी",
  khichdi: "खिचड़ी", jeera: "जीरा", fried_rice: "फ़्राइड राइस", curd_rice: "कर्ड राइस",

  // ---- south indian ----
  dosa: "डोसा", idli: "इडली", uttapam: "उत्तपम", upma: "उपमा", poha: "पोहा",
  sambar: "सांभर", sambhar: "सांभर", rasam: "रसम", medu: "मेदू", masaala: "मसाला",

  // ---- fast food ----
  sandwich: "सैंडविच", burger: "बर्गर", pizza: "पिज़्ज़ा", pasta: "पास्ता",
  noodles: "नूडल्स", chowmein: "चाउमीन", fries: "फ़्राइज़", wrap: "रैप", club: "क्लब",
  cheese: "चीज़", toast: "टोस्ट", nuggets: "नगेट्स", patty: "पैटी",

  // ---- sweets / desserts ----
  gulab: "गुलाब", jamun: "जामुन", jalebi: "जलेबी", halwa: "हलवा", kheer: "खीर",
  rasgulla: "रसगुल्ला", rasmalai: "रसमलाई", barfi: "बर्फ़ी", burfi: "बर्फ़ी",
  ladoo: "लड्डू", laddu: "लड्डू", rabri: "रबड़ी", kulfi: "कुल्फ़ी", icecream: "आइसक्रीम",
  ice: "आइस", cream: "क्रीम", falooda: "फालूदा", custard: "कस्टर्ड", brownie: "ब्राउनी",
  cake: "केक", pastry: "पेस्ट्री", pudding: "पुडिंग", dessert: "डेज़र्ट", sweet: "स्वीट",
  sweets: "स्वीट्स", gajar: "गाजर", phirni: "फिरनी", malpua: "मालपुआ",

  // ---- beverages ----
  tea: "टी", chai: "चाय", coffee: "कॉफ़ी", milk: "दूध", lassi: "लस्सी", shake: "शेक",
  milkshake: "मिल्कशेक", juice: "जूस", water: "पानी", soda: "सोडा", cola: "कोला",
  coke: "कोक", sherbet: "शरबत", sharbat: "शरबत", smoothie: "स्मूदी", mojito: "मोहितो",
  mocktail: "मॉकटेल", beer: "बियर", wine: "वाइन", soup: "सूप", buttermilk: "छाछ",
  thandai: "ठंडाई", nimbu: "नींबू", green: "ग्रीन", black: "ब्लैक", hot: "हॉट",
  cold: "कोल्ड", fresh: "फ़्रेश", lime: "लाइम", mint: "मिंट",

  // ---- vegetables / ingredients ----
  aloo: "आलू", potato: "आलू", gobi: "गोभी", gobhi: "गोभी", matar: "मटर", peas: "मटर",
  palak: "पालक", spinach: "पालक", bhindi: "भिंडी", baingan: "बैंगन", brinjal: "बैंगन",
  tamatar: "टमाटर", tomato: "टमाटर", pyaaz: "प्याज़", onion: "प्याज़", mushroom: "मशरूम",
  corn: "कॉर्न", makai: "मक्का", capsicum: "शिमला मिर्च", mirch: "मिर्च", mirchi: "मिर्ची",
  methi: "मेथी", mooli: "मूली", lauki: "लौकी", kaju: "काजू", cashew: "काजू",
  badam: "बादाम", almond: "बादाम", ghee: "घी", dahi: "दही", curd: "दही",
  jeere: "जीरे", adrak: "अदरक", ginger: "अदरक", lehsun: "लहसुन", garlic_clove: "लहसुन",
  lemon: "नींबू", namak: "नमक", salt: "नमक", sugar: "चीनी", nariyal: "नारियल",
  coconut: "नारियल", atta: "आटा", sooji: "सूजी", besan: "बेसन", maida: "मैदा",

  // ---- meal sections / sizes ----
  breakfast: "ब्रेकफास्ट", lunch: "लंच", dinner: "डिनर", snacks: "स्नैक्स", snack: "स्नैक",
  starter: "स्टार्टर", starters: "स्टार्टर्स", salad: "सलाद", main: "मेन", course: "कोर्स",
  special: "स्पेशल", meal: "मील", mini: "मिनी", jumbo: "जंबो", regular: "रेगुलर",
  half: "हाफ़", full: "फुल", plate: "प्लेट", bowl: "बाउल", glass: "ग्लास", cup: "कप",
  kids: "किड्स", platter_: "प्लैटर", assorted: "एसॉर्टेड", mixed: "मिक्स्ड", mix: "मिक्स",

  // ---- service catalog (for the services tab suggestions) ----
  room: "रूम", service: "सर्विस", cleaning: "क्लीनिंग", housekeeping: "हाउसकीपिंग",
  laundry: "लॉन्ड्री", towel: "तौलिया", towels: "तौलिए", extra: "एक्स्ट्रा", late: "लेट",
  checkout: "चेकआउट", checkin: "चेकइन", key: "की", card: "कार्ड", wifi: "वाई-फ़ाई",
  ac: "एसी", electric: "इलेक्ट्रिक", electrical: "इलेक्ट्रिकल", plumbing: "प्लंबिंग",
  maintenance: "मेंटेनेंस", request: "रिक्वेस्ट", pickup: "पिकअप", drop: "ड्रॉप",
  taxi: "टैक्सी", cab: "कैब", doctor: "डॉक्टर", medicine: "दवा", iron: "आयरन",
  ironing: "आयरनिंग", bottle: "बोतल", blanket: "कंबल", pillow: "तकिया", bed: "बेड",
  turndown: "टर्नडाउन", cutlery: "कटलरी", missing: "मिसिंग", issue: "इशू",
  delivery: "डिलीवरी", food: "फ़ूड", order: "ऑर्डर", amenities: "एमेनिटीज़",
};

/**
 * Look up a single lowercase token in the curated dictionary.
 * Returns the Devanagari form or null if not found.
 */
export function lookupHindiToken(token: string): string | null {
  const key = token.toLowerCase();
  return Object.prototype.hasOwnProperty.call(HINDI_MENU_DICT, key)
    ? HINDI_MENU_DICT[key]
    : null;
}
