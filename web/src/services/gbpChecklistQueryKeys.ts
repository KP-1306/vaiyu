// web/src/services/gbpChecklistQueryKeys.ts
//
// TanStack Query key factory for Google Business Checklist.

export const gbpChecklistQueryKeys = {
  all: ['gbp-checklist'] as const,
  hotel: (hotelId: string) => ['gbp-checklist', hotelId] as const,
  attestations: (hotelId: string) => ['gbp-checklist', hotelId, 'attestations'] as const,
  readiness: (hotelId: string) => ['gbp-checklist', hotelId, 'readiness'] as const,
};
