// web/src/services/otaOptimizerQueryKeys.ts
//
// TanStack Query key factory for the OTA Listing Optimizer. Centralised so
// the realtime invalidation hook can hit consistent keys.

export const otaOptimizerQueryKeys = {
  all: ['ota-optimizer'] as const,
  hotel: (hotelId: string) => ['ota-optimizer', hotelId] as const,
  summary: (hotelId: string) => ['ota-optimizer', hotelId, 'summary'] as const,
  byOta: (hotelId: string) => ['ota-optimizer', hotelId, 'by-ota'] as const,
  settings: (hotelId: string) => ['ota-optimizer', hotelId, 'settings'] as const,
  state: (hotelId: string) => ['ota-optimizer', hotelId, 'state'] as const,
};
