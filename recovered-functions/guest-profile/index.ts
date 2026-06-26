// supabase/functions/guest-profile/index.ts
//
// GET /functions/v1/guest-profile?hotel_id=...&booking_code=...&account_id=...
//
// Unified "Guest profile" payload for Owner/Desk screens.
// - Stays (bookings)
// - Tickets
// - Orders
// - Reviews
// - Credits (optional, via account_id)
// - Preferences (placeholder, for future guest-preferences table)
// - Soft signals (placeholder, for future behaviour signals table)
//
// Safe behaviour:
// - If required params are missing, returns { ok:false, ... } with 200.
// - If a table/column does not exist, that section is returned as [].
// - Never throws to the frontend; all errors are logged server-side.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

// -----------------------------------------------------------------------------
// CORS + JSON helpers
// -----------------------------------------------------------------------------
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

// Small helper so we don’t crash if a query fails or a table is missing.
async function safeSelect<T>(
  label: string,
  fn: () => Promise<{ data: T[] | null; error: any }>
): Promise<T[]> {
  try {
    const { data, error } = await fn();
    if (error) {
      console.error(`[guest-profile] ${label} error`, error);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.error(`[guest-profile] ${label} unexpected error`, err);
    return [];
  }
}

// -----------------------------------------------------------------------------
// Main handler
// -----------------------------------------------------------------------------
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[guest-profile] Missing SUPABASE_URL or SUPABASE_ANON_KEY");
    return json(
      {
        ok: false,
        error: "backend_not_configured",
      },
      500
    );
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
    if (req.method !== "GET") {
      // We still return 200 so the frontend never explodes.
      return json({
        ok: false,
        error: "method_not_allowed",
        message: "Only GET is supported",
      });
    }
    return await handleGuestProfile(url, client);
  } catch (err) {
    console.error("[guest-profile] Unhandled error", err);
    return json({
      ok: false,
      error: "internal_error",
    });
  }
});

// -----------------------------------------------------------------------------
// /guest-profile handler
// -----------------------------------------------------------------------------
async function handleGuestProfile(url: URL, client: any) {
  // Accept both snake_case and camelCase for convenience
  const hotelId =
    url.searchParams.get("hotel_id") ??
    url.searchParams.get("hotelId") ??
    null;
  const bookingCode =
    url.searchParams.get("booking_code") ??
    url.searchParams.get("bookingCode") ??
    null;
  const email = url.searchParams.get("email") ?? null;
  const phone = url.searchParams.get("phone") ?? null;

  // For credits, caller can optionally provide an account_id
  const accountId =
    url.searchParams.get("account_id") ??
    url.searchParams.get("accountId") ??
    null;

  if (!hotelId) {
    // Soft-fail: 200 with ok:false so the UI can show a friendly error.
    return json({
      ok: false,
      error: "hotel_id_required",
      message: "Pass ?hotel_id=… in the query string.",
      hotel_id: null,
      guest: null,
      stays: [],
      tickets: [],
      orders: [],
      reviews: [],
      credits: [],
      preferences: [],
      signals: [],
    });
  }

  // ---------------------------------------------------------------------------
  // 1) Stays (bookings) – this is our anchor.
  // ---------------------------------------------------------------------------
  let bookingsWhere = client
    .from("bookings")
    .select(
      "code, hotel_id, guest_name, phone, email, check_in, check_out, consent_reviews"
    )
    .eq("hotel_id", hotelId);

  if (bookingCode) {
    bookingsWhere = bookingsWhere.eq("code", bookingCode);
  } else if (email) {
    bookingsWhere = bookingsWhere.eq("email", email);
  } else if (phone) {
    bookingsWhere = bookingsWhere.eq("phone", phone);
  }

  // Recent first, but cap the result so we don’t flood the UI.
  const stays = await safeSelect<any>("bookings", () =>
    bookingsWhere
      .order("check_in", { ascending: false })
      .limit(50)
  );

  const bookingCodes: string[] = [];
  for (const b of stays) {
    if (b?.code && !bookingCodes.includes(b.code)) {
      bookingCodes.push(b.code);
    }
  }

  // If caller gave an explicit booking_code, make sure it’s included.
  if (bookingCode && !bookingCodes.includes(bookingCode)) {
    bookingCodes.push(bookingCode);
  }

  // Derive a simple guest summary from the most recent stay.
  let guestSummary: {
    name: string | null;
    email: string | null;
    phone: string | null;
    latest_booking_code: string | null;
    total_stays: number;
  } | null = null;

  if (stays.length > 0) {
    const latest = stays[0];
    guestSummary = {
      name: latest.guest_name ?? null,
      email: latest.email ?? null,
      phone: latest.phone ?? null,
      latest_booking_code: latest.code ?? null,
      total_stays: stays.length,
    };
  }

  // ---------------------------------------------------------------------------
  // 2) Tickets – keyed by booking_code
  // ---------------------------------------------------------------------------
  let tickets: any[] = [];
  if (bookingCodes.length > 0) {
    tickets = await safeSelect<any>("tickets", () =>
      client
        .from("tickets")
        .select(
          "id, hotel_id, booking_code, service_id, status, priority, source, sla_minutes_snapshot, due_at, created_at, updated_at"
        )
        .eq("hotel_id", hotelId)
        .in("booking_code", bookingCodes)
        .order("created_at", { ascending: false })
        .limit(200)
    );
  }

  // ---------------------------------------------------------------------------
  // 3) Orders – keyed by booking_code
  // Guardrails: do NOT reference orders.ticket_id or orders.delivered_at.
  // ---------------------------------------------------------------------------
  let orders: any[] = [];
  if (bookingCodes.length > 0) {
    orders = await safeSelect<any>("orders", () =>
      client
        .from("orders")
        .select(
          "id, hotel_id, booking_code, room, item_key, qty, price, status, created_at, closed_at"
        )
        .eq("hotel_id", hotelId)
        .in("booking_code", bookingCodes)
        .order("created_at", { ascending: false })
        .limit(200)
    );
  }

  // ---------------------------------------------------------------------------
  // 4) Reviews – keyed by booking_code
  // Guardrails: reviews table has NO staff_id column.
  // ---------------------------------------------------------------------------
  let reviews: any[] = [];
  if (bookingCodes.length > 0) {
    reviews = await safeSelect<any>("reviews", () =>
      client
        .from("reviews")
        .select(
          "id, hotel_id, booking_code, rating, title, body, status, created_at, published_at"
        )
        .eq("hotel_id", hotelId)
        .in("booking_code", bookingCodes)
        .order("created_at", { ascending: false })
        .limit(200)
    );
  }

  // ---------------------------------------------------------------------------
  // 5) Credits – optional, via account_id (from referrals/credits system)
  // We’re intentionally loose here and just return whatever shape the table has.
  // ---------------------------------------------------------------------------
  let credits: any[] = [];
  if (accountId) {
    credits = await safeSelect<any>("credit_balances", () =>
      client
        .from("credit_balances")
        .select("*")
        .eq("account_id", accountId)
        .order("expires_at", { ascending: true })
    );
  }

  // ---------------------------------------------------------------------------
  // 6) Preferences & soft signals (future-proof placeholders)
  //
  // For now, we keep them as empty arrays so the frontend can render a
  // “Preferences & soft signals” section safely. Later, you can wire these
  // to tables like `guest_preferences` or `guest_signals` without changing
  // the response shape.
  // ---------------------------------------------------------------------------
  const preferences: any[] = [];
  const signals: any[] = [];

  // ---------------------------------------------------------------------------
  // Final payload
  // ---------------------------------------------------------------------------
  return json({
    ok: true,
    hotel_id: hotelId,
    guest: guestSummary,
    stays,
    tickets,
    orders,
    reviews,
    credits,
    preferences,
    signals,
  });
}
