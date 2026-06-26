import { describe, it, expect } from "vitest";
import { localizeAmenity } from "./localizeAmenity";

// The closed catalogue the owner toggles in onboarding (HotelOnboarding
// AMENITY_LIST). Every entry must have a Hindi display so a guest never sees a
// raw English amenity in Hindi mode.
const AMENITY_LIST = [
  "Wi-Fi", "Pool", "Spa", "Gym", "Restaurant", "Bar", "Room Service",
  "Parking", "Airport Shuttle", "Laundry", "AC", "Pet Friendly",
  "Business Center", "Concierge", "EV Charging", "Kids Club",
];

describe("localizeAmenity", () => {
  it("English is unchanged", () => {
    for (const a of AMENITY_LIST) expect(localizeAmenity(a, "en")).toBe(a);
  });

  it("every catalogue amenity resolves in Hindi", () => {
    for (const a of AMENITY_LIST) {
      const hi = localizeAmenity(a, "hi");
      // Tech/brand terms stay English on purpose; everything else must change.
      const retained = ["Wi-Fi", "AC", "EV Charging"];
      if (retained.includes(a)) {
        // still resolved (present in the map), just retained/partly English
        expect(hi).toBeTruthy();
      } else {
        expect(hi).not.toBe(a);
        expect(/[ऀ-ॿ]/.test(hi)).toBe(true); // contains Devanagari
      }
    }
  });

  it("normalises label variants to one entry", () => {
    expect(localizeAmenity("WiFi", "hi")).toBe(localizeAmenity("Wi-Fi", "hi"));
    expect(localizeAmenity("room service", "hi")).toBe(localizeAmenity("Room Service", "hi"));
  });

  it("passes through unknown / custom values + handles hi-IN", () => {
    expect(localizeAmenity("Rooftop Helipad", "hi")).toBe("Rooftop Helipad");
    expect(localizeAmenity("Pool", "hi-IN-u-nu-latn")).toBe(localizeAmenity("Pool", "hi"));
    expect(localizeAmenity("", "hi")).toBe("");
    expect(localizeAmenity(null, "hi")).toBe("");
  });
});
