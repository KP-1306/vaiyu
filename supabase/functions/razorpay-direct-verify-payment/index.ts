// supabase/functions/razorpay-direct-verify-payment/index.ts
//
// DIRECT-mode verify. Same surface as razorpay-verify-payment, with two
// differences:
//   1. HMAC signature verify uses the HOTEL's key_secret (not the platform's).
//   2. Razorpay GET /payments/{id} cross-check uses the HOTEL's basic auth.
//   3. payments.razorpay_mode = 'DIRECT' is set at insert time so a future
//      refund knows to use the hotel's keys.

import { serve as __serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withObs as __withObs } from "../_shared/http-telemetry.ts";
const serve = (h: (req: Request) => Response | Promise<Response>) => __serve(__withObs("razorpay-direct-verify-payment", h));
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
  hmacHex,
  timingSafeEqualHex,
  rupeesToPaise,
  mapRazorpayMethod,
  razorpayBasicAuth,
  RAZORPAY_API_BASE,
} from "../_shared/razorpay.ts";
import { loadHotelDirectKeys } from "../_shared/razorpay-direct.ts";
import { logError, logWarn, logInfo } from "../_shared/observability.ts";

type VerifyBody = {
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  razorpay_signature?: string;
  hotel_id?: string;
  booking_id?: string;
  folio_id?: string;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body: VerifyBody;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }
  const {
    razorpay_order_id, razorpay_payment_id, razorpay_signature,
    hotel_id, booking_id, folio_id,
  } = body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature ||
      !hotel_id || !booking_id || !folio_id) {
    return json(400, { error: "Missing required fields" });
  }

  // 1. Authz (staff or guest-on-booking)
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

  const limit = await rateLimitForUser(svc, user.id, "razorpay-direct-verify-payment", 60);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSec);

  // 2. Load hotel's DIRECT credentials
  let keys;
  try {
    keys = await loadHotelDirectKeys(svc, hotel_id);
  } catch (e) {
    logError("razorpay-direct-verify-payment.load_keys", e, { hotel_id });
    return json(412, {
      error: "Hotel's Razorpay credentials are not configured",
      code: "DIRECT_CREDENTIALS_MISSING",
    });
  }

  // 3. HMAC signature verify against the HOTEL's key_secret
  const expected = await hmacHex(
    keys.keySecret,
    `${razorpay_order_id}|${razorpay_payment_id}`,
  );
  if (!timingSafeEqualHex(expected, razorpay_signature)) {
    logWarn("razorpay-direct-verify-payment.signature_mismatch", "Invalid signature", {
      razorpay_order_id, razorpay_payment_id, user_id: user.id, hotel_id,
    });
    return json(400, { error: "INVALID_SIGNATURE" });
  }

  // 4. Idempotency check — same as Route version
  {
    const { data: existing } = await svc
      .from("payments")
      .select("id")
      .eq("razorpay_payment_id", razorpay_payment_id)
      .maybeSingle();
    if (existing) {
      return new Response(
        JSON.stringify({ ok: true, paymentDbId: existing.id, deduped: true }),
        { status: 200, headers: CORS_HEADERS },
      );
    }
  }

  // 5. Re-derive canonical amount from folio
  const { data: folio, error: fErr } = await svc
    .from("folios")
    .select("id, status")
    .eq("id", folio_id)
    .maybeSingle();
  if (fErr || !folio) return json(404, { error: "Folio not found" });

  const { data: entries } = await svc
    .from("folio_entries")
    .select("amount")
    .eq("folio_id", folio_id);
  const balanceRupees = (entries ?? []).reduce(
    (sum, r: { amount: number | string }) => sum + Number(r.amount),
    0,
  );
  const expectedPaise = rupeesToPaise(balanceRupees);
  if (expectedPaise <= 0) return json(400, { error: "No outstanding balance" });

  // 6. Razorpay cross-check — use HOTEL's basic auth this time
  let captured: any;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(`${RAZORPAY_API_BASE}/payments/${razorpay_payment_id}`, {
      headers: { Authorization: razorpayBasicAuth(keys.keyId, keys.keySecret) },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      logError("razorpay-direct-verify-payment.lookup_failed",
        new Error(`Razorpay GET /payments returned ${res.status}`),
        { razorpay_payment_id, status: res.status });
      return json(502, { error: "Payment provider lookup failed" });
    }
    captured = await res.json();
  } catch (e) {
    logError("razorpay-direct-verify-payment.lookup_error", e, { razorpay_payment_id });
    return json(504, { error: "Payment provider timed out" });
  }

  if (captured.order_id !== razorpay_order_id) return json(409, { error: "ORDER_MISMATCH" });
  if (captured.status !== "captured") return json(409, { error: "NOT_CAPTURED", status: captured.status });
  if (Number(captured.amount) !== expectedPaise) {
    return json(409, { error: "AMOUNT_MISMATCH", razorpay_amount: captured.amount, expected: expectedPaise });
  }

  // 7. Insert payment row — tagged with razorpay_mode='DIRECT' so the
  //    refund flow later picks the right credential path even if the
  //    hotel switches to ROUTE in the future.
  const method = mapRazorpayMethod(captured.method);
  const { data: inserted, error: insErr } = await svc
    .from("payments")
    .insert({
      hotel_id,
      booking_id,
      folio_id,
      amount: balanceRupees,
      currency: "INR",
      method,
      status: "COMPLETED",
      reference_id: razorpay_payment_id,
      collected_by: user.id,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      razorpay_mode: "DIRECT",        // ← the new bit
      notes: `Razorpay ${method} via direct hotel account`,
    })
    .select("id")
    .maybeSingle();

  if (insErr) {
    if ((insErr as any).code === "23505") {
      const { data: row } = await svc
        .from("payments")
        .select("id")
        .eq("razorpay_payment_id", razorpay_payment_id)
        .maybeSingle();
      return new Response(
        JSON.stringify({ ok: true, paymentDbId: row?.id ?? null, deduped: true }),
        { status: 200, headers: CORS_HEADERS },
      );
    }
    logError("razorpay-direct-verify-payment.insert_failed", insErr, {
      booking_id, hotel_id, razorpay_payment_id,
    });
    return json(500, { error: "Could not record payment" });
  }

  logInfo("razorpay-direct-verify-payment.captured", "Payment recorded", {
    payment_db_id: inserted?.id,
    razorpay_payment_id, razorpay_order_id,
    booking_id, hotel_id, amount: balanceRupees, method, via: authz.via,
  });
  return new Response(
    JSON.stringify({ ok: true, paymentDbId: inserted?.id ?? null, deduped: false }),
    { status: 200, headers: CORS_HEADERS },
  );
});
