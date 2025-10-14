export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || typeof window === "undefined") return;

  import("@sentry/browser")
    .then(({ init }) => {
      init({
        dsn,
        tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0.15),
      });
    })
    .catch(() => {/* no-op */});
}

export function captureError(error: unknown, context?: Record<string, any>) {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || typeof window === "undefined") return;

  import("@sentry/browser")
    .then((Sentry) => {
      if (context) Sentry.setContext("extra", context);
      Sentry.captureException(error);
    })
    .catch(() => {/* no-op */});
}
