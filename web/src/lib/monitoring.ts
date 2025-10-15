// web/src/lib/monitoring.ts
import * as Sentry from "@sentry/browser";
const dsn = import.meta.env.VITE_SENTRY_DSN;
export function initMonitoring() {
  if (!dsn) return;
  Sentry.init({ dsn, tracesSampleRate: 0.1 });
}
export { Sentry };
