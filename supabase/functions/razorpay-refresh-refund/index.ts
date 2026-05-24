// supabase/functions/razorpay-refresh-refund/index.ts
//
// POST: refresh the status of a refund row by querying Razorpay directly.
// Used when the `refund.processed` / `refund.failed` webhook never arrived
// (network drop, dashboard misconfig, Razorpay-side delay). Without this,
// a row submitted to Razorpay can sit PENDING in our DB forever even though
// the money has already moved.
//
// Inputs (JSON):
//   { refund_id: uuid }   // our refunds.id
//
// Outputs (200):
//   {
//     ok: true,
//     refund_id: uuid,
//     our_status: "PENDING" | "PROCESSED" | "FAILED",
//     razorpay_status: "pending" | "processed" | "failed",
//     changed: boolean,        // did this call flip the DB state?
//   }
//
// Behaviour:
//   • Only acts on rows that already have a `razorpay_refund_id`. Rows
//     without one are owned by the pending-banner / create-refund flow.
//   • If Razorpay reports `processed`, flip our row → PROCESSED. The
//     existing `trg_refund_to_folio` trigger then writes the folio REFUND
//     entry, same as the webhook path.
//   • If Razorpay reports `failed`, flip → FAILED with failure_reason.
//   • Idempotent — calling twice when already PROCESSED returns
//     `changed: false`, no DB writes.
//
// Auth: user JWT, finance-manager role on the refund's hotel.

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
  razorpayBasicAuth,
  RAZORPAY_API_BASE,
} from "../_shared/razorpay.ts";
import { logError, logInfo } from "../_shared/observability.ts";

const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";

if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  logError("razorpay-refresh-refund.boot", new Error("Razorpay credentials missing"));
}

type Body = { refund_id?: string };

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // 1. Auth
  const authed = await assertAuthed(req);
  if (authed instanceof Response) return authed;
  const { user } = authed;

  // 2. Body
  let body: Body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }
  if (!body.refund_id) return json(400, { error: "refund_id required" });

  const svc = supabaseService();

  // 3. Load the refund row
  const { data: refund, error: refErr } = await svc
    .from("refunds")
    .select("id, hotel_id, payment_id, amount, currency, status, razorpay_refund_id, reason")
    .eq("id", body.refund_id)
    .maybeSingle();
  if (refErr || !refund) return json(404, { error: "Refund row not found" });

  if (!refund.razorpay_refund_id) {
    // This row was never submitted to Razorpay (still in PENDING-no-id state).
    // Use razorpay-create-refund with { refund_id } to submit it.
    return json(409, {
      error: "Refund has not been submitted to Razorpay yet",
      code: "NOT_SUBMITTED",
    });
  }

  // 4. RBAC: caller must be finance-manager-or-above for the refund's hotel
  const sbAnon = supabaseAnon(req);
  const { data: canAuthorize, error: rbacErr } = await sbAnon.rpc(
    "vaiyu_is_hotel_finance_manager",
    { p_hotel_id: refund.hotel_id },
  );
  if (rbacErr) return json(500, { error: "Authorization check failed" });
  if (canAuthorize !== true) {
    return json(403, { error: "Forbidden: finance manager role required" });
  }

  // 4a. Rate limit — status refresh is cheap, but staff might mash the
  //     button. 30/min user-keyed is plenty.
  const limit = await rateLimitForUser(svc, user.id, "razorpay-refresh-refund", 30);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSec);

  // 5. Call Razorpay GET /refunds/{id}
  let rzpRes: Response;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    rzpRes = await fetch(`${RAZORPAY_API_BASE}/refunds/${refund.razorpay_refund_id}`, {
      method: "GET",
      headers: {
        Authorization: razorpayBasicAuth(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET),
      },
      signal: ctrl.signal,
    });
    clearTimeout(t);
  } catch (e) {
    logError("razorpay-refresh-refund.network", e, {
      refund_id: refund.id,
      razorpay_refund_id: refund.razorpay_refund_id,
    });
    return json(504, {
      error: "Razorpay timed out — try again in a moment",
      refund_id: refund.id,
    });
  }

  if (!rzpRes.ok) {
    const errText = await rzpRes.text().catch(() => "");
    logError("razorpay-refresh-refund.rejected", new Error(`Razorpay returned ${rzpRes.status}`), {
      refund_id: refund.id,
      razorpay_refund_id: refund.razorpay_refund_id,
      status: rzpRes.status,
      response: errText.slice(0, 500),
    });
    let safeMsg = "Razorpay rejected the lookup";
    try {
      const parsed = JSON.parse(errText);
      if (parsed?.error?.description) safeMsg = parsed.error.description;
    } catch { /* ignore */ }
    return json(502, { error: safeMsg, code: "LOOKUP_REJECTED", refund_id: refund.id });
  }

  const remote = await rzpRes.json();
  // Razorpay's refund object: { id, entity:"refund", amount, status: "pending"|"processed"|"failed", ... }
  const rzpStatus: string = String(remote?.status ?? "").toLowerCase();

  // 6. Reconcile our state with Razorpay's.
  let newStatus: "PENDING" | "PROCESSED" | "FAILED" | null = null;
  let failureReason: string | null = null;

  if (rzpStatus === "processed") {
    newStatus = "PROCESSED";
  } else if (rzpStatus === "failed") {
    newStatus = "FAILED";
    // Razorpay typically attaches a description on failure.
    const desc =
      remote?.notes?.failure_reason ??
      remote?.error_description ??
      remote?.failure_reason ??
      "Refund failed at Razorpay";
    failureReason = typeof desc === "string" ? desc : "Refund failed at Razorpay";
  } else {
    // Still pending at Razorpay (or unknown state we shouldn't act on)
    newStatus = null;
  }

  let changed = false;
  if (newStatus && newStatus !== refund.status) {
    const update: Record<string, unknown> = {
      status: newStatus,
      razorpay_response: remote,
    };
    if (newStatus === "PROCESSED") update.processed_at = new Date().toISOString();
    if (newStatus === "FAILED") update.failure_reason = failureReason;

    const { error: updErr } = await svc
      .from("refunds")
      .update(update)
      .eq("id", refund.id)
      .eq("status", refund.status); // optimistic concurrency: only update if still in the state we read
    if (updErr) {
      logError("razorpay-refresh-refund.update_failed", updErr, {
        refund_id: refund.id,
        target_status: newStatus,
      });
      return json(500, { error: "Could not update refund status", refund_id: refund.id });
    }
    changed = true;
    logInfo("razorpay-refresh-refund.reconciled", "Refund status reconciled", {
      refund_id: refund.id,
      razorpay_refund_id: refund.razorpay_refund_id,
      from: refund.status,
      to: newStatus,
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      refund_id: refund.id,
      our_status: newStatus ?? refund.status,
      razorpay_status: rzpStatus,
      changed,
    }),
    { status: 200, headers: CORS_HEADERS },
  );
});
