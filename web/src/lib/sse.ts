// web/src/lib/sse.ts
import { supabase } from './supabase';

export type SSEHandlers = Partial<Record<string, (payload?: any) => void>>;
export type SSEOptions = {
  path?: string; // Ignored in Supabase Realtime implementation
  withCredentials?: boolean; // Ignored
  token?: string; // Ignored (supabase client handles auth)
  onStatusChange?: (status: 'connected' | 'disconnected' | 'connecting') => void;
};

/**
 * Connect to Supabase Realtime for ticket updates.
 * Replaces legacy EventSource implementation.
 */
export function connectEvents(handlers: SSEHandlers, opts?: SSEOptions) {
  opts?.onStatusChange?.('connecting');

  const channel = supabase
    .channel('ops-board-changes')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'tickets' },
      (payload) => {
        handlers.ticket_created?.(payload.new);
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'tickets' },
      (payload) => {
        handlers.ticket_updated?.(payload.new);
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        opts?.onStatusChange?.('connected');
      } else if (status === 'CHANNEL_ERROR') {
        opts?.onStatusChange?.('disconnected');
      } else if (status === 'TIMED_OUT') {
        opts?.onStatusChange?.('disconnected');
      } else {
        // 'CLOSED' or 'AWAITING_OPEN'
        opts?.onStatusChange?.('connecting');
      }
    });

  // Return cleanup function
  return () => {
    supabase.removeChannel(channel);
  };
}
