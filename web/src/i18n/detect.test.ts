import { describe, it, expect } from "vitest";
import { isInStayGuestEntry } from "./detect";

// The in-stay carve-out (resolveInitialLanguage step 3) honours the device
// language ONLY when the first page loaded is a personal-device guest surface.
// This guard locks exactly which routes opt in, so a future route rename can't
// silently (a) start auto-detecting Hindi on marketing/owner/staff pages, or
// (b) stop auto-detecting on a real guest QR screen.
describe("isInStayGuestEntry", () => {
  it("returns true for in-stay guest surfaces (room-QR / guest deep-links)", () => {
    const inStay = [
      "/guest",
      "/guest/trips",
      "/guest/stay/abc123",
      "/guest/request-service",
      "/guest/bills",
      "/scan",
      "/hotel/hotel-demo-one",
      "/menu",
      "/stay/WLK-123/menu",
      "/stay/WLK-123/orders",
      "/bill",
      "/checkout",
      "/precheckin/some-token",
      "/feedback/some-token",
      "/regcard",
      "/claim",
      "/requestTracker",
      "/track/DISP-9",
      "/track-order/42",
    ];
    for (const p of inStay) {
      expect(isInStayGuestEntry(p), p).toBe(true);
    }
  });

  it("returns false for marketing, owner, staff/admin, kiosk and enquiry routes", () => {
    const english = [
      "/",
      "/about",
      "/about-ai",
      "/press",
      "/privacy",
      "/terms",
      "/contact",
      "/careers",
      "/status",
      "/thanks",
      "/signin",
      "/owner",
      "/owner/register",
      "/owner/tenant1/arrivals",
      "/admin/platform",
      "/desk",
      "/hk",
      "/kitchen",
      "/checkin", // staff-operated kiosk, not a guest's phone
      "/checkin/booking",
      "/p/tenant1/enquire", // pre-stay enquiry funnel
      "/p/tenant1/package/winter",
    ];
    for (const p of english) {
      expect(isInStayGuestEntry(p), p).toBe(false);
    }
  });

  it("handles empty / root pathname safely", () => {
    expect(isInStayGuestEntry("")).toBe(false);
    expect(isInStayGuestEntry("/")).toBe(false);
  });
});
