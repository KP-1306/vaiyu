// web/src/hooks/useTicketsRealtime.ts
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

/**
 * Subscribes to Realtime changes on public.tickets for a given hotel.
 * On any INSERT / UPDATE / DELETE, we simply invalidate the relevant
 * React Query caches so existing listTickets() logic stays intact.
 */
export function useTicketsRealtime(hotelId?: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!supabase || !hotelId) {
      return;
    }

    const channel = supabase
      .channel(`tickets-hotel-${hotelId}`)
      .on(
        "postgres_changes",
        {
          event: "*", // INSERT | UPDATE | DELETE
          schema: "public",
          table: "tickets",
          filter: `hotel_id=eq.${hotelId}`,
        },
        (_payload) => {
          // Keep this very safe: just refetch.
          // TanStack Query v5 signature:
          queryClient.invalidateQueries({
            queryKey: ["tickets", hotelId],
          });

          // Also refresh KPIs that depend on tickets / SLA.
          queryClient.invalidateQueries({
            queryKey: ["owner-dashboard-kpis", hotelId],
          });

          // If later you add per-status lists (e.g. ["tickets", hotelId, "open"])
          // you can also invalidateQueries with partial keys.
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.error(
            "[Supabase Realtime] tickets channel error for hotel",
            hotelId
          );
        }
      });

    return () => {
      // Clean up on unmount / dependency change
      supabase.removeChannel(channel);
    };
  }, [hotelId, queryClient]);
}
