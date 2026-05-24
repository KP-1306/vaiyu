// supabase/functions/razorpay-create-order/index.ts
//
// POST: creates a Razorpay Order with Route `transfers[]` so funds settle
// directly to the hotel's Linked Account on capture, minus the platform fee.
//
// Inputs (JSON body):
//   { hotel_id: string, booking_id: string }
//
// Outputs (200):
//   {
//     order_id, key_id (public), amount (paise), currency,
//     hotel_name, customer: { name?, email?, phone? }
//   }
//
// Auth: user JWT required. Caller must be a finance-manager-or-above for the
// hotel (gated via `vaiyu_is_hotel_finance_manager`).
//
// Amount is derived **server-side** by summing the booking's open folio.
// Client-supplied amounts are never trusted.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  CORS_HEADERS,
  json,
  preflight,
  canActOnBookingPayments,
  supabaseService,
  rateLimitForUser,
  tooManyRequests,
} from "../_shared/auth.ts";
import {
  rupeesToPaise,
  razorpayBasicAuth,
  RAZORPAY_API_BASE,
} from "../_shared/razorpay.ts";
import { logError, logWarn, logInfo } from "../_shared/observability.ts";

const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";

if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  logError("razorpay-create-order.boot", new Error("Razorpay credentials missing"));
}

type CreateOrderBody = {
  hotel_id?: string;
  booking_id?: string;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // 1. Parse body
  let body: CreateOrderBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const { hotel_id, booking_id } = body;
  if (!hotel_id || !booking_id) {
    return json(400, { error: "hotel_id and booking_id required" });
  }

  // 2. Authorization: staff (finance manager) OR guest paying their own folio
  const authz = await canActOnBookingPayments(req, booking_id);
  if (!authz.allowed) {
    return json(authz.userId ? 403 : 401, {
      error: authz.userId
        ? "Forbidden: must be hotel finance manager or the booking's guest"
        : "Unauthorized",
    });
  }
  const user = { id: authz.userId! };

  // 2a. Rate limit — 30 orders/minute per user is generous (real walk-in
  //     and guest checkout each fire 1 call per pay attempt). Above that
  //     it's almost certainly a bug or spam.
  const svcForLimit = supabaseService();
  const limit = await rateLimitForUser(svcForLimit, user.id, "razorpay-create-order", 30);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSec);

  // 4. Service-role: hotel config + booking + folio total
  const svc = supabaseService();

  const { data: hotel, error: hErr } = await svc
    .from("hotels")
    .select("id, name, currency_code, razorpay_account_id, razorpay_platform_fee_pct")
    .eq("id", hotel_id)
    .maybeSingle();
  if (hErr || !hotel) {
    return json(404, { error: "Hotel not found" });
  }
  if (!hotel.razorpay_account_id) {
    return json(412, {
      error: "Razorpay not configured for this hotel",
      code: "NO_LINKED_ACCOUNT",
    });
  }

  const { data: booking, error: bErr } = await svc
    .from("bookings")
    .select("id, hotel_id, code, guest_id, guest_name, phone, email")
    .eq("id", booking_id)
    .maybeSingle();
  if (bErr || !booking) return json(404, { error: "Booking not found" });
  if (booking.hotel_id !== hotel_id) {
    return json(403, { error: "Booking does not belong to hotel" });
  }

  // Open folio for this booking
  const { data: folio, error: fErr } = await svc
    .from("folios")
    .select("id, status")
    .eq("booking_id", booking_id)
    .eq("status", "OPEN")
    .maybeSingle();
  if (fErr) return json(500, { error: "Folio lookup failed" });
  if (!folio) return json(404, { error: "Open folio not found for booking" });

  // Sum entries: charges positive, payments negative → balance owed
  const { data: entries, error: eErr } = await svc
    .from("folio_entries")
    .select("amount")
    .eq("folio_id", folio.id);
  if (eErr) return json(500, { error: "Folio entries lookup failed" });

  const balanceRupees = (entries ?? []).reduce(
    (sum, r: { amount: number | string }) => sum + Number(r.amount),
    0,
  );
  if (balanceRupees <= 0) {
    return json(400, { error: "Nothing to charge", code: "NO_BALANCE_DUE" });
  }

  const paise = rupeesToPaise(balanceRupees);
  if (paise < 100) {
    // Razorpay's minimum order is ₹1.00 (100 paise)
    return json(400, { error: "Amount below Razorpay minimum (₹1.00)" });
  }

  const feePaise = Math.round((paise * Number(hotel.razorpay_platform_fee_pct ?? 0)) / 100);
  const transferPaise = paise - feePaise;

  // 5. Create Razorpay Order with transfers[] (Route)
  const receipt = `walkin_${booking_id.slice(0, 8)}_${Math.floor(Date.now() / 1000)}`;
  const orderBody = {
    amount: paise,
    currency: "INR",
    receipt,
    notes: { booking_id, hotel_id, folio_id: folio.id },
    transfers: [
      {
        account: hotel.razorpay_account_id,
        amount: transferPaise,
        currency: "INR",
        on_hold: 0,
        notes: { booking_id, hotel_id },
      },
    ],
  };

  let orderRes: Response;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    orderRes = await fetch(`${RAZORPAY_API_BASE}/orders`, {
      method: "POST",
      headers: {
        Authorization: razorpayBasicAuth(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(orderBody),
      signal: ctrl.signal,
    });
    clearTimeout(t);
  } catch (e) {
    logError("razorpay-create-order.network", e, { hotel_id, booking_id });
    return json(504, { error: "Payment provider timed out" });
  }

  if (!orderRes.ok) {
    const errText = await orderRes.text().catch(() => "");
    logError("razorpay-create-order.rejected", new Error(`Razorpay returned ${orderRes.status}`), {
      hotel_id, booking_id, status: orderRes.status, response: errText.slice(0, 500),
    });
    let safeMsg = "Payment provider rejected request";
    try {
      const parsed = JSON.parse(errText);
      if (parsed?.error?.description) safeMsg = parsed.error.description;
    } catch {
      // ignore
    }
    return json(502, { error: safeMsg });
  }

  const order = await orderRes.json();
  // Expected fields: id (order_xxx), amount, currency, status

  // 6. Optional: fetch guest contact for prefill
  const customer: { name?: string; email?: string; phone?: string } = {};
  if (booking.guest_id) {
    const { data: g } = await svc
      .from("guests")
      .select("name, email, phone")
      .eq("id", booking.guest_id)
      .maybeSingle();
    if (g) {
      if (g.name) customer.name = g.name;
      if (g.email) customer.email = g.email;
      if (g.phone) customer.phone = g.phone;
    }
  }
  if (!customer.name && booking.guest_name) customer.name = booking.guest_name;
  if (!customer.email && booking.email) customer.email = booking.email;
  if (!customer.phone && booking.phone) customer.phone = booking.phone;

  return new Response(
    JSON.stringify({
      order_id: order.id,
      key_id: RAZORPAY_KEY_ID,
      amount: paise,
      currency: "INR",
      hotel_name: hotel.name,
      booking_code: booking.code,
      folio_id: folio.id,
      customer,
      // Echo back the staff who created the order so the client can attribute
      // collected_by on the verify step (the server re-derives this anyway).
      requested_by_user_id: user.id,
    }),
    { status: 200, headers: CORS_HEADERS },
  );
});
