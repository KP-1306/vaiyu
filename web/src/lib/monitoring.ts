// web/src/lib/monitoring.ts
// Safe to ship without @sentry/browser installed. Loads Sentry from CDN only if DSN exists.

type AnyObj = Record<string, unknown>;

/**
 * Initialize monitoring (Sentry) only when VITE_SENTRY_DSN is set.
 * Uses a runtime import from a CDN so the bundler doesn’t need @sentry/browser.
 */
export async function initMonitoring(extra: AnyObj = {}) {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return; // Monitoring disabled

  // Load Sentry in production only (optional)
  if (import.meta.env.DEV) return;

  // Load Sentry from esm.sh (no npm dep required)
  const sentry = await import("https://esm.sh/@sentry/browser@7.120.0");
  const integrations = await import("https://esm.sh/@sentry/integrations@7.120.0");

  sentry.init({
    dsn,
    release: import.meta.env.VITE_APP_VERSION ?? undefined,
    environment: import.meta.env.MODE,
    integrations: [
      new integrations.BrowserTracing(),
      new integrations.Replay(), // remove if you don't need session replay
    ],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.0,
    replaysOnErrorSampleRate: 0.1,
    ...extra,
  });
}

/** Optional helpers */
export function captureException(err: unknown) {
  // Lazy path when CDN not loaded: just console.error
  // If loaded, Sentry will replace console via its integration
  // and still receive the error.
  console.error(err);
}
