// supabase/functions/_shared/observability.ts
//
// Lightweight structured logging + optional Sentry capture for Edge Functions.
//
// Goal: replace ad-hoc `console.error(...)` with a single call that:
//   1. Writes a structured JSON line to stdout (Supabase function logs
//      preserve these as-is, so external log aggregators like Logflare /
//      Datadog can ingest them).
//   2. If `SENTRY_DSN` is configured, POSTs an event to Sentry's HTTP API
//      using their store endpoint (no SDK required, ~30 lines of code).
//
// Why no Deno Sentry SDK? Two reasons:
//   - The Deno SDK pulls a large dependency tree at cold-start time.
//   - For server-side capture we don't need breadcrumbs, performance
//     spans, or session replay — just exception capture with context.
//   - Falling back to console.error if Sentry is misconfigured is the
//     correct default (don't ever fail a payment because the logger
//     errored).

const SENTRY_DSN = Deno.env.get("SENTRY_DSN") ?? "";

type Severity = "info" | "warning" | "error" | "fatal";

interface SentryEnvelope {
  scope: string;
  message?: string;
  err?: unknown;
  context?: Record<string, unknown>;
  severity: Severity;
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeStringify(v: unknown): string {
  try {
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function extractError(err: unknown): { message: string; stack?: string; name?: string } {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack, name: err.name };
  }
  if (typeof err === "string") return { message: err };
  return { message: safeStringify(err) };
}

/** Parse DSN — Sentry DSN format is e.g.
 *  https://abc123@o0.ingest.sentry.io/123
 *  We need: protocol+host+path → store URL, and the public key for x-sentry-auth. */
interface ParsedDsn {
  storeUrl: string;
  publicKey: string;
}
function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, "");
    if (!projectId) return null;
    const publicKey = u.username;
    const storeUrl = `${u.protocol}//${u.host}/api/${projectId}/store/`;
    return { storeUrl, publicKey };
  } catch {
    return null;
  }
}
const PARSED_DSN: ParsedDsn | null = SENTRY_DSN ? parseDsn(SENTRY_DSN) : null;

/** Best-effort POST to Sentry's store endpoint. Never throws — observability
 *  failures must not surface to the caller. */
async function shipToSentry(payload: SentryEnvelope): Promise<void> {
  if (!PARSED_DSN) return;
  const err = payload.err ? extractError(payload.err) : null;
  const event = {
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: payload.severity,
    server_name: "supabase-edge",
    logger: payload.scope,
    message: payload.message ?? err?.message ?? payload.scope,
    exception: err
      ? {
        values: [{ type: err.name ?? "Error", value: err.message, stacktrace: err.stack ? parseStack(err.stack) : undefined }],
      }
      : undefined,
    tags: { scope: payload.scope },
    extra: payload.context ?? {},
  };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3_000); // Sentry should NEVER block a hot path
    await fetch(PARSED_DSN.storeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${PARSED_DSN.publicKey}, sentry_client=vaiyu-edge/1.0`,
      },
      body: JSON.stringify(event),
      signal: ctrl.signal,
    });
    clearTimeout(t);
  } catch {
    // Swallow — we already wrote to stdout, that's the source of truth.
  }
}

/** Crude stack parser — converts JS stack frames to Sentry-shaped entries.
 *  Good enough for grouping; not a full source-map decoder. */
function parseStack(stack: string) {
  const frames: Array<{ filename: string; function: string; lineno?: number; colno?: number }> = [];
  for (const line of stack.split("\n").slice(1, 20)) {
    const m = line.trim().match(/^at\s+([^(]+)\(([^)]+):(\d+):(\d+)\)$/) ??
      line.trim().match(/^at\s+(.+):(\d+):(\d+)$/);
    if (m && m.length === 5) {
      frames.push({ function: m[1].trim(), filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) });
    } else if (m && m.length === 4) {
      frames.push({ function: "<anonymous>", filename: m[1], lineno: Number(m[2]), colno: Number(m[3]) });
    }
  }
  return { frames: frames.reverse() }; // Sentry expects oldest → newest
}

/* ============================================================
   Public API
   ============================================================ */

/** Structured error log. Always writes JSON to stdout. Optionally ships
 *  to Sentry if `SENTRY_DSN` env var is set. Safe to call from anywhere —
 *  any failure inside is swallowed. */
export function logError(scope: string, err: unknown, context?: Record<string, unknown>): void {
  const e = extractError(err);
  const line = {
    ts: nowIso(),
    level: "error",
    scope,
    message: e.message,
    name: e.name,
    stack: e.stack,
    ...context,
  };
  console.error(JSON.stringify(line));
  // Don't await — let it run in the background; we don't want to slow the response.
  shipToSentry({ scope, err, context, severity: "error" });
}

/** Structured warning log. JSON-only — no Sentry ship to avoid noise. */
export function logWarn(scope: string, message: string, context?: Record<string, unknown>): void {
  console.warn(JSON.stringify({ ts: nowIso(), level: "warn", scope, message, ...context }));
}

/** Structured info log. Useful for audit trails of payment events. */
export function logInfo(scope: string, message: string, context?: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: nowIso(), level: "info", scope, message, ...context }));
}

/** Wrap a fetch call (or any async) to catch + log + optionally rethrow.
 *  Useful for one-line instrumentation of the Razorpay API call sites. */
export async function withErrorLogging<T>(
  scope: string,
  fn: () => Promise<T>,
  context?: Record<string, unknown>,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    logError(scope, e, context);
    throw e;
  }
}
