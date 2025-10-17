// Tiny, resilient fetch with timeout, retries, and JSON safety.
export type FetchJSONOpts = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;     // default 10s
  retries?: number;       // default 1 (so 2 total tries)
  retryDelayMs?: number;  // default 600ms
  signal?: AbortSignal;
};

export class HttpError extends Error {
  status: number;
  payload?: unknown;
  constructor(status: number, message: string, payload?: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

export async function fetchJSON<T = any>(url: string, opts: FetchJSONOpts = {}): Promise<T> {
  const {
    method = "GET",
    headers = {},
    body,
    timeoutMs = 10_000,
    retries = 1,
    retryDelayMs = 600,
    signal,
  } = opts;

  const attempt = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const combined = signal
      ? new AbortController()
      : controller;

    // If caller passed a signal, tie them together
    if (signal) {
      const inner = controller;
      const outer = combined!;
      const onAbort = () => inner.abort();
      signal.addEventListener("abort", onAbort, { once: true });
      (combined as AbortController).signal.addEventListener("abort", () => {
        signal.removeEventListener("abort", onAbort);
      });
      setTimeout(() => {}, 0); // noop
    }

    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Accept": "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: (signal ?? controller.signal),
        cache: "no-store",
      });

      const text = await res.text();
      let json: unknown = undefined;
      if (text) {
        try { json = JSON.parse(text); } catch { json = text; }
      }

      if (!res.ok) {
        throw new HttpError(res.status, `HTTP ${res.status}`, json);
      }
      return json as T;
    } finally {
      clearTimeout(timeout);
    }
  };

  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await attempt();
    } catch (e: any) {
      lastErr = e;
      // Only retry on network/timeout/5xx
      const retryable =
        e?.name === "AbortError" ||
        (e instanceof HttpError && e.status >= 500) ||
        (e && !("status" in e)); // network error
      if (i < retries && retryable) await sleep(retryDelayMs);
      else break;
    }
  }
  throw lastErr;
}

// Narrow JSON shape safely (lightweight guard)
export function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
export function asObject<T extends object = Record<string, unknown>>(v: unknown): T {
  return (v && typeof v === "object" && !Array.isArray(v)) ? (v as T) : {} as T;
}
