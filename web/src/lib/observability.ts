// web/src/lib/observability.ts
// Thin facade over whatever error/event sink is configured on `window`.
// Keeps application code free of direct Sentry/Datadog/etc. imports so
// call sites don't change when we swap providers.

type Severity = "error" | "warn" | "info";

type Attrs = Record<string, unknown>;

// Providers register themselves at app boot by assigning to window.__vaiyuObs.
// Keeping the contract tiny makes it trivial to stub in tests and to adopt any
// provider that exposes a `captureException` + `captureMessage` pair.
type ObservabilitySink = {
  captureException: (err: unknown, attrs?: Attrs) => void;
  captureMessage: (msg: string, severity: Severity, attrs?: Attrs) => void;
};

declare global {
  interface Window {
    __vaiyuObs?: ObservabilitySink;
  }
}

function sink(): ObservabilitySink | undefined {
  if (typeof window === "undefined") return undefined;
  return window.__vaiyuObs;
}

export function reportError(err: unknown, attrs: Attrs = {}): void {
  const s = sink();
  if (s) {
    try {
      s.captureException(err, attrs);
      return;
    } catch {
      // fall through to console so we never eat the original error
    }
  }
  // eslint-disable-next-line no-console
  console.error("[obs]", err, attrs);
}

export function reportEvent(
  name: string,
  severity: Severity = "info",
  attrs: Attrs = {},
): void {
  const s = sink();
  if (s) {
    try {
      s.captureMessage(name, severity, attrs);
      return;
    } catch {
      // fall through
    }
  }
  // eslint-disable-next-line no-console
  console[severity === "error" ? "error" : severity === "warn" ? "warn" : "log"](
    `[obs] ${name}`,
    attrs,
  );
}
