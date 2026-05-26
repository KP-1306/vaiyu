// web/src/hooks/useLeadsRealtime.ts
//
// Hotel-wide realtime subscription on lead_events. Invalidates TanStack Query
// caches so list/kanban views re-fetch on any relevant change.
//
// Filters at the channel level by hotel_id. Event-type filtering happens
// client-side because Supabase realtime `filter` doesn't reliably support
// `in (...)` on enum columns across versions.
//
// We only invalidate caches for event types that drive list/kanban UI:
//   CREATED, STATUS_CHANGED, ASSIGNED, UNASSIGNED, CLAIMED, CLAIM_RELEASED,
//   CONVERTED_TO_BOOKING, SOFT_DELETED, REOPENED.
// Note edits, tag changes, basics updates are intentionally skipped — they're
// fetched on-demand when LeadDetail opens.

import { useEffect, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { addBreadcrumb } from '../lib/monitoring';
import type { LeadEventType } from '../types/lead';
import {
  getHotelInvalidationKeys,
  getLeadInvalidationKeys,
} from '../services/leadQueryKeys';

export type RealtimeConnectionState = 'connecting' | 'open' | 'error';

/** Event types that should invalidate the hotel-wide leads list / kanban. */
export const LIST_INVALIDATING_EVENT_TYPES = new Set<LeadEventType>([
  'CREATED',
  'STATUS_CHANGED',
  'ASSIGNED',
  'UNASSIGNED',
  'CLAIMED',
  'CLAIM_RELEASED',
  'CONVERTED_TO_BOOKING',
  'SOFT_DELETED',
  'REOPENED',
]);

export const MAX_CONSECUTIVE_ERRORS = 3;

/**
 * Debounce realtime invalidations to coalesce bursts.
 *
 * Why 250ms: realtime can emit 4-5 events in quick succession (e.g. a kitchen
 * batch walk-in creating multiple bookings, each writing CREATED + STATUS_CHANGED).
 * Without debouncing, paginated/filtered queries refetch 4-5 times in <500ms,
 * causing CPU/bandwidth waste on mobile. 250ms is invisible (optimistic UI
 * covers the just-created case anyway) and collapses bursts to a single refetch.
 */
export const REALTIME_DEBOUNCE_MS = 250;

/**
 * Pure-ish helper: returns a function that, when called repeatedly within
 * `delayMs`, invalidates the union of all collected query keys exactly once
 * after the burst settles. Last-call-wins on the timer reset.
 *
 * Exported for unit-testing with fake timers.
 */
export function createDebouncedInvalidator(
  queryClient: QueryClient,
  delayMs: number,
): (keys: ReadonlyArray<readonly unknown[]>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  // Coalesce keys across rapid calls. Serialize for dedup.
  const pendingKeys = new Map<string, readonly unknown[]>();

  return (keys) => {
    for (const key of keys) {
      pendingKeys.set(JSON.stringify(key), key);
    }
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      const keysToInvalidate = Array.from(pendingKeys.values());
      pendingKeys.clear();
      timeout = null;
      for (const key of keysToInvalidate) {
        queryClient.invalidateQueries({ queryKey: key as unknown[] });
      }
    }, delayMs);
  };
}

/**
 * Pure helper: given a raw lead_events row, return the TanStack Query keys
 * that should be invalidated. Returns empty array if the event type shouldn't
 * affect list/kanban/summary views (e.g. NOTE_ADDED, TAG_ADDED).
 *
 * Day 11: keys sourced from centralized `leadQueryKeys` so adding new lead
 * views (analytics widgets, future surfaces) just requires updating
 * `getHotelInvalidationKeys` / `getLeadInvalidationKeys` in one place.
 */
export function getListInvalidationKeys(
  row: { event_type?: string; lead_id?: string },
  hotelId: string,
): readonly (readonly unknown[])[] {
  const eventType = row.event_type as LeadEventType | undefined;
  if (!eventType || !LIST_INVALIDATING_EVENT_TYPES.has(eventType)) {
    return [];
  }
  const keys: (readonly unknown[])[] = [...getHotelInvalidationKeys(hotelId)];
  if (row.lead_id) {
    keys.push(...getLeadInvalidationKeys(row.lead_id));
  }
  return keys;
}

/**
 * Subscribe to hotel-wide lead_events. Invalidates ['leads', hotelId] and
 * ['lead-events', leadId] query keys on relevant events.
 *
 * Returns the realtime connection state for UI to display "Live updates paused"
 * when the channel is in error.
 */
export function useLeadsRealtime(hotelId: string | null | undefined): {
  connectionState: RealtimeConnectionState;
} {
  const queryClient = useQueryClient();
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>('connecting');

  useEffect(() => {
    if (!supabase || !hotelId) {
      setConnectionState('connecting');
      return;
    }

    let consecutiveErrors = 0;
    let channel: RealtimeChannel | null = null;

    // Debounced invalidator coalesces bursts of realtime events into a single
    // refetch per affected key — important once filtered/paginated queries
    // multiply cache entries (Day 7+).
    const debouncedInvalidate = createDebouncedInvalidator(queryClient, REALTIME_DEBOUNCE_MS);

    channel = supabase
      .channel(`lead-events-hotel-${hotelId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'lead_events',
          filter: `hotel_id=eq.${hotelId}`,
        },
        (payload) => {
          const row = (payload.new ?? {}) as { event_type?: string; lead_id?: string };
          const keys = getListInvalidationKeys(row, hotelId);
          if (keys.length > 0) debouncedInvalidate(keys);
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          consecutiveErrors = 0;
          setConnectionState('open');
          // On reconnect, invalidate to catch any events missed during the outage
          queryClient.invalidateQueries({ queryKey: ['leads', hotelId] });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          consecutiveErrors += 1;
          addBreadcrumb({
            category: 'leadService.realtime',
            message: `lead-events-hotel channel ${status}`,
            level: 'warning',
            data: { hotelId, consecutiveErrors },
          });
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            setConnectionState('error');
          }
        } else if (status === 'CLOSED') {
          setConnectionState('connecting');
        }
      });

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [hotelId, queryClient]);

  return { connectionState };
}
