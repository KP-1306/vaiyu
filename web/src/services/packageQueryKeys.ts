// web/src/services/packageQueryKeys.ts
//
// Centralised TanStack Query keys for Experience Packages.

export const packageQueryKeys = {
  list: (hotelId: string) => ['packages', hotelId] as const,
  active: (hotelId: string) => ['packages', hotelId, 'active'] as const,
  detail: (id: string) => ['package', id] as const,
  events: (id: string) => ['package-events', id] as const,
  analytics: (hotelId: string, days: number) =>
    ['package-analytics', hotelId, days] as const,
  publicLanding: (hotelSlug: string, packageSlug: string) =>
    ['package-public', hotelSlug, packageSlug] as const,
} as const;

export function getHotelPackageInvalidationKeys(
  hotelId: string,
): readonly (readonly unknown[])[] {
  return [
    ['packages', hotelId],
    ['packages', hotelId, 'active'],
    ['package-analytics', hotelId],
  ];
}
