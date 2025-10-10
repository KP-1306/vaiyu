// web/src/lib/sse.ts

// Resolve API base from environment (Netlify > Vite)
const API_BASE = import.meta.env.VITE_API_URL || '';

export type SSEHandlers = Partial<Record<string, (payload?: any) => void>>;
export type SSEOptions = {
  /** Custom SSE path if your endpoint isn't /events */
  path?: string;
  /** Pass cookies/credentials if your API needs them */
  withCredentials?: boolean;
};

/**
 * Connect to the server-sent events endpoint and attach named handlers.
 * Returns a cleanup function to close the connection.
 *
 * Usage:
 *   const off = connectEvents({
 *     ticket_created: () => reloadTickets(),
 *     order_updated: () => reloadOrders(),
 *   });
 *   // later: off();
 */
export function connectEvents(handlers: SSEHandlers, opts?: SSEOptions) {
  if (!API_BASE) {
    // no-op in dev if API not configured
    return () => {};
  }

  const path = opts?.path ?? '/events';
  const es = new EventSource(`${API_BASE}${path}`, {
    withCredentials: !!opts?.withCredentials,
  });

  // Attach named event listeners
  for (const [name, fn] of Object.entries(handlers)) {
    if (!fn) continue;
    es.addEventListener(name, (ev: MessageEvent) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        fn(data);
      } catch {
        // ignore parse errors
      }
    });
  }

  // Optional lifecycle events (safe to ignore)
  es.addEventListener('hello', () => {
    // first-connect handshake from server
  });
  es.addEventListener('ping', () => {
    // keepalive from server
  });

  // Network hiccups auto-reconnect by default; no custom retry timer needed.
  es.onerror = () => {
    // Swallow; browsers auto-retry EventSource connections.
    // You can add console.debug here if you want visibility.
  };

  // Return cleanup
  return () => es.close();
}
