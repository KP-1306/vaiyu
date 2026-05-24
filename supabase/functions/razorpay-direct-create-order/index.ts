// supabase/functions/razorpay-direct-create-order/index.ts
//
// DIRECT-mode order creation. Same surface as razorpay-create-order, with
// three changes vs the Route version:
//   1. Auth uses the HOTEL's own Razorpay key_id + key_secret (loaded
//      from hotels.razorpay_direct_*).
//   2. No `transfers[]` array — funds settle directly to the hotel's
//      bank account; vaiyu never intermediates.
//   3. Returns the hotel's key_id (not the platform's) for Razorpay
//      Checkout to use.
//
// The Route version remains 100% untouched. The frontend facade routes
// to this function only when hotels.razorpay_mode === 'DIRECT'.

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
import { loadHotelDirectKeys } from "../_shared/razorpay-direct.ts";
import { logError, logInfo } from "../_shared/observability.ts";

type CreateOrderBody = {
  hotel_id?: string;
  booking_id?: string;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body: CreateOrderBody;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }
  const { hotel_id, booking_id } = body;
  if (!hotel_id || !booking_id) return json(400, { error: "hotel_id and booking_id required" });

  // 1. Authorization: staff (finance manager) OR guest paying their own folio.
  //    Same gate as the Route version.
  const authz = await canActOnBookingPayments(req, booking_id);
  if (!authz.allowed) {
    return json(authz.userId ? 403 : 401, {
      error: authz.userId
        ? "Forbidden: must be hotel finance manager or the booking's guest"
        : "Unauthorized",
    });
  }
  const user = { id: authz.userId! };

  const svc = supabaseService();

  // 1a. Rate limit — same ceiling as Route (30/min user-keyed)
  const limit = await rateLimitForUser(svc, user.id, "razorpay-direct-create-order", 30);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSec);

  // 2. Hotel + booking + folio
  const { data: hotel, error: hErr } = await svc
    .from("hotels")
    .select("id, name, currency_code, razorpay_mode")
    .eq("id", hotel_id)
    .maybeSingle();
  if (hErr || !hotel) return json(404, { error: "Hotel not found" });
  if (hotel.razorpay_mode !== "DIRECT") {
    return json(412, {
      error: "Hotel is not in DIRECT mode. Use the Route flow or have the hotel set credentials.",
      code: "NOT_DIRECT_MODE",
    });
  }

  // 3. Load hotel's own Razorpay credentials (decrypted)
  let keys;
  try {
    keys = await loadHotelDirectKeys(svc, hotel_id);
  } catch (e) {
    logError("razorpay-direct-create-order.load_keys", e, { hotel_id });
    return json(412, {
      error: "Hotel's Razorpay credentials are not configured",
      code: "DIRECT_CREDENTIALS_MISSING",
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

  const { data: folio, error: fErr } = await svc
    .from("folios")
    .select("id, status")
    .eq("booking_id", booking_id)
    .eq("status", "OPEN")
    .maybeSingle();
  if (fErr) return json(500, { error: "Folio lookup failed" });
  if (!folio) return json(404, { error: "Open folio not found for booking" });

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
    return json(400, { error: "Amount below Razorpay minimum (₹1.00)" });
  }

  // 4. Create order on the HOTEL's Razorpay account. No transfers[] — funds
  //    settle straight to the hotel's bank per their Razorpay settlement schedule.
  const receipt = `walkin_${booking_id.slice(0, 8)}_${Math.floor(Date.now() / 1000)}`;
  const orderBody = {
    amount: paise,
    currency: "INR",
    receipt,
    // notes.hotel_id is critical: the webhook receiver uses it to look up
    // which hotel this event belongs to (single webhook URL, multi-hotel routing).
    notes: { booking_id, hotel_id, folio_id: folio.id },
  };

  let orderRes: Response;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    orderRes = await fetch(`${RAZORPAY_API_BASE}/orders`, {
      method: "POST",
      headers: {
        Authorization: razorpayBasicAuth(keys.keyId, keys.keySecret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(orderBody),
      signal: ctrl.signal,
    });
    clearTimeout(t);
  } catch (e) {
    logError("razorpay-direct-create-order.network", e, { hotel_id, booking_id });
    return json(504, { error: "Payment provider timed out" });
  }

  if (!orderRes.ok) {
    const errText = await orderRes.text().catch(() => "");
    logError("razorpay-direct-create-order.rejected", new Error(`Razorpay returned ${orderRes.status}`), {
      hotel_id, booking_id, status: orderRes.status, response: errText.slice(0, 500),
    });
    let safeMsg = "Payment provider rejected request";
    try {
      const parsed = JSON.parse(errText);
      if (parsed?.error?.description) safeMsg = parsed.error.description;
    } catch { /* ignore */ }
    return json(502, { error: safeMsg });
  }

  const order = await orderRes.json();

  // 5. Customer prefill — same logic as Route version
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

  logInfo("razorpay-direct-create-order.success", "Order created", {
    hotel_id, booking_id, order_id: order.id, amount_paise: paise,
  });

  return new Response(
    JSON.stringify({
      order_id: order.id,
      key_id: keys.keyId,         // hotel's own key_id (NOT platform)
      amount: paise,
      currency: "INR",
      hotel_name: hotel.name,
      booking_code: booking.code,
      folio_id: folio.id,
      customer,
      requested_by_user_id: user.id,
    }),
    { status: 200, headers: CORS_HEADERS },
  );
});
