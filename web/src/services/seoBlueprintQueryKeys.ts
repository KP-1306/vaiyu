// web/src/services/seoBlueprintQueryKeys.ts
//
// Centralised TanStack Query keys for the Local SEO Landing Planner.

export const seoBlueprintQueryKeys = {
  list: (hotelId: string) => ['seo-blueprints', hotelId] as const,
  detail: (id: string) => ['seo-blueprint', id] as const,
  events: (id: string) => ['seo-blueprint-events', id] as const,
  summary: (hotelId: string) => ['seo-blueprint-summary', hotelId] as const,
} as const;
