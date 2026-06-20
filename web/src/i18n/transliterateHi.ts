// transliterateHi — offline, dependency-free Latin→Devanagari phonetic
// transliteration used ONLY to pre-fill an editable "suggestion" in owner
// forms. It is never shown to a guest without the owner reviewing/saving it,
// and there is NO translation API (per product constraint). The owner is the
// human-in-the-loop: the suggestion is a starting point they confirm or edit.
//
// This is phonetic (sound-based), not a name dictionary — we deliberately do
// NOT keep a fixed map of dish names (a partial food dictionary reads worse
// than none; see project notes). For canonical hospitality vocabulary
// (room types) the caller uses localizeRoomType() instead; this engine is the
// open-vocabulary fallback for dish / custom-service names.
//
// PRIMARY path is the curated dictionary (hindiMenuDict) — looked up per token,
// composed word-by-word — because conventional spellings (वेज, कॉफ़ी, सैंडविच,
// मसाला, थाली) are NOT derivable by rules. This phonetic engine is only the
// FALLBACK for tokens the dictionary doesn't know (brand names, rare words).
//
// English orthography is not phonemic, so the fallback can never be perfect,
// but a few high-impact rules get unknown words close:
//   - English t/d are rendered RETROFLEX (ट/ड), the way loanwords actually read
//     in Hindi (बटर, सैंडविच, टी) — dental त/द reads foreign.
//   - Doubled consonants are de-geminated (butter→बटर, coffee→कॉफी), since the
//     doubling is an English spelling artefact, not Hindi gemination.
//   - 'n'/'m' before a consonant become anusvāra (lunch→लंच, sandwich→संडविच).
//   - The inherent schwa is used for most mid-word 'a'/'u' (club→क्लब,
//     butter→बटर), while a FINAL vowel takes its long form (dosa→डोसा,
//     gobi→गोबी, menu→मेनू, masala→मसला).
// Edge cases (silent 'e', stressed long vowels, soft 'g') stay rough — that's
// why it's a labelled, editable "suggestion".

import { lookupHindiToken } from "./hindiMenuDict";

const VIRAMA = "्"; // halant — suppresses the inherent vowel
const ANUSVARA = "ं";

// Consonant clusters (longest match wins). 'h' is excluded from de-gemination
// so these digraphs survive.
const CONS_DIGRAPHS: Array<[string, string]> = [
  ["chh", "छ"],
  ["sh", "श"],
  ["ch", "च"],
  ["th", "थ"], // English θ/ð → dental aspirate (standard: think→थिंक)
  ["dh", "ध"],
  ["ph", "फ"],
  ["bh", "भ"],
  ["gh", "घ"],
  ["kh", "ख"],
  ["jh", "झ"],
  ["ck", "क"],
  ["wh", "व"],
];

// Single consonants. English t/d are retroflex (ट/ड) — the loanword register.
const CONS_SINGLE: Record<string, string> = {
  t: "ट",
  d: "ड",
  k: "क",
  g: "ग",
  c: "क", // soft 'c' (→ स before e/i/y) handled separately
  j: "ज",
  n: "न",
  p: "प",
  b: "ब",
  m: "म",
  y: "य",
  r: "र",
  l: "ल",
  v: "व",
  w: "व",
  s: "स",
  h: "ह",
  f: "फ",
  z: "ज़",
  x: "क्स",
  q: "क",
};

const CONSONANT_LETTERS = new Set("bcdfgjklmnpqrstvwxyz".split("")); // for cluster/nasal tests (h excluded)

type VowelForms = { indep: string; matra: string };

// Multi-letter vowels (longest match wins) — position-independent.
const VOWEL_DIGRAPHS: Array<[string, VowelForms]> = [
  ["aa", { indep: "आ", matra: "ा" }],
  ["ai", { indep: "ऐ", matra: "ै" }],
  ["ay", { indep: "ए", matra: "े" }],
  ["au", { indep: "औ", matra: "ौ" }],
  ["aw", { indep: "ऑ", matra: "ॉ" }],
  ["ee", { indep: "ई", matra: "ी" }],
  ["ea", { indep: "ई", matra: "ी" }],
  ["ey", { indep: "ए", matra: "े" }],
  ["oo", { indep: "ऊ", matra: "ू" }],
  ["oa", { indep: "ओ", matra: "ो" }],
  ["ou", { indep: "ऊ", matra: "ू" }],
  ["ow", { indep: "ओ", matra: "ो" }],
];

const isCons = (ch: string | undefined) => !!ch && CONSONANT_LETTERS.has(ch);

// Single-vowel forms; FINAL vowels take the long form (dosa→डोसा, gobi→गोबी,
// menu→मेनू, masala→मसला). Mid-word 'a'/'u' use the inherent schwa.
function singleVowel(ch: string, isFinal: boolean): VowelForms {
  switch (ch) {
    case "a":
      return isFinal ? { indep: "आ", matra: "ा" } : { indep: "अ", matra: "" };
    case "i":
      return isFinal ? { indep: "ई", matra: "ी" } : { indep: "इ", matra: "ि" };
    case "u":
      return isFinal ? { indep: "ऊ", matra: "ू" } : { indep: "अ", matra: "" };
    case "e":
      return { indep: "ए", matra: "े" };
    case "o":
      return { indep: "ओ", matra: "ो" };
    default:
      return { indep: "", matra: "" };
  }
}

function startsWith(s: string, i: number, p: string): boolean {
  return s.startsWith(p, i);
}

// De-geminate doubled consonant letters (English spelling artefact). Vowels and
// 'h' are preserved so vowel digraphs and 'chh' survive.
function deGeminate(word: string): string {
  return word.replace(/([bcdfgjklmnpqrstvwxyz])\1+/g, "$1");
}

function transliterateTokenPhonetic(raw: string): string {
  const word = deGeminate(raw.toLowerCase());
  let out = "";
  let i = 0;
  let pendingConsonant = false; // a consonant awaits its vowel/cluster

  const emitVowel = (forms: VowelForms) => {
    out += pendingConsonant ? forms.matra : forms.indep;
    pendingConsonant = false;
  };
  const emitConsonant = (dev: string) => {
    if (pendingConsonant) out += VIRAMA;
    out += dev;
    pendingConsonant = true;
  };

  while (i < word.length) {
    const ch = word[i];
    const next = word[i + 1];
    const isLast = i === word.length - 1;

    // 'er' before a consonant or word end → schwa + र (butter→बटर, dinner→डिनर)
    if (ch === "e" && next === "r" && (i + 2 >= word.length || isCons(word[i + 2]))) {
      // 'e' is a schwa here: drop its vowel, let the following 'r' attach.
      pendingConsonant = false;
      i += 1;
      continue;
    }

    // Vowel digraphs
    let vd: [string, VowelForms] | undefined;
    for (const v of VOWEL_DIGRAPHS) {
      if (startsWith(word, i, v[0])) { vd = v; break; }
    }
    if (vd) {
      emitVowel(vd[1]);
      i += vd[0].length;
      continue;
    }

    // Single vowels (a e i o u). 'y' is handled as a vowel only after a consonant.
    if ("aeiou".includes(ch)) {
      emitVowel(singleVowel(ch, isLast));
      i += 1;
      continue;
    }
    if (ch === "y" && pendingConsonant) {
      // consonantal-cluster 'y' acts as a vowel: curry→करी, city→सिटी
      emitVowel(isLast ? { indep: "ई", matra: "ी" } : { indep: "इ", matra: "ि" });
      i += 1;
      continue;
    }

    // Nasal 'n'/'m' before a consonant (and after a vowel) → anusvāra
    if ((ch === "n" || ch === "m") && !pendingConsonant && isCons(next)) {
      out += ANUSVARA;
      i += 1;
      continue;
    }

    // Consonant digraphs
    let cd: [string, string] | undefined;
    for (const c of CONS_DIGRAPHS) {
      if (startsWith(word, i, c[0])) { cd = c; break; }
    }
    if (cd) {
      emitConsonant(cd[1]);
      i += cd[0].length;
      continue;
    }

    // Single consonants
    if (ch in CONS_SINGLE) {
      // soft 'c' → स before e/i/y
      const dev = ch === "c" && (next === "e" || next === "i" || next === "y") ? "स" : CONS_SINGLE[ch];
      emitConsonant(dev);
      i += 1;
      continue;
    }

    // word-initial / post-vowel 'y' as a consonant (yoga→योगा)
    if (ch === "y") {
      emitConsonant("य");
      i += 1;
      continue;
    }

    // Unknown char (digit, punctuation): emit verbatim, reset state.
    out += ch;
    pendingConsonant = false;
    i += 1;
  }

  return out;
}

// Resolve one whitespace-delimited word: curated dictionary first (handling
// surrounding punctuation and hyphenated compounds like "non-veg"), then the
// phonetic engine as a fallback for anything the dictionary doesn't know.
function suggestWord(word: string): string {
  // Split off leading/trailing punctuation so "(veg)" still resolves "veg".
  const m = word.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
  const [, pre, core, post] = m ?? [null, "", word, ""];
  if (!core) return word;

  // Hyphenated compound (non-veg, sub-zero): resolve each part.
  if (core.includes("-")) {
    const joined = core
      .split("-")
      .map((p) => (p ? resolveCore(p) : p))
      .join("-");
    return `${pre}${joined}${post}`;
  }
  return `${pre}${resolveCore(core)}${post}`;
}

function resolveCore(core: string): string {
  return lookupHindiToken(core) ?? transliterateTokenPhonetic(core);
}

/**
 * Suggest a Hindi (Devanagari) rendering for an owner-authored name.
 * Dictionary-first, composed word-by-word, phonetic fallback for unknown words.
 * Preserves spacing. Returns "" for empty input. Suggestion only — the owner
 * reviews and edits before saving; it is never auto-shown to a guest.
 */
export function transliterateHi(name: string | null | undefined): string {
  if (!name || !name.trim()) return "";
  return name
    .split(/(\s+)/)
    .map((tok) => (/^\s+$/.test(tok) || tok === "" ? tok : suggestWord(tok)))
    .join("");
}
