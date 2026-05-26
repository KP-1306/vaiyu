// web/src/services/leadQueryKeys.ts
//
// Centralized TanStack Query keys for all lead-related caches.
//
// Why centralize: realtime invalidation (useLeadsRealtime, useLeadEventsRealtime)
// needs to know every key that could be affected by a lead event. As new
// views are added (Day 11 dashboard widget, future analytics), they MUST be
// added here so invalidation stays consistent. Drift = stale UI.
//
// Convention: each key function returns a readonly tuple representing the
// PREFIX. Consumers compose with additional arguments where needed:
//
//   ['leads', hotelId, filters, page]           // list view (Day 7)
//   ['leads-kanban', hotelId, status, filters]  // kanban (Day 8)
//
// Prefix-match invalidation (TanStack default) means invalidating the prefix
// hits all subkeys.

export const leadQueryKeys = {
  /** Hotel-wide leads list (Day 7). Composed with filters + page. */
  list: (hotelId: string) => ['leads', hotelId] as const,

  /** Hotel-wide kanban (Day 8). Composed with status + base filters. */
  kanban: (hotelId: string) => ['leads-kanban', hotelId] as const,

  /** Dashboard "open leads" summary widget (Day 11). */
  openSummary: (hotelId: string) => ['leads-open-summary', hotelId] as const,

  /** Single lead row (Day 9 drawer). */
  detail: (leadId: string) => ['lead', leadId] as const,

  /** Per-lead event timeline (Day 9). */
  events: (leadId: string) => ['lead-events', leadId] as const,

  /** Per-lead claim status (Day 9). */
  claim: (leadId: string) => ['lead-claim', leadId] as const,

  /** Hotel rooms (used by Day 10 convert modal). */
  rooms: (hotelId: string) => ['rooms', hotelId] as const,
} as const;

/**
 * All hotel-level keys that should be invalidated on hotel-wide events
 * (CREATED, STATUS_CHANGED, ASSIGNED, etc. — anything that changes the
 * shape of the list/kanban/summary).
 *
 * Used by useLeadsRealtime's invalidation logic.
 */
export function getHotelInvalidationKeys(hotelId: string): readonly (readonly unknown[])[] {
  return [
    leadQueryKeys.list(hotelId),
    leadQueryKeys.kanban(hotelId),
    leadQueryKeys.openSummary(hotelId),
  ];
}

/**
 * All per-lead keys to invalidate when a specific lead changes.
 */
export function getLeadInvalidationKeys(leadId: string): readonly (readonly unknown[])[] {
  return [
    leadQueryKeys.detail(leadId),
    leadQueryKeys.events(leadId),
    leadQueryKeys.claim(leadId),
  ];
}
