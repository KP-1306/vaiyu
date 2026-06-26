// web/src/config/amenities.ts
//
// Single source of truth for the hotel-amenity catalogue. The owner toggles
// these during onboarding (HotelOnboarding) and the selected ENGLISH strings
// are stored in `hotels.amenities` (the canonical code — also what the
// amenity-icon lookup substring-matches on).
//
// Adding an amenity here is the ONLY way the catalogue grows. A CI coverage
// test (localizeAmenity.test.ts) asserts every entry has a curated Hindi
// display, so a new amenity can never silently ship as English on the Hindi
// guest portal. See localizeAmenity.ts for the display map + rationale.
export const AMENITY_CATALOG = [
  "Wi-Fi", "Pool", "Spa", "Gym", "Restaurant", "Bar", "Room Service",
  "Parking", "Airport Shuttle", "Laundry", "AC", "Pet Friendly",
  "Business Center", "Concierge", "EV Charging", "Kids Club",
] as const;
