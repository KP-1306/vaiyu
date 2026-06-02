// web/src/services/visibilityScoreQueryKeys.ts
//
// Centralised TanStack Query keys for Visibility Score.

export const visibilityScoreQueryKeys = {
  score:   (hotelId: string)         => ['visibility-score', hotelId] as const,
  history: (hotelId: string, n: number) => ['visibility-history', hotelId, n] as const,
  cronHealth: (hotelId: string)      => ['visibility-cron-health', hotelId] as const,
  attestations: (hotelId: string)    => ['visibility-attestations', hotelId] as const,
} as const;
