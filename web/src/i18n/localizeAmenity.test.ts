import { describe, it, expect } from "vitest";
import { localizeAmenity, hasAmenityHindi } from "./localizeAmenity";
import { AMENITY_CATALOG } from "../config/amenities";

describe("localizeAmenity", () => {
  it("English is unchanged", () => {
    for (const a of AMENITY_CATALOG) expect(localizeAmenity(a, "en")).toBe(a);
  });

  // COVERAGE GUARD: every catalogue amenity must have a curated Hindi entry, so
  // adding a new amenity to config/amenities.ts WITHOUT a translation fails CI
  // instead of silently rendering English on the Hindi guest portal.
  it("every catalogue amenity has a Hindi display", () => {
    const missing = AMENITY_CATALOG.filter((a) => !hasAmenityHindi(a));
    expect(missing, `add Hindi for these in localizeAmenity.ts: ${missing.join(", ")}`).toEqual([]);
  });

  it("non-retained amenities render in Devanagari", () => {
    // Tech/brand terms stay English on purpose; everything else must change.
    const retained = new Set(["Wi-Fi", "AC", "EV Charging"]);
    for (const a of AMENITY_CATALOG) {
      if (retained.has(a)) continue;
      const hi = localizeAmenity(a, "hi");
      expect(hi).not.toBe(a);
      expect(/[ऀ-ॿ]/.test(hi), `${a} -> ${hi}`).toBe(true);
    }
  });

  it("normalises label variants to one entry", () => {
    expect(localizeAmenity("WiFi", "hi")).toBe(localizeAmenity("Wi-Fi", "hi"));
    expect(localizeAmenity("room service", "hi")).toBe(localizeAmenity("Room Service", "hi"));
  });

  it("passes through unknown / custom free-text values + handles hi-IN", () => {
    // Custom amenities (e.g. typed into the OwnerSettings CSV) degrade to the
    // stored string rather than breaking.
    expect(localizeAmenity("Rooftop Helipad", "hi")).toBe("Rooftop Helipad");
    expect(localizeAmenity("Pool", "hi-IN-u-nu-latn")).toBe(localizeAmenity("Pool", "hi"));
    expect(localizeAmenity("", "hi")).toBe("");
    expect(localizeAmenity(null, "hi")).toBe("");
  });
});
