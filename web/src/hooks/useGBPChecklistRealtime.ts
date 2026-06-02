// web/src/hooks/useGBPChecklistRealtime.ts
//
// Debounced realtime invalidation for GBP Checklist queries.

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { gbpChecklistQueryKeys } from '../services/gbpChecklistQueryKeys';

export function useGBPChecklistRealtime(hotelId: string | undefined): void {
  const qc = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!hotelId) return;
    const invalidate = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        qc.invalidateQueries({ queryKey: gbpChecklistQueryKeys.hotel(hotelId) });
      }, 250);
    };
    const channel = supabase
      .channel(`gbp-checklist:${hotelId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'gbp_checklist_attestations',
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
