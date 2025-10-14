// web/src/lib/sentry.ts
// Temporary no-op so deploys aren't blocked. Wire real Sentry later.
export function initSentry() {
  /* no-op */
}
export function captureError(_error: unknown, _context?: Record<string, any>) {
  /* no-op */
}
