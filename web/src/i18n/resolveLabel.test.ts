import { describe, it, expect } from "vitest";
import { resolveLabel, localizeServiceName } from "./resolveLabel";

describe("localizeServiceName", () => {
  // Fake t: returns a canonical Hindi only for the known room_cleaning key.
  const t = (key: string, opts?: { defaultValue?: string }) =>
    key === "foodMenu:service.room_cleaning.title" ? "रूम की सफाई" : (opts?.defaultValue ?? key);

  it("English returns the as-authored label", () => {
    expect(localizeServiceName(t, "en", { key: "room_cleaning", label: "Room Cleaning", name_i18n: {} })).toBe("Room Cleaning");
  });

  it("Hindi uses the canonical key when there's no owner override", () => {
    expect(localizeServiceName(t, "hi", { key: "room_cleaning", label: "Room Cleaning", name_i18n: {} })).toBe("रूम की सफाई");
  });

  it("owner override beats the canonical key in Hindi", () => {
    expect(localizeServiceName(t, "hi", { key: "room_cleaning", label: "Room Cleaning", name_i18n: { hi: "कमरा सफ़ाई" } })).toBe("कमरा सफ़ाई");
  });

  it("custom service with no canonical key falls back to the label in Hindi", () => {
    expect(localizeServiceName(t, "hi", { key: "balloon_setup", label: "Balloon Setup", name_i18n: {} })).toBe("Balloon Setup");
  });
});

describe("resolveLabel", () => {
  it("English always returns the fallback, even when a Hindi override exists", () => {
    expect(resolveLabel({ hi: "पनीर टिक्का" }, "en", "Paneer Tikka")).toBe("Paneer Tikka");
    expect(resolveLabel({ en: "Override EN", hi: "हिं" }, "en", "As Authored")).toBe("As Authored");
  });

  it("Hindi returns the override when present and non-empty", () => {
    expect(resolveLabel({ hi: "पनीर टिक्का" }, "hi", "Paneer Tikka")).toBe("पनीर टिक्का");
  });

  it("Hindi falls back when there is no override (empty map = current behaviour)", () => {
    expect(resolveLabel({}, "hi", "Paneer Tikka")).toBe("Paneer Tikka");
    expect(resolveLabel(null, "hi", "Paneer Tikka")).toBe("Paneer Tikka");
    expect(resolveLabel(undefined, "hi", "Paneer Tikka")).toBe("Paneer Tikka");
  });

  it("Hindi falls back when the override is empty or whitespace-only", () => {
    expect(resolveLabel({ hi: "" }, "hi", "Paneer Tikka")).toBe("Paneer Tikka");
    expect(resolveLabel({ hi: "   " }, "hi", "Paneer Tikka")).toBe("Paneer Tikka");
  });

  it("treats regional subtags by their base (hi-IN -> hi, en-US -> en)", () => {
    expect(resolveLabel({ hi: "हिं" }, "hi-IN", "EN")).toBe("हिं");
    expect(resolveLabel({ hi: "हिं" }, "en-US", "EN")).toBe("EN");
  });

  it("ignores languages with no override key (falls back)", () => {
    expect(resolveLabel({ hi: "हिं" }, "fr", "Fallback")).toBe("Fallback");
  });

  it("fallback is honoured for empty strings without throwing", () => {
    expect(resolveLabel({}, "hi", "")).toBe("");
    expect(resolveLabel({ hi: "हिं" }, "", "EN")).toBe("EN"); // missing lang -> base 'en'
  });

  it("does not trim a real override value", () => {
    expect(resolveLabel({ hi: "  पनीर  टिक्का  " }, "hi", "x")).toBe("  पनीर  टिक्का  ");
  });
});
