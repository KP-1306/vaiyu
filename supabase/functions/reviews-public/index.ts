import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { j } from "../_shared/cors.ts";
import { alertError } from "../_shared/alert.ts";

/* anon client for reading + rate-limit hits */
function supabaseAnon() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
}

async function rateLimitOrThrow(req: Request, keyHint: string, limit = 120) {
  const supa = supabaseAnon();
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    (req as any).cf?.connectingIP ||
    "0.0.0.0";
  const key = `${keyHint}:${ip}`;
  // Rate-limit via SECURITY DEFINER RPC (api_hits is locked to service_role/owner;
  // anon only has EXECUTE on the RPC, not table access). Fail-open on RPC error.
  const { data: rlOk, error: rlErr } = await supa.rpc("va_rate_limit_hit", {
    p_key: key,
    p_window_seconds: 60,
    p_limit: limit,
  });
  if (rlErr) { console.error("rate-limit rpc error", rlErr); return; }
  if (rlOk === false) throw new Error("Rate limit exceeded");
}

function encCursor(dt: string, id: string) { return btoa(`${dt}::${id}`); }
function decCursor(c?: string | null): { dt?: string; id?: string } {
  if (!c) return {}; try { const [dt, id] = atob(c).split("::"); return { dt, id }; } catch { return {}; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return j(req, 200, { ok: true });
  const webhook = Deno.env.get("WEBHOOK_ALERT_URL");

  try {
    if (req.method !== "GET") return j(req, 405, { ok: false, error: "Method Not Allowed" });
    await rateLimitOrThrow(req, "reviews-public", 180);

    const supa = supabaseAnon();
    const url = new URL(req.url);

    const slug = (url.searchParams.get("slug") || "").trim();
    if (!slug) return j(req, 400, { ok: false, error: "slug required" });

    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || "20")));
    const cursorIn = url.searchParams.get("cursor");
    const { dt: cdt, id: cid } = decCursor(cursorIn);

    const { data: hotel } = await supa.from("hotels").select("id, name, slug, logo_url").eq("slug", slug).single();
    if (!hotel) return j(req, 404, { ok: false, error: "Unknown hotel" });

    let q = supa
      .from("reviews")
      .select("id, rating, title, body, published_at")
      .eq("hotel_id", hotel.id)
      .eq("status", "approved")
      .order("published_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);

    if (cdt && cid) {
      q = q.or(
        `published_at.lt.${cdt},and(published_at.eq.${cdt},id.lt.${cid})`
      );
    }

    const { data, error } = await q;
    if (error) return j(req, 400, { ok: false, error: error.message });

    let page = data ?? [];
    let hasMore = false;
    if (page.length > limit) {
      hasMore = true;
      page = page.slice(0, limit);
    }

    const nextCursor =
      page.length > 0
        ? encCursor(page[page.length - 1].published_at, page[page.length - 1].id)
        : null;

    return j(req, 200, {
      ok: true,
      hotel: { name: hotel.name, slug: hotel.slug, logo_url: hotel.logo_url },
      reviews: page,
      next_cursor: hasMore ? nextCursor : null,
    });
  } catch (e) {
    await alertError(webhook, { fn: "reviews-public", message: String(e) });
    return j(req, 500, { ok: false, error: String(e) });
  }
});
