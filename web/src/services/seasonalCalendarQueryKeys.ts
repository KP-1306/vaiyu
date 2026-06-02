// web/src/services/seasonalCalendarQueryKeys.ts
//
// Centralised TanStack Query keys for the Seasonal Demand Calendar.

export const seasonalCalendarQueryKeys = {
  list: (hotelId: string) => ['seasonal-windows', hotelId] as const,
  timeline: (hotelId: string, windowCode: string, seasonYear: number) =>
    ['seasonal-window-timeline', hotelId, windowCode, seasonYear] as const,
  hotelByslug: (slug: string) => ['seasonal-card-hotel', slug] as const,
} as const;
