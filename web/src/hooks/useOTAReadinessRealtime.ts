// web/src/hooks/useOTAReadinessRealtime.ts
//
// Lightweight realtime invalidation for OTA Listing Optimizer queries.
// Subscribes to hotel_ota_readiness_state + hotel_ota_optimizer_settings
// changes for the active hotel and invalidates TanStack Query keys after
// a 250ms debounce (avoids storms during bulk wizard saves).

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { otaOptimizerQueryKeys } from '../services/otaOptimizerQueryKeys';

export function useOTAReadinessRealtime(hotelId: string | undefined): void {
  const qc = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!hotelId) return;

    const invalidate = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        qc.invalidateQueries({ queryKey: otaOptimizerQueryKeys.hotel(hotelId) });
      }, 250);
    };

    const channel = supabase
      .channel(`ota-optimizer:${hotelId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'hotel_ota_readiness_state',
          filter: `hotel_id=eq.${hotelId}`,
        },
        invalidate,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'hotel_ota_optimizer_settings',
          filter: `hotel_id=eq.${hotelId}`,
        },
        invalidate,
      )
      .subscribe();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [hotelId, qc]);
}
