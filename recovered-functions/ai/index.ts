// supabase/functions/ai/index.ts
// Handles:
//   GET /functions/v1/ai/usage?hotel_id=...&days=30
//
// Safe behaviour:
// - If no hotel_id, returns demo zeros.
// - If ai_usage_daily table not present, returns demo zeros.
// - Never throws to the frontend; always 200 with JSON.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

// CORS helpers ---------------------------------------------------------------
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function monthUtcLabel(d = new Date()): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`; // e.g. "2025-11"
}

// Entry point ---------------------------------------------------------------
serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const pathname = url.pathname; // e.g. /functions/v1/ai/usage
  const isUsageRoute = pathname.endsWith("/usage");

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
    return json({ error: "backend_not_configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: authHeader,
        apikey: supabaseAnonKey,
      },
    },
  });

  try {
    if (req.method === "GET" && isUsageRoute) {
      return await handleUsage(url, client);
    }

    return json({ error: "not_found", message: "Unknown /ai route" }, 404);
  } catch (err) {
    console.error("Unhandled error in /ai function", err);
    return json({ error: "internal_error" }, 500);
  }
});

/* ------------------------------------------------------------------ */
/*  /ai/usage                                                          */
/* ------------------------------------------------------------------ */

/**
 * Suggested table (future; we fail-soft if not present):
 *
 *   create table ai_usage_daily (
 *     hotel_id   uuid   not null,
 *     day        date   not null,
 *     feature    text   not null,   -- 'reviews', 'guest-chat', etc.
 *     requests   integer not null default 0,
 *     tokens_in  bigint  not null default 0,
 *     tokens_out bigint  not null default 0,
 *     cost_inr   numeric not null default 0,
 *     primary key (hotel_id, day, feature)
 *   );
 *
 * For now, if this table or columns don’t exist, we just return demo zeros.
 */
async function handleUsage(url: URL, client: any): Promise<Response> {
  const hotelId = url.searchParams.get("hotel_id");
  const daysParam = Number(url.searchParams.get("days") ?? "30");
  const windowDays = isNaN(daysParam) || daysParam <= 0 ? 30 : daysParam;
  const month_utc = monthUtcLabel();

  // No hotel_id → frontend still gets a valid payload
  if (!hotelId) {
    return json(buildDemoUsage(null, windowDays, month_utc));
  }

  try {
    const today = new Date();
    const from = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );
    from.setUTCDate(from.getUTCDate() - (windowDays - 1));
    const fromStr = from.toISOString().slice(0, 10); // YYYY-MM-DD

    const { data, error } = await client
      .from("ai_usage_daily")
      .select("day, feature, requests, tokens_in, tokens_out, cost_inr")
      .eq("hotel_id", hotelId)
      .gte("day", fromStr);

    if (error) throw error;

    const byFeatureMap = new Map<string, any>();

    let totalRequests = 0;
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalCostInr = 0;

    for (const row of data ?? []) {
      const feature = row.feature || "other";

      const entry =
        byFeatureMap.get(feature) ??
        {
          feature,
          requests: 0,
          tokens_in: 0,
          tokens_out: 0,
          cost_inr: 0,
        };

      const reqs = Number(row.requests ?? 0);
      const tIn = Number(row.tokens_in ?? 0);
      const tOut = Number(row.tokens_out ?? 0);
      const cost = Number(row.cost_inr ?? 0);

      entry.requests += reqs;
      entry.tokens_in += tIn;
      entry.tokens_out += tOut;
      entry.cost_inr += cost;

      byFeatureMap.set(feature, entry);

      totalRequests += reqs;
      totalTokensIn += tIn;
      totalTokensOut += tOut;
      totalCostInr += cost;
    }

    const totals = {
      requests: totalRequests,
      tokens: {
        input: totalTokensIn,
        output: totalTokensOut,
        total: totalTokensIn + totalTokensOut,
      },
      cost: {
        currency: "INR",
        total_inr: totalCostInr,
      },
    };

    const by_feature = Array.from(byFeatureMap.values());

    // Simple monthly budget model – tweak later if you add a real table
    const used_tokens = totals.tokens.total;
    const budget_tokens = 200_000;

    return json({
      hotel_id: hotelId,
      window_days: windowDays,
      demo: false,
      totals,
      by_feature,
      // Extra fields for the dashboard widget
      month_utc,
      used_tokens,
      budget_tokens,
      summary: {
        month_utc,
        used_tokens,
        budget_tokens,
      },
    });
  } catch (err) {
    console.error("handleUsage error", err);
    // Fail-soft: return demo zeros so Owner Dashboard never breaks
    return json(buildDemoUsage(hotelId, windowDays, month_utc));
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function buildDemoUsage(
  hotelId: string | null,
  windowDays: number,
  month_utcParam?: string,
) {
  const month_utc = month_utcParam ?? monthUtcLabel();
  const used_tokens = 0;
  const budget_tokens = 200_000;

  return {
    hotel_id: hotelId,
    window_days: windowDays,
    demo: true,
    totals: {
      requests: 0,
      tokens: {
        input: 0,
        output: 0,
        total: 0,
      },
      cost: {
        currency: "INR",
        total_inr: 0,
      },
    },
    by_feature: [] as Array<any>,
    month_utc,
    used_tokens,
    budget_tokens,
    summary: {
      month_utc,
      used_tokens,
      budget_tokens,
    },
  };
}
