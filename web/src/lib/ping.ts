export type PingResult = { ok: boolean; status?: number; ms: number; error?: string };

export async function ping(url: string, timeoutMs = 4000, init: RequestInit = {}): Promise<PingResult> {
  const start = performance.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, credentials: "include" });
    clearTimeout(t);
    return { ok: res.ok, status: res.status, ms: Math.round(performance.now() - start) };
  } catch (e: any) {
    clearTimeout(t);
    return { ok: false, ms: Math.round(performance.now() - start), error: e?.message || String(e) };
  }
}
