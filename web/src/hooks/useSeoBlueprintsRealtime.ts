// web/src/hooks/useSeoBlueprintsRealtime.ts
//
// Subscribes to `seo_landing_blueprints` changes for a hotel; invalidates the
// cached list + summary queries on any insert/update. Debounced 250ms.

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { seoBlueprintQueryKeys } from '../services/seoBlueprintQueryKeys';

const DEBOUNCE_MS = 250;

export function useSeoBlueprintsRealtime(hotelId: string | undefined): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!hotelId) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const invalidate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        qc.invalidateQueries({ queryKey: seoBlueprintQueryKeys.list(hotelId) });
        qc.invalidateQueries({ queryKey: seoBlueprintQueryKeys.summary(hotelId) });
      }, DEBOUNCE_MS);
    };

    const channel = supabase
      .channel(`seo-blueprints:${hotelId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'seo_landing_blueprints',
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
