// supabase/functions/_shared/auth.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
  });
}

// Create an anon client to validate the bearer JWT
export function supabaseAnon(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!; // <-- add this env var in Supabase
  const sb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
  return sb;
}

// Simple per-IP + route rate limit using Postgres (rolling 1 min)
export async function rateLimitOrThrow(svc: any, req: Request, keyHint: string, limit = 60) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
             (req as any).cf?.connectingIP || "0.0.0.0";
  const key = `${keyHint}:${ip}`;

  // table: api_hits(key text, ts timestamptz)
  const now = new Date();

  const { error: insErr } = await svc.from("api_hits").insert({ key, ts: now.toISOString() });
  if (insErr) console.error("rate-limit insert error", insErr);

  const { data, error } = await svc
    .from("api_hits")
    .select("ts", { count: "exact", head: true })
    .gte("ts", new Date(now.getTime() - 60_000).toISOString())
    .eq("key", key);

  if (error) console.error("rate-limit count error", error);
  const count = (data as any)?.length ?? (error ? 0 : (data as unknown as number) ?? 0);

  if (count > limit) {
    throw new Error("Rate limit exceeded. Try again in a minute.");
  }
}
