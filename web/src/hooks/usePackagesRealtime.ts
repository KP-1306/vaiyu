// web/src/hooks/usePackagesRealtime.ts
//
// Subscribes to `packages` changes for a hotel; invalidates the cached
// list/active/analytics queries on any insert/update. Debounced 250ms.

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { getHotelPackageInvalidationKeys } from '../services/packageQueryKeys';

const DEBOUNCE_MS = 250;

export function usePackagesRealtime(hotelId: string | undefined): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!hotelId) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const invalidate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        for (const key of getHotelPackageInvalidationKeys(hotelId)) {
          qc.invalidateQueries({ queryKey: key });
        }
      }, DEBOUNCE_MS);
    };

    const channel = supabase
      .channel(`packages:${hotelId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'packages',
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
