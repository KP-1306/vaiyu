// supabase/functions/razorpay-direct-create-refund/index.ts
//
// DIRECT-mode refund. Same surface as razorpay-create-refund, with three
// differences:
//   1. Uses the HOTEL's key_id + key_secret (loaded from hotels.razorpay_direct_*).
//   2. NO `reverse_all` parameter — there are no transfers[] to reverse;
//      funds come straight from the hotel's own Razorpay balance.
//   3. Rejects payments where razorpay_mode != 'DIRECT' (the Route refund
//      function handles ROUTE payments; the frontend facade routes by mode).
//   4. Tags refunds.razorpay_mode = 'DIRECT'.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  CORS_HEADERS,
  json,
  preflight,
  assertAuthed,
  supabaseAnon,
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

type Body = {
  payment_id?: string;
  amount?: number;
  reason?: string;
  refund_id?: string;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const authed = await assertAuthed(req);
  if (authed instanceof Response) return authed;
  const { user } = authed;

  let body: Body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }
  if (!body.payment_id && !body.refund_id) {
    return json(400, { error: "payment_id or refund_id required" });
  }

  const svc = supabaseService();

  // 1. Resolve refund-id-only path to payment_id/amount/reason (mirrors Route version)
  if (body.refund_id) {
    const { data: pending, error: pErr } = await svc
      .from("refunds")
      .select("id, payment_id, amount, reason, status, razorpay_refund_id, razorpay_mode")
      .eq("id", body.refund_id)
      .maybeSingle();
    if (pErr || !pending) return json(404, { error: "Refund row not found" });
    if (pending.status !== "PENDING") {
      return json(409, {
        error: "Refund already processed or failed",
        code: "NOT_PENDING",
        status: pending.status,
      });
    }
    if (pending.razorpay_refund_id) {
      return json(409, { error: "Refund already submitted to Razorpay", code: "ALREADY_SUBMITTED" });
    }
    body.payment_id = pending.payment_id;
    body.amount = Number(pending.amount);
    body.reason = body.reason ?? pending.reason ?? undefined;
  }

  // 2. Load the source payment + verify mode == DIRECT
  const { data: pay, error: payErr } = await svc
    .from("payments")
    .select("id, hotel_id, booking_id, folio_id, amount, currency, status, method, razorpay_order_id, razorpay_payment_id, razorpay_mode")
    .eq("id", body.payment_id!)
    .maybeSingle();
  if (payErr || !pay) return json(404, { error: "Payment not found" });
  if (pay.status !== "COMPLETED") {
    return json(409, { error: "Only COMPLETED payments can be refunded", code: "NOT_COMPLETED" });
  }
  if (!pay.razorpay_payment_id) {
    return json(409, { error: "This payment was not collected via Razorpay; refund manually", code: "NOT_RAZORPAY" });
  }
  if (pay.razorpay_mode !== "DIRECT") {
    return json(409, {
      error: "This payment was collected via Route, not DIRECT. Use the Route refund flow.",
      code: "WRONG_MODE",
      actual_mode: pay.razorpay_mode,
    });
  }

  // 3. RBAC
  const sbAnon = supabaseAnon(req);
  const { data: canAuthorize, error: rbacErr } = await sbAnon.rpc(
    "vaiyu_is_hotel_finance_manager",
    { p_hotel_id: pay.hotel_id },
  );
  if (rbacErr) return json(500, { error: "Authorization check failed" });
  if (canAuthorize !== true) return json(403, { error: "Forbidden: finance manager role required" });

  const limit = await rateLimitForUser(svc, user.id, "razorpay-direct-create-refund", 10);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSec);

  // 4. Load the HOTEL'S Razorpay keys (the ones used to capture this payment originally)
  let keys;
  try {
    keys = await loadHotelDirectKeys(svc, pay.hotel_id);
  } catch (e) {
    logError("razorpay-direct-create-refund.load_keys", e, { payment_id: pay.id, hotel_id: pay.hotel_id });
    return json(412, {
      error: "Hotel's Razorpay credentials are not available — cannot refund. Restore credentials in Owner Settings.",
      code: "DIRECT_CREDENTIALS_MISSING",
    });
  }

  // 5. Compute refundable amount (same logic as Route version)
  const { data: existing } = await svc
    .from("refunds")
    .select("id, amount, status")
    .eq("payment_id", pay.id);
  const alreadyRefunded = (existing ?? [])
    .filter((r: { id: string; status: string }) =>
      (r.status === "PROCESSED" || r.status === "PENDING") &&
      r.id !== body.refund_id,
    )
    .reduce((s: number, r: { amount: number | string }) => s + Number(r.amount), 0);
  const refundable = Number(pay.amount) - alreadyRefunded;
  const requested = body.amount === undefined ? refundable : Number(body.amount);
  if (!(requested > 0)) return json(400, { error: "amount must be > 0" });
  if (requested - refundable > 0.001) {
    return json(409, {
      error: "Amount exceeds refundable balance",
      code: "EXCEEDS_REFUNDABLE",
      refundable,
      already_refunded: alreadyRefunded,
    });
  }

  // 6. Resolve / create refund row
  let refundRow: { id: string } | null;
  if (body.refund_id) {
    // Atomic claim — UPDATE with a WHERE clause that matches only an
    // unclaimed PENDING row. If two staff click "Process" within
    // milliseconds, only ONE update returns a row; the other gets 0 rows
    // back and we refuse — preventing two concurrent Razorpay /refund
    // calls against the same row (which would refund the customer twice).
    // We use `initiated_by` as the claim marker since it's harmless
    // bookkeeping and survives even if the Razorpay call later fails.
    const { data: claimed, error: claimErr } = await svc
      .from("refunds")
      .update({ initiated_by: user.id, razorpay_mode: "DIRECT" })
      .eq("id", body.refund_id)
      .eq("status", "PENDING")
      .is("razorpay_refund_id", null)
      .select("id");
    if (claimErr) {
      logError("razorpay-direct-create-refund.claim_failed", claimErr, { refund_id: body.refund_id });
      return json(500, { error: "Could not claim refund row for processing" });
    }
    if (!claimed || claimed.length === 0) {
      // Another request beat us to it — could be a re-click, two staff,
      // or a stale tab. The row is either already submitted to Razorpay
      // or no longer in PENDING state.
      return json(409, {
        error: "Refund is already being processed or has been submitted",
        code: "ALREADY_CLAIMED",
      });
    }
    refundRow = { id: body.refund_id };
  } else {
    const { data: inserted, error: insErr } = await svc
      .from("refunds")
      .insert({
        hotel_id: pay.hotel_id,
        booking_id: pay.booking_id,
        folio_id: pay.folio_id,
        payment_id: pay.id,
        amount: requested,
        currency: pay.currency ?? "INR",
        reason: body.reason ?? null,
        status: "PENDING",
        reverse_all: false,                  // not applicable to DIRECT
        razorpay_mode: "DIRECT",
        initiated_by: user.id,
      })
      .select("id")
      .maybeSingle();
    if (insErr || !inserted) {
      logError("razorpay-direct-create-refund.insert_failed", insErr ?? new Error("no row returned"), {
        payment_id: pay.id, booking_id: pay.booking_id,
      });
      return json(500, { error: "Could not initiate refund" });
    }
    refundRow = inserted;
  }

  // 7. Call Razorpay /payments/{id}/refund using HOTEL's basic auth.
  //    No reverse_all — there's no transfer to reverse.
  let rzpRes: Response;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    rzpRes = await fetch(`${RAZORPAY_API_BASE}/payments/${pay.razorpay_payment_id}/refund`, {
      method: "POST",
      headers: {
        Authorization: razorpayBasicAuth(keys.keyId, keys.keySecret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: rupeesToPaise(requested),
        speed: "normal",
        notes: {
          refund_db_id: refundRow.id,
          booking_id: pay.booking_id,
          hotel_id: pay.hotel_id,
          reason: body.reason ?? "",
        },
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
  } catch (e) {
    logError("razorpay-direct-create-refund.network", e, {
      refund_id: refundRow.id, payment_id: pay.id,
    });
    await svc.from("refunds").update({
      status: "FAILED",
      failure_reason: "Razorpay timed out or network error",
    }).eq("id", refundRow.id);
    return json(504, { error: "Razorpay timed out", refund_id: refundRow.id });
  }

  if (!rzpRes.ok) {
    const errText = await rzpRes.text().catch(() => "");
    logError("razorpay-direct-create-refund.rejected", new Error(`Razorpay returned ${rzpRes.status}`), {
      refund_id: refundRow.id, status: rzpRes.status, response: errText.slice(0, 500),
    });
    let safeMsg = "Razorpay rejected the refund";
    let code = "REFUND_REJECTED";
    try {
      const parsed = JSON.parse(errText);
      if (parsed?.error?.description) safeMsg = parsed.error.description;
      if (parsed?.error?.code) code = parsed.error.code;
    } catch { /* ignore */ }
    await svc.from("refunds").update({
      status: "FAILED",
      failure_reason: safeMsg,
      razorpay_response: { status: rzpRes.status, raw: errText },
    }).eq("id", refundRow.id);
    return json(502, { error: safeMsg, code, refund_id: refundRow.id });
  }

  const refund = await rzpRes.json();
  const razorpayRefundId: string | undefined = refund.id;

  const { error: updErr } = await svc
    .from("refunds")
    .update({
      razorpay_refund_id: razorpayRefundId ?? null,
      razorpay_response: refund,
      razorpay_mode: "DIRECT",
      initiated_by: user.id,
    })
    .eq("id", refundRow.id);
  if (updErr) {
    logError("razorpay-direct-create-refund.tag_failed", updErr, {
      refund_id: refundRow.id, razorpay_refund_id: razorpayRefundId,
    });
  } else {
    logInfo("razorpay-direct-create-refund.created", "Refund created", {
      refund_id: refundRow.id, razorpay_refund_id: razorpayRefundId,
      payment_id: pay.id, amount: requested,
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      refund_id: refundRow.id,
      razorpay_refund_id: razorpayRefundId ?? null,
      status: refund.status ?? "pending",
      amount: requested,
    }),
    { status: 200, headers: CORS_HEADERS },
  );
});
