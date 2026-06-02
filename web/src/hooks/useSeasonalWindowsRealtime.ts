// web/src/hooks/useSeasonalWindowsRealtime.ts
//
// Subscribes to hotel_seasonal_window_states + ..._events for a hotel.
// Invalidates the cached list and any open timeline queries. Debounced 250ms
// so a burst of writes (e.g. multiple checklist ticks) only triggers one refetch.

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { seasonalCalendarQueryKeys } from '../services/seasonalCalendarQueryKeys';

const DEBOUNCE_MS = 250;

export function useSeasonalWindowsRealtime(hotelId: string | undefined): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!hotelId) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const invalidate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        qc.invalidateQueries({ queryKey: seasonalCalendarQueryKeys.list(hotelId) });
        // Any open timeline drawers also refetch.
        qc.invalidateQueries({ queryKey: ['seasonal-window-timeline', hotelId] });
      }, DEBOUNCE_MS);
    };

    const channel = supabase
      .channel(`seasonal-windows:${hotelId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'hotel_seasonal_window_states',
          filter: `hotel_id=eq.${hotelId}`,
        },
        invalidate,
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'hotel_seasonal_window_events',
          filter: `hotel_id=eq.${hotelId}`,
        },
        invalidate,
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [hotelId, qc]);
}
