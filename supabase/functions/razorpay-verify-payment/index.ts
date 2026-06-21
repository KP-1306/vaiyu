// supabase/functions/razorpay-verify-payment/index.ts
//
// POST: verifies the Razorpay Checkout success callback and records the
// payment server-side. This is the *fast path* — the webhook is the safety
// net that catches dropped client connections.
//
// Inputs (JSON body):
//   {
//     razorpay_order_id, razorpay_payment_id, razorpay_signature,
//     hotel_id, booking_id, folio_id
//   }
//
// Outputs (200):
//   { ok: true, paymentDbId: string, deduped: boolean }
//
// Auth: user JWT, finance-manager role for hotel.
// Amount is *re-derived* server-side; client never controls how much is
// recorded. Razorpay GET /payments/{id} cross-check confirms the captured
// payment exists and matches our derived amount.

import { serve as __serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withObs as __withObs } from "../_shared/http-telemetry.ts";
const serve = (h: (req: Request) => Response | Promise<Response>) => __serve(__withObs("razorpay-verify-payment", h));
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
import { logError, logWarn, logInfo } from "../_shared/observability.ts";

const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";

if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  logError("razorpay-verify-payment.boot", new Error("Razorpay credentials missing"));
}

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

  // 1. Parse body
  let body: VerifyBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    hotel_id,
    booking_id,
    folio_id,
  } = body;
  if (
    !razorpay_order_id ||
    !razorpay_payment_id ||
    !razorpay_signature ||
    !hotel_id ||
    !booking_id ||
    !folio_id
  ) {
    return json(400, { error: "Missing required fields" });
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

  // 2a. Rate limit — 60 verifies/minute per user. Legitimate client retries
  //     on network drops can hit several; webhook safety net handles the
  //     rest if the user exhausts their quota.
  const svcForLimit = supabaseService();
  const limit = await rateLimitForUser(svcForLimit, user.id, "razorpay-verify-payment", 60);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSec);

  // 4. Verify HMAC signature (this is the cryptographic proof that the
  //    Razorpay client returned a real payment). Format: sha256(order|pay).
  const expected = await hmacHex(
    RAZORPAY_KEY_SECRET,
    `${razorpay_order_id}|${razorpay_payment_id}`,
  );
  if (!timingSafeEqualHex(expected, razorpay_signature)) {
    logWarn("razorpay-verify-payment.signature_mismatch", "Client supplied an invalid signature", {
      razorpay_order_id,
      razorpay_payment_id,
      user_id: user.id,
    });
    return json(400, { error: "INVALID_SIGNATURE" });
  }

  const svc = supabaseService();

  // 5. Idempotency: if a payments row already exists for this payment_id
  //    (webhook may have raced ahead), just return success.
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

  // 6. Re-derive canonical amount from folio entries (charges - prior payments).
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
  if (expectedPaise <= 0) {
    return json(400, { error: "No outstanding balance" });
  }

  // 7. Cross-check via Razorpay GET /payments/{id} — proves the payment was
  //    actually captured at Razorpay (not just signed) and amount matches.
  let captured: any;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(`${RAZORPAY_API_BASE}/payments/${razorpay_payment_id}`, {
      headers: { Authorization: razorpayBasicAuth(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET) },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      logError("razorpay-verify-payment.lookup_failed", new Error(`Razorpay GET /payments returned ${res.status}`), {
        razorpay_payment_id, status: res.status,
      });
      return json(502, { error: "Payment provider lookup failed" });
    }
    captured = await res.json();
  } catch (e) {
    logError("razorpay-verify-payment.lookup_error", e, { razorpay_payment_id });
    return json(504, { error: "Payment provider timed out" });
  }

  if (captured.order_id !== razorpay_order_id) {
    return json(409, { error: "ORDER_MISMATCH" });
  }
  if (captured.status !== "captured") {
    return json(409, { error: "NOT_CAPTURED", status: captured.status });
  }
  if (Number(captured.amount) !== expectedPaise) {
    return json(409, {
      error: "AMOUNT_MISMATCH",
      razorpay_amount: captured.amount,
      expected: expectedPaise,
    });
  }

  // 8. Insert payment row (status COMPLETED → trg_payment_to_folio creates
  //    the folio_entries PAYMENT row automatically).
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
      notes: `Razorpay ${method} via Linked Account`,
    })
    .select("id")
    .maybeSingle();

  if (insErr) {
    // Unique violation = webhook beat us between our SELECT and INSERT
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
    logError("razorpay-verify-payment.insert_failed", insErr, {
      booking_id, hotel_id, razorpay_payment_id,
    });
    return json(500, { error: "Could not record payment" });
  }

  logInfo("razorpay-verify-payment.captured", "Payment recorded", {
    payment_db_id: inserted?.id,
    razorpay_payment_id,
    razorpay_order_id,
    booking_id,
    hotel_id,
    amount: balanceRupees,
    method,
    via: authz.via,
  });
  return new Response(
    JSON.stringify({ ok: true, paymentDbId: inserted?.id ?? null, deduped: false }),
    { status: 200, headers: CORS_HEADERS },
  );
});
