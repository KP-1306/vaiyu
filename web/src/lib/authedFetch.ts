import { supabase } from "./supabase";

export async function authedJson<T = any>(
  url: string,
  { method = "GET", body, timeoutMs = 7000, retries = 1 }: { method?: string; body?: any; timeoutMs?: number; retries?: number } = {}
): Promise<T> {
  // Wait for a session (covers first page hit after signin/magic-link)
  const sess = (await supabase.auth.getSession()).data.session;
  const access = sess?.access_token;
  if (!access) throw new Error("no-session");

  const attempt = async (signal: AbortSignal) => {
    const r = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${access}`,
      },
      cache: "no-store",
      body: body ? JSON.stringify(body) : undefined,
      signal,
      credentials: "include",
    });
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<T>;
  };

  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    try {
      return await attempt(c.signal);
    } catch (e) {
      lastErr = e;
      if (i === retries) break;
      await new Promise((res) => setTimeout(res, 300 * (i + 1))); // tiny backoff
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("fetch-failed");
}
