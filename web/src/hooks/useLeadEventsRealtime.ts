// web/src/hooks/useLeadEventsRealtime.ts
//
// Lead-detail-scoped realtime subscription. Fires on ALL event types (the
// LeadDetail timeline shows everything), unlike useLeadsRealtime which filters
// to list-affecting events only.
//
// Filters by lead_id at the channel level. Invalidates the per-lead caches
// (events timeline, claim status, lead row). Used by the LeadDetail drawer
// (Day 9) to keep an open lead in sync across tabs.

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { addBreadcrumb } from '../lib/monitoring';
import type { LeadEventType } from '../types/lead';

export type RealtimeConnectionState = 'connecting' | 'open' | 'error';

const MAX_CONSECUTIVE_ERRORS = 3;

export function useLeadEventsRealtime(
  leadId: string | null | undefined,
  options?: {
    /** Called with the raw event_type as soon as an INSERT arrives. Useful for
     *  triggering side effects (e.g. toast when CLAIM_RELEASED with release_type=forced). */
    onEvent?: (eventType: LeadEventType, payload: Record<string, unknown>) => void;
  },
): { connectionState: RealtimeConnectionState } {
  const queryClient = useQueryClient();
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>('connecting');

  useEffect(() => {
    if (!supabase || !leadId) {
      setConnectionState('connecting');
      return;
    }

    let consecutiveErrors = 0;
    let channel: RealtimeChannel | null = null;

    channel = supabase
      .channel(`lead-events-lead-${leadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'lead_events',
          filter: `lead_id=eq.${leadId}`,
        },
        (payload) => {
          const row = (payload.new ?? {}) as {
            event_type?: string;
            payload?: Record<string, unknown>;
          };
          const eventType = row.event_type as LeadEventType | undefined;
          if (!eventType) return;

          queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
          queryClient.invalidateQueries({ queryKey: ['lead-events', leadId] });
          queryClient.invalidateQueries({ queryKey: ['lead-claim', leadId] });

          if (options?.onEvent) {
            options.onEvent(eventType, row.payload ?? {});
          }
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          consecutiveErrors = 0;
          setConnectionState('open');
          queryClient.invalidateQueries({ queryKey: ['lead-events', leadId] });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          consecutiveErrors += 1;
          addBreadcrumb({
            category: 'leadService.realtime',
            message: `lead-events-lead channel ${status}`,
            level: 'warning',
            data: { leadId, consecutiveErrors },
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
    // options.onEvent is intentionally NOT in deps — caller is expected to
    // memoize it (typical hook contract). Including it would re-subscribe on
    // every render which leaks channels in React StrictMode dev.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, queryClient]);

  return { connectionState };
}
