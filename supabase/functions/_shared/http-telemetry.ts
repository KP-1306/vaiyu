// supabase/functions/_shared/http-telemetry.ts
//
// Request-level telemetry for Edge Functions. Records one row per request into
// public.api_hits (fn, method, path, status, ms) so the owner "System Health"
// card (v_api_24h / v_api_top_fns_24h) shows REAL traffic, latency and error
// rates instead of structural zeros.
//
// Design guarantees (this wraps payment + webhook handlers, so it must be inert):
//   • The wrapped handler runs EXACTLY as before — same request, same response,
//     same thrown errors. Telemetry is a pure side-effect.
//   • Zero added latency: the insert runs in the background via
//     EdgeRuntime.waitUntil when available; otherwise it's fire-and-forget
//     (never awaited on the response path).
//   • Fail-open: every failure inside is swallowed. Observability must never
//     break or slow a request.
//
// This is distinct from _shared/observability.ts (structured error logging →
// Sentry/stdout). That captures *errors*; this captures *request telemetry*.
//
// Rows written here carry key='obs:<fn>' (the `key` column is NOT NULL and is
// otherwise the rate-limiter's namespace) and a non-null `fn`. The obs views
// filter `fn IS NOT NULL`, so telemetry rows and rate-limiter rows never mix.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { secretKey } from "./keys.ts";

type Handler = (req: Request) => Promise<Response> | Response;

let _client: SupabaseClient | null = null;
function svc(): SupabaseClient | null {
  if (_client) return _client;
  const url = Deno.env.get("SUPABASE_URL");
  // New sb_secret_ key with legacy service_role fallback (migration).
  const key = secretKey();
  if (!url || !key) return null;
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

function record(fn: string, req: Request, status: number, ms: number): void {
  try {
    const c = svc();
    if (!c) return;
    let path = "";
    try { path = new URL(req.url).pathname; } catch { /* ignore malformed url */ }
    const pending = c
      .from("api_hits")
      .insert({ key: `obs:${fn}`, fn, method: req.method, path, status, ms })
      .then(() => {}, () => {}); // swallow — telemetry failures are invisible to callers
    // Run after the response is sent so we never add latency. Fall back to plain
    // fire-and-forget if the runtime has no waitUntil.
    const er = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (er && typeof er.waitUntil === "function") er.waitUntil(Promise.resolve(pending));
  } catch { /* observability must never break the request */ }
}

/** Wrap an Edge Function handler so each request is recorded to api_hits as a
 *  pure, fail-open side-effect. CORS preflight (OPTIONS) is not instrumented so
 *  it doesn't inflate call counts. The handler's behavior is unchanged. */
export function withObs(fn: string, handler: Handler): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return await handler(req);
    const start = Date.now();
    try {
      const res = await handler(req);
      record(fn, req, res.status, Date.now() - start);
      return res;
    } catch (e) {
      record(fn, req, 500, Date.now() - start);
      throw e; // preserve original behavior exactly
    }
  };
}
