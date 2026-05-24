// web/src/lib/monitoring.ts
//
// Safe to ship without `@sentry/browser` installed. Loads Sentry from CDN
// only if `VITE_SENTRY_DSN` is set, in production builds.
//
// Public API:
//   initMonitoring()                  — call once from main.tsx
//   captureException(err, ctx?)       — explicit error capture
//   captureMessage(msg, level?, ctx?) — structured message
//   addBreadcrumb({...})              — trace breadcrumb for debugging payment flows
//   setUserContext({id, email})       — attach user identity to subsequent events
//
// If Sentry isn't loaded (no DSN, dev mode, or CDN failure), every call
// silently falls back to `console.error` so we never lose signal.

type AnyObj = Record<string, unknown>;

// Loaded Sentry handle. `null` until init resolves; stays null in dev / if no DSN.
let sentryRef: any = null;
let initialised = false;

/** Initialize monitoring (Sentry) only when VITE_SENTRY_DSN is set.
 *  Uses a runtime import from a CDN so the bundler doesn't need @sentry/browser. */
export async function initMonitoring(extra: AnyObj = {}) {
  if (initialised) return;
  initialised = true;

  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;

  // Load Sentry in production only
  if (import.meta.env.DEV) return;

  try {
    // @ts-expect-error — runtime CDN import, no type definitions
    const sentry: any = await import(/* @vite-ignore */ "https://esm.sh/@sentry/browser@7.120.0");
    // @ts-expect-error — runtime CDN import, no type definitions
    const integrations: any = await import(/* @vite-ignore */ "https://esm.sh/@sentry/integrations@7.120.0");

    sentry.init({
      dsn,
      release: import.meta.env.VITE_APP_VERSION ?? undefined,
      environment: import.meta.env.MODE,
      integrations: [
        new integrations.BrowserTracing(),
        new integrations.Replay(),
      ],
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0.0,
      replaysOnErrorSampleRate: 0.1,
      // Filter out third-party noise that would otherwise pollute Sentry.
      // These come from Razorpay's checkout.js (and similar embedded SDKs)
      // attempting to ping internal/dev endpoints. They don't affect
      // payment success and aren't actionable on our side.
      beforeSend(event: any, hint: any) {
        const err = hint?.originalException;
        const msg = (event?.message || err?.message || "").toString();
        const url = (event?.request?.url || "").toString();
        const stack = (err?.stack || "").toString();

        const noisePatterns = [
          /localhost:7071/i,                              // Razorpay's dev-mode leftover ping
          /Refused to get unsafe header/i,                // CORS expose-headers warning from Razorpay's xhr
          /v2-entry\.modern\.js/i,                        // Razorpay checkout bundle internal errors
          /chrome-extension:\/\//i,                       // Browser-extension noise
          /ResizeObserver loop limit exceeded/i,          // Benign browser warning
          /Non-Error promise rejection captured/i,        // Often library noise without real signal
        ];

        if (noisePatterns.some((rx) => rx.test(msg) || rx.test(stack) || rx.test(url))) {
          return null; // drop the event
        }
        return event;
      },
      ...extra,
    });

    sentryRef = sentry;
  } catch (e) {
    // CDN unreachable — log to console and continue without monitoring.
    console.error("[monitoring] Sentry init failed; continuing without it", e);
  }
}

/** Explicit exception capture. Always logs to console; ships to Sentry if loaded. */
export function captureException(err: unknown, context?: AnyObj): void {
  // Always log locally so dev/CI/local sessions see the error.
  console.error(err, context ?? "");

  if (!sentryRef) return;
  try {
    if (context) {
      sentryRef.withScope((scope: any) => {
        for (const [k, v] of Object.entries(context)) {
          scope.setExtra(k, v);
        }
        sentryRef.captureException(err);
      });
    } else {
      sentryRef.captureException(err);
    }
  } catch { /* swallow */ }
}

/** Capture a non-exception message (info/warning/error). */
export function captureMessage(
  message: string,
  level: "fatal" | "error" | "warning" | "info" | "debug" = "info",
  context?: AnyObj,
): void {
  if (level === "error" || level === "fatal") {
    console.error("[" + level + "]", message, context ?? "");
  } else if (level === "warning") {
    console.warn("[warning]", message, context ?? "");
  }
  if (!sentryRef) return;
  try {
    if (context) {
      sentryRef.withScope((scope: any) => {
        for (const [k, v] of Object.entries(context)) scope.setExtra(k, v);
        scope.setLevel(level);
        sentryRef.captureMessage(message, level);
      });
    } else {
      sentryRef.captureMessage(message, level);
    }
  } catch { /* swallow */ }
}

/** Add a breadcrumb — useful for tracing the steps before an error.
 *  Especially valuable in the Razorpay flow: createOrder → openCheckout →
 *  handler → verifyPayment, where the final exception alone doesn't tell
 *  you which step failed. */
export function addBreadcrumb(crumb: {
  category: string;
  message: string;
  level?: "fatal" | "error" | "warning" | "info" | "debug";
  data?: AnyObj;
}): void {
  if (!sentryRef) return;
  try {
    sentryRef.addBreadcrumb({
      category: crumb.category,
      message: crumb.message,
      level: crumb.level ?? "info",
      data: crumb.data,
      timestamp: Date.now() / 1000,
    });
  } catch { /* swallow */ }
}

/** Tag the current Sentry scope with user identity. Call after auth resolves. */
export function setUserContext(user: { id: string; email?: string | null } | null): void {
  if (!sentryRef) return;
  try {
    if (user) {
      sentryRef.setUser({ id: user.id, email: user.email ?? undefined });
    } else {
      sentryRef.setUser(null);
    }
  } catch { /* swallow */ }
}
