// supabase/functions/me/index.ts
// Handles: // New Code
//   GET /functions/v1/me/stays?limit=10
//   GET /functions/v1/me/spend?years=5
//   GET /functions/v1/me/reviews?limit=50
//   GET /functions/v1/me/referrals

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.48.0";

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

serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const pathname = url.pathname; // e.g. /functions/v1/me/stays

  // Decide which sub-route we are on by suffix:
  let resource: "stays" | "spend" | "reviews" | "referrals" | null = null;
  if (pathname.endsWith("/stays")) resource = "stays";
  else if (pathname.endsWith("/spend")) resource = "spend";
  else if (pathname.endsWith("/reviews")) resource = "reviews";
  else if (pathname.endsWith("/referrals")) resource = "referrals";

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
    return json({ error: "backend_not_configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";

  const client: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: authHeader,
        apikey: supabaseAnonKey,
      },
    },
  });

  // Best-effort get current user (safe to fail; we fall back to demo data)
  let userId: string | null = null;
  try {
    const {
      data: { user },
      error,
    } = await client.auth.getUser();
    if (error) console.error("auth.getUser error", error);
    userId = user?.id ?? null;
  } catch (err) {
    console.error("auth.getUser threw", err);
  }

  try {
    if (req.method === "GET" && resource === "stays") {
      return await handleStays(url, client, userId);
    }
    if (req.method === "GET" && resource === "spend") {
      return await handleSpend(url, client, userId);
    }
    if (req.method === "GET" && resource === "reviews") {
      return await handleReviews(url, client, userId);
    }
    if (req.method === "GET" && resource === "referrals") {
      return await handleReferrals(url, client, userId);
    }

    // If we reach here, path is /me or an unknown suffix
    return json({ error: "not_found", message: "Unknown /me route" }, 404);
  } catch (err) {
    console.error("Unhandled error in /me function", err);
    return json({ error: "internal_error" }, 500);
  }
});

/* ------------------------------------------------------------------ */
/*  /me/stays                                                          */
/* ------------------------------------------------------------------ */

async function handleStays(
  url: URL,
  client: SupabaseClient,
  userId: string | null,
): Promise<Response> {
  const limit = Number(url.searchParams.get("limit") ?? "10");

  if (!userId) {
    return json({
      items: [],
      stats: { total_stays: 0, nights: 0 },
      demo: true,
    });
  }

  try {
    const { data, error } = await client
      .from("bookings")
      .select(
        `
        id,
        status,
        check_in,
        check_out,
        total_amount,
        hotel:hotels (
          id,
          slug,
          name,
          city,
          state
        )
      `,
      )
      .eq("user_id", userId) // TODO: adjust to your FK column if different
      .order("check_in", { ascending: false })
      .limit(limit);

    if (error) throw error;

    const items =
      (data ?? []).map((row: any) => {
        const checkIn = row.check_in as string | null;
        const checkOut = row.check_out as string | null;

        const nights =
          checkIn && checkOut
            ? Math.max(
                1,
                Math.round(
                  (new Date(checkOut).getTime() -
                    new Date(checkIn).getTime()) /
                    (1000 * 60 * 60 * 24),
                ),
              )
            : null;

        return {
          id: row.id,
          hotel_slug: row.hotel?.slug ?? null,
          hotel_name: row.hotel?.name ?? null,
          city: row.hotel?.city ?? null,
          state: row.hotel?.state ?? null,
          status: row.status ?? "unknown",
          check_in: checkIn,
          check_out: checkOut,
          nights,
          total_spend: row.total_amount ?? null,
        };
      }) ?? [];

    const totals = items.reduce(
      (acc: { total_stays: number; nights: number }, s: any) => {
        acc.total_stays += 1;
        if (typeof s.nights === "number") acc.nights += s.nights;
        return acc;
      },
      { total_stays: 0, nights: 0 },
    );

    return json({
      items,
      stats: totals,
      demo: false,
    });
  } catch (err) {
    console.error("handleStays error", err);
    return json({
      items: [],
      stats: { total_stays: 0, nights: 0 },
      demo: true,
    });
  }
}

/* ------------------------------------------------------------------ */
/*  /me/spend                                                          */
/* ------------------------------------------------------------------ */

async function handleSpend(
  url: URL,
  client: SupabaseClient,
  userId: string | null,
): Promise<Response> {
  const yearsParam = Number(url.searchParams.get("years") ?? "5");
  const yearsWindow = isNaN(yearsParam) || yearsParam <= 0 ? 5 : yearsParam;

  if (!userId) {
    return json({
      currency: "INR",
      total: 0,
      years: [],
      demo: true,
    });
  }

  try {
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const fromYear = currentYear - (yearsWindow - 1);

    const { data, error } = await client
      .from("orders")
      .select("total_amount, currency, created_at")
      .eq("user_id", userId) // TODO: adjust FK column if needed
      .gte("created_at", `${fromYear}-01-01`);

    if (error) throw error;

    const buckets = new Map<number, { year: number; amount: number }>();
    let currency = "INR";

    (data ?? []).forEach((row: any) => {
      const ts = row.created_at ? new Date(row.created_at) : null;
      if (!ts || isNaN(ts.getTime())) return;
      const year = ts.getUTCFullYear();
      if (year < fromYear) return;

      currency = row.currency ?? currency;
      const prev = buckets.get(year) ?? { year, amount: 0 };
      prev.amount += Number(row.total_amount ?? 0);
      buckets.set(year, prev);
    });

    const years: { year: number; amount: number }[] = [];
    for (let y = fromYear; y <= currentYear; y++) {
      years.push({
        year: y,
        amount: buckets.get(y)?.amount ?? 0,
      });
    }

    const total = years.reduce((sum, y) => sum + y.amount, 0);

    return json({
      currency,
      total,
      years,
      demo: false,
    });
  } catch (err) {
    console.error("handleSpend error", err);
    return json({
      currency: "INR",
      total: 0,
      years: [],
      demo: true,
    });
  }
}

/* ------------------------------------------------------------------ */
/*  /me/reviews                                                        */
/* ------------------------------------------------------------------ */

async function handleReviews(
  url: URL,
  client: SupabaseClient,
  userId: string | null,
): Promise<Response> {
  const limit = Number(url.searchParams.get("limit") ?? "50");

  if (!userId) {
    return json({ items: [], demo: true });
  }

  try {
    const { data, error } = await client
      .from("reviews")
      .select(
        `
        id,
        rating,
        title,
        created_at,
        hotel:hotels (
          id,
          slug,
          name
        )
      `,
      )
      .eq("user_id", userId) // TODO: adjust FK column if needed
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    const items =
      (data ?? []).map((row: any) => ({
        id: row.id,
        rating: row.rating,
        title: row.title,
        created_at: row.created_at,
        hotel_slug: row.hotel?.slug ?? null,
        hotel_name: row.hotel?.name ?? null,
      })) ?? [];

    return json({ items, demo: false });
  } catch (err) {
    console.error("handleReviews error", err);
    return json({ items: [], demo: true });
  }
}

/* ------------------------------------------------------------------ */
/*  /me/referrals                                                      */
/* ------------------------------------------------------------------ */

async function handleReferrals(
  _url: URL,
  client: SupabaseClient,
  userId: string | null,
): Promise<Response> {
  if (!userId) {
    return json({
      code: null,
      total_referred: 0,
      total_earned: 0,
      currency: "INR",
      demo: true,
    });
  }

  try {
    const { data: referral, error: refErr } = await client
      .from("referrals")
      .select("code, total_referred")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (refErr && refErr.code !== "PGRST116") {
      throw refErr;
    }

    const { data: balance, error: balErr } = await client
      .from("credit_balances")
      .select("balance, currency")
      .eq("account_id", userId)
      .maybeSingle();

    if (balErr && balErr.code !== "PGRST116") {
      throw balErr;
    }

    return json({
      code: referral?.code ?? null,
      total_referred: referral?.total_referred ?? 0,
      total_earned: balance?.balance ?? 0,
      currency: balance?.currency ?? "INR",
      demo: false,
    });
  } catch (err) {
    console.error("handleReferrals error", err);
    return json({
      code: null,
      total_referred: 0,
      total_earned: 0,
      currency: "INR",
      demo: true,
    });
  }
}
