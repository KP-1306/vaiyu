// web/src/hooks/useFollowUpsRealtime.ts
//
// Subscribes to follow_ups changes for a hotel and invalidates the cached
// queries on any insert/update/delete. Debounced 250ms to coalesce bursts
// (mirrors useLeadsRealtime's pattern).

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const DEBOUNCE_MS = 250;

export function useFollowUpsRealtime(hotelId: string | undefined): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!hotelId) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const invalidate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['follow-ups', 'list', hotelId] });
      }, DEBOUNCE_MS);
    };

    const channel = supabase
      .channel(`follow_ups:${hotelId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'follow_ups',
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
