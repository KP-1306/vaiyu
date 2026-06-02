// web/src/hooks/useQuoteDraftsRealtime.ts
//
// Subscribes to quote_drafts changes for a hotel. Invalidates the cached
// quote-drafts-list query on any insert/update so multiple tabs / staff
// see each other's saves. Debounced 250ms to coalesce bursts (mirrors
// useFollowUpsRealtime and useLeadsRealtime).

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const DEBOUNCE_MS = 250;

export function useQuoteDraftsRealtime(hotelId: string | undefined): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!hotelId) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const invalidate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['quote-drafts', 'list', hotelId] });
      }, DEBOUNCE_MS);
    };

    const channel = supabase
      .channel(`quote_drafts:${hotelId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'quote_drafts',
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
