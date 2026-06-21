// supabase/functions/razorpay-create-refund/index.ts
//
// POST: staff-initiated refund against a Razorpay payment. Calls
//   Razorpay POST /v1/payments/{razorpay_payment_id}/refund
// with `reverse_all: 1` so funds come back from the hotel's Linked
// Account, not from the platform's account.
//
// Inputs (JSON):
//   {
//     payment_id: uuid,    // our payments.id (NOT razorpay_payment_id)
//     amount?: number,     // rupees; defaults to full refundable amount
//     reason?: string,     // staff note, surfaced in audit + folio
//   }
//
// Outputs (200):
//   { ok: true, refund_id: uuid, razorpay_refund_id: string, status: "pending" }
//
// Auth: user JWT, finance-manager role on the hotel.

import { serve as __serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withObs as __withObs } from "../_shared/http-telemetry.ts";
const serve = (h: (req: Request) => Response | Promise<Response>) => __serve(__withObs("razorpay-create-refund", h));
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
import { logError, logInfo } from "../_shared/observability.ts";

const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";

if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  logError("razorpay-create-refund.boot", new Error("Razorpay credentials missing"));
}

type CreateRefundBody = {
  // New refund: caller specifies the payment to refund.
  payment_id?: string;
  amount?: number;
  reason?: string;
  // Existing pending refund (e.g. auto-flagged by the cancel trigger):
  // caller provides the refund_id and we execute the Razorpay call against
  // the already-inserted PENDING row instead of creating a fresh one.
  refund_id?: string;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // 1. Auth
  const authed = await assertAuthed(req);
  if (authed instanceof Response) return authed;
  const { user } = authed;

  // 2. Body
  let body: CreateRefundBody;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }
  if (!body.payment_id && !body.refund_id) {
    return json(400, { error: "payment_id or refund_id required" });
  }

  const svc = supabaseService();

  // 2a. If processing an existing pending refund row, resolve payment_id +
  //     amount + reason from the row. Validates: row must be PENDING and
  //     not yet associated with a Razorpay refund (no double-processing).
  if (body.refund_id) {
    const { data: pending, error: pErr } = await svc
      .from("refunds")
      .select("id, payment_id, amount, reason, status, razorpay_refund_id")
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
      return json(409, {
        error: "Refund already submitted to Razorpay",
        code: "ALREADY_SUBMITTED",
      });
    }
    // Backfill body.* from the pending row so the rest of the flow below
    // can ignore which entry path was used.
    body.payment_id = pending.payment_id;
    body.amount = Number(pending.amount);
    body.reason = body.reason ?? pending.reason ?? undefined;
  }

  // 3. Look up the source payment using SERVICE ROLE (we trust the auth gate
  //    below); this lets us read the row before RBAC enforcement so we can
  //    discover the hotel_id for the RBAC RPC call.
  const { data: pay, error: payErr } = await svc
    .from("payments")
    .select("id, hotel_id, booking_id, folio_id, amount, currency, status, method, razorpay_order_id, razorpay_payment_id")
    .eq("id", body.payment_id!)
    .maybeSingle();

  if (payErr || !pay) return json(404, { error: "Payment not found" });
  if (pay.status !== "COMPLETED") {
    return json(409, { error: "Only COMPLETED payments can be refunded", code: "NOT_COMPLETED" });
  }
  if (!pay.razorpay_payment_id) {
    return json(409, { error: "This payment was not collected via Razorpay; refund manually", code: "NOT_RAZORPAY" });
  }

  // 4. RBAC: caller must be finance-manager-or-above for THIS hotel
  const sbAnon = supabaseAnon(req);
  const { data: canAuthorize, error: rbacErr } = await sbAnon.rpc(
    "vaiyu_is_hotel_finance_manager",
    { p_hotel_id: pay.hotel_id },
  );
  if (rbacErr) return json(500, { error: "Authorization check failed" });
  if (canAuthorize !== true) {
    return json(403, { error: "Forbidden: finance manager role required" });
  }

  // 4a. Rate limit — refunds are rare, retries possible on network blips.
  //     10/minute is the right ceiling.
  const limit = await rateLimitForUser(svc, user.id, "razorpay-create-refund", 10);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSec);

  // 5. Compute refund amount.
  //    For new refunds: sum existing refunds (PENDING + PROCESSED) and reject
  //    if requested > refundable.
  //    For processing a flagged pending row (body.refund_id present): the
  //    pending row was already counted, so we exclude it from the "already
  //    refunded" tally to avoid double-counting.
  const { data: existing } = await svc
    .from("refunds")
    .select("id, amount, status")
    .eq("payment_id", pay.id);
  const alreadyRefunded = (existing ?? [])
    .filter((r: { id: string; status: string }) =>
      (r.status === "PROCESSED" || r.status === "PENDING") &&
      r.id !== body.refund_id, // exclude the one we're about to process
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

  // 6. Resolve the refunds row that will hold this operation:
  //    - If processing an existing pending row, reuse it (no insert).
  //    - Otherwise create a fresh PENDING row that the Razorpay call below
  //      will tag with `razorpay_refund_id`.
  let refundRow: { id: string } | null;
  if (body.refund_id) {
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
        reverse_all: true,                     // Route-safe default
        initiated_by: user.id,
      })
      .select("id")
      .maybeSingle();

    if (insErr || !inserted) {
      logError("razorpay-create-refund.insert_failed", insErr ?? new Error("no row returned"), {
        payment_id: pay.id,
        booking_id: pay.booking_id,
      });
      return json(500, { error: "Could not initiate refund" });
    }
    refundRow = inserted;
  }

  // 7. Call Razorpay /payments/{id}/refund. reverse_all=1 pulls the funds
  //    back from the Linked Account via the existing transfer.
  let rzpRes: Response;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    rzpRes = await fetch(`${RAZORPAY_API_BASE}/payments/${pay.razorpay_payment_id}/refund`, {
      method: "POST",
      headers: {
        Authorization: razorpayBasicAuth(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: rupeesToPaise(requested),
        speed: "normal",
        reverse_all: 1,                       // critical for Route-split payments
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
    // Network failure — mark refund row FAILED so it doesn't sit PENDING
    logError("razorpay-create-refund.network", e, {
      refund_id: refundRow.id,
      payment_id: pay.id,
    });
    await svc.from("refunds").update({
      status: "FAILED",
      failure_reason: "Razorpay timed out or network error",
    }).eq("id", refundRow.id);
    return json(504, { error: "Razorpay timed out", refund_id: refundRow.id });
  }

  if (!rzpRes.ok) {
    const errText = await rzpRes.text().catch(() => "");
    logError("razorpay-create-refund.rejected", new Error(`Razorpay returned ${rzpRes.status}`), {
      refund_id: refundRow.id,
      status: rzpRes.status,
      response: errText.slice(0, 500),
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

  // 8. Persist the Razorpay refund id. Status remains PENDING — Razorpay
  //    sends `refund.processed` over the webhook once the refund actually
  //    settles, which flips status → PROCESSED and triggers the folio entry.
  const { error: updErr } = await svc
    .from("refunds")
    .update({
      razorpay_refund_id: razorpayRefundId ?? null,
      razorpay_response: refund,
      // For pending rows the trigger inserted with initiated_by=NULL, tag the
      // staff member who actually pushed the button. Harmless overwrite for
      // freshly-inserted rows (same value as the INSERT above).
      initiated_by: user.id,
    })
    .eq("id", refundRow.id);
  if (updErr) {
    // Refund succeeded at Razorpay but we couldn't tag our row — webhook will
    // reconcile by razorpay_refund_id. Log loudly so we can audit drift.
    logError("razorpay-create-refund.tag_failed", updErr, {
      refund_id: refundRow.id,
      razorpay_refund_id: razorpayRefundId,
    });
  } else {
    logInfo("razorpay-create-refund.created", "Refund created", {
      refund_id: refundRow.id,
      razorpay_refund_id: razorpayRefundId,
      payment_id: pay.id,
      amount: requested,
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
