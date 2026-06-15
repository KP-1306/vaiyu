import { describe, it, expect } from "vitest";
import { localizeRoomType, localizeRoomTypeList } from "./localizeRoomType";

describe("localizeRoomType", () => {
  it("passes English (and any non-hi lang) through unchanged", () => {
    expect(localizeRoomType("Standard Room", "en")).toBe("Standard Room");
    expect(localizeRoomType("Deluxe Room", "fr")).toBe("Deluxe Room");
  });

  it("transliterates the common catalog in hi", () => {
    expect(localizeRoomType("Standard Room", "hi")).toBe("स्टैंडर्ड रूम");
    expect(localizeRoomType("Deluxe Room", "hi")).toBe("डीलक्स रूम");
    expect(localizeRoomType("Suite", "hi")).toBe("सुइट");
  });

  it("fully covers the real DB room-type catalog (no Latin leftovers)", () => {
    // These are the distinct room_types.name values present in the seed/prod data.
    const catalog = [
      "Accessible", "Connecting", "Deluxe", "Dormitory", "Double", "Executive",
      "Executive Suite", "Family", "Junior Suite", "Premium", "Presidential",
      "Presidential Suite", "Standard", "Studio", "Suite", "Superior", "Twin",
    ];
    for (const name of catalog) {
      const hi = localizeRoomType(name, "hi");
      expect(hi, `'${name}' should have no Latin leftovers`).not.toMatch(/[A-Za-z]/);
    }
  });

  it("is compositional across multi-word names", () => {
    expect(localizeRoomType("Super Deluxe Room", "hi")).toBe("सुपर डीलक्स रूम");
    expect(localizeRoomType("Deluxe Valley View Room", "hi")).toBe(
      "डीलक्स वैली व्यू रूम",
    );
    expect(localizeRoomType("Family Suite", "hi")).toBe("फैमिली सुइट");
  });

  it("keeps unknown tokens verbatim (partial localization / raw fallback)", () => {
    // 'Zenith' is not in the catalog -> kept; 'Room' -> localized
    expect(localizeRoomType("Zenith Room", "hi")).toBe("Zenith रूम");
    // fully custom / non-catalog name degrades to the original string
    expect(localizeRoomType("Himalaya Nest", "hi")).toBe("Himalaya Nest");
  });

  it("is case-insensitive and preserves the original whitespace", () => {
    expect(localizeRoomType("STANDARD ROOM", "hi")).toBe("स्टैंडर्ड रूम");
    expect(localizeRoomType("standard   room", "hi")).toBe("स्टैंडर्ड   रूम");
  });

  it("handles hyphenated and punctuated modifiers", () => {
    expect(localizeRoomType("Non-AC Room", "hi")).toBe("नॉन-एसी रूम");
    expect(localizeRoomType("Deluxe (AC)", "hi")).toBe("डीलक्स (एसी)");
  });

  it("returns empty string for nullish input", () => {
    expect(localizeRoomType(null, "hi")).toBe("");
    expect(localizeRoomType(undefined, "hi")).toBe("");
  });
});

describe("localizeRoomTypeList", () => {
  it("maps each name then joins with comma", () => {
    expect(localizeRoomTypeList(["Standard Room", "Deluxe Room"], "hi")).toBe(
      "स्टैंडर्ड रूम, डीलक्स रूम",
    );
  });

  it("localizes the fallback when the list is empty/missing", () => {
    expect(localizeRoomTypeList([], "hi", "Standard Room")).toBe("स्टैंडर्ड रूम");
    expect(localizeRoomTypeList(null, "hi", "Standard Room")).toBe(
      "स्टैंडर्ड रूम",
    );
    expect(localizeRoomTypeList(undefined, "en", "Standard Room")).toBe(
      "Standard Room",
    );
  });
});
