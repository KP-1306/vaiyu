import { API } from './api';

/**
 * Connect to /events and attach listeners for specific event types.
 * Returns a cleanup function to close the connection.
 */
export function connectEvents(handlers: Partial<Record<string, (data: any) => void>>) {
  const url = `${API}/events`;
  const es = new EventSource(url, { withCredentials: false });

  // Generic handler (if someone wants to listen to everything via "message")
  if (handlers.message) es.onmessage = (e) => {
    try { handlers.message?.(JSON.parse(e.data)); } catch {}
  };

  // Named event listeners
  Object.entries(handlers).forEach(([evt, fn]) => {
    if (evt === 'message' || !fn) return;
    es.addEventListener(evt, (e: MessageEvent) => {
      try { fn(JSON.parse(e.data)); } catch {}
    });
  });

  // Basic error logging (optional)
  es.onerror = () => { /* network hiccup; browser auto-reconnects */ };

  // Return cleanup
  return () => es.close();
}
