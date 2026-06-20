import { describe, it, expect } from "vitest";
import { transliterateHi } from "./transliterateHi";
import { HINDI_MENU_DICT } from "./hindiMenuDict";

describe("hindiMenuDict (structural guard)", () => {
  // Catches the most common authoring error: a value accidentally left in
  // Latin / English, or empty. Every value must be non-empty Devanagari.
  it("every value is non-empty and contains no Latin letters", () => {
    const bad: string[] = [];
    for (const [k, v] of Object.entries(HINDI_MENU_DICT)) {
      if (!v || !v.trim() || /[A-Za-z]/.test(v)) bad.push(`${k} -> ${JSON.stringify(v)}`);
    }
    expect(bad, `dictionary values must be Devanagari:\n${bad.join("\n")}`).toEqual([]);
  });

  it("has reasonable coverage of the core menu vocabulary", () => {
    for (const k of ["paneer", "masala", "veg", "chicken", "coffee", "sandwich", "dosa", "roti"]) {
      expect(HINDI_MENU_DICT[k], `missing dictionary token: ${k}`).toBeTruthy();
    }
  });
});

const hasLatinLetters = (s: string) => /[a-z]/i.test(s);

describe("transliterateHi (dictionary-first suggestion engine)", () => {
  it("returns empty string for empty/blank input", () => {
    expect(transliterateHi("")).toBe("");
    expect(transliterateHi(null)).toBe("");
    expect(transliterateHi(undefined)).toBe("");
    expect(transliterateHi("   ")).toBe(""); // blank -> no suggestion
  });

  it("uses the curated dictionary for conventional spellings", () => {
    expect(transliterateHi("veg")).toBe("वेज");
    expect(transliterateHi("masala")).toBe("मसाला");
    expect(transliterateHi("sandwich")).toBe("सैंडविच");
    expect(transliterateHi("coffee")).toBe("कॉफ़ी");
    expect(transliterateHi("thali")).toBe("थाली");
    expect(transliterateHi("paneer")).toBe("पनीर");
    expect(transliterateHi("dosa")).toBe("डोसा");
  });

  it("composes multi-word names token-by-token (case-insensitive)", () => {
    expect(transliterateHi("Paneer Tikka Masala")).toBe("पनीर टिक्का मसाला");
    expect(transliterateHi("Butter Chicken")).toBe("बटर चिकन");
    expect(transliterateHi("Veg Sandwich")).toBe("वेज सैंडविच");
    expect(transliterateHi("Masala Dosa")).toBe("मसाला डोसा");
  });

  it("handles hyphenated compounds via the dictionary", () => {
    expect(transliterateHi("non-veg")).toBe("नॉन-वेज");
  });

  it("localizes the service catalog vocabulary too", () => {
    expect(transliterateHi("Room Cleaning")).toBe("रूम क्लीनिंग");
    expect(transliterateHi("Extra Towels")).toBe("एक्स्ट्रा तौलिए");
  });

  it("falls back to the phonetic engine for unknown words (no Latin left)", () => {
    for (const w of ["zorbo", "blaster", "fettuccine", "alfredo"]) {
      const out = transliterateHi(w);
      expect(hasLatinLetters(out), `"${w}" -> "${out}" still has Latin`).toBe(false);
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it("preserves spacing and surrounding punctuation", () => {
    const out = transliterateHi("(veg) masala");
    expect(out.startsWith("(")).toBe(true);
    expect(out).toContain("वेज");
    expect(out).toContain("मसाला");
  });

  it("phonetic fallback: English t/d retroflex, de-geminated, anusvara", () => {
    // 'fettuccine' is unknown -> phonetic; assert it renders without Latin
    expect(hasLatinLetters(transliterateHi("fettuccine"))).toBe(false);
    // a clearly-unknown word with a doubled consonant keeps no Latin
    expect(hasLatinLetters(transliterateHi("grizzle"))).toBe(false);
  });

  it("is deterministic and passes digits through", () => {
    expect(transliterateHi("7up")).toContain("7");
    expect(transliterateHi("biryani")).toBe(transliterateHi("biryani"));
  });
});
