// supabase/functions/razorpay-direct-refresh-refund/index.ts
//
// DIRECT-mode refund status refresh. Same surface as razorpay-refresh-refund,
// with two differences:
//   1. Requires refunds.razorpay_mode == 'DIRECT' (mode-routing safety).
//   2. Razorpay GET /refunds/{id} uses HOTEL's basic auth.

import { serve as __serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withObs as __withObs } from "../_shared/http-telemetry.ts";
const serve = (h: (req: Request) => Response | Promise<Response>) => __serve(__withObs("razorpay-direct-refresh-refund", h));
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
import { loadHotelDirectKeys } from "../_shared/razorpay-direct.ts";
import { logError, logInfo } from "../_shared/observability.ts";

type Body = { refund_id?: string };

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const authed = await assertAuthed(req);
  if (authed instanceof Response) return authed;
  const { user } = authed;

  let body: Body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }
  if (!body.refund_id) return json(400, { error: "refund_id required" });

  const svc = supabaseService();

  const { data: refund, error: refErr } = await svc
    .from("refunds")
    .select("id, hotel_id, payment_id, amount, currency, status, razorpay_refund_id, razorpay_mode, reason")
    .eq("id", body.refund_id)
    .maybeSingle();
  if (refErr || !refund) return json(404, { error: "Refund row not found" });

  if (!refund.razorpay_refund_id) {
    return json(409, {
      error: "Refund has not been submitted to Razorpay yet",
      code: "NOT_SUBMITTED",
    });
  }
  if (refund.razorpay_mode !== "DIRECT") {
    return json(409, {
      error: "This refund was issued via Route, not DIRECT. Use the Route refresh flow.",
      code: "WRONG_MODE",
      actual_mode: refund.razorpay_mode,
    });
  }

  const sbAnon = supabaseAnon(req);
  const { data: canAuthorize, error: rbacErr } = await sbAnon.rpc(
    "vaiyu_is_hotel_finance_manager",
    { p_hotel_id: refund.hotel_id },
  );
  if (rbacErr) return json(500, { error: "Authorization check failed" });
  if (canAuthorize !== true) return json(403, { error: "Forbidden: finance manager role required" });

  const limit = await rateLimitForUser(svc, user.id, "razorpay-direct-refresh-refund", 30);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSec);

  let keys;
  try {
    keys = await loadHotelDirectKeys(svc, refund.hotel_id);
  } catch (e) {
    logError("razorpay-direct-refresh-refund.load_keys", e, { hotel_id: refund.hotel_id });
    return json(412, {
      error: "Hotel's Razorpay credentials are not available",
      code: "DIRECT_CREDENTIALS_MISSING",
    });
  }

  let rzpRes: Response;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    rzpRes = await fetch(`${RAZORPAY_API_BASE}/refunds/${refund.razorpay_refund_id}`, {
      method: "GET",
      headers: { Authorization: razorpayBasicAuth(keys.keyId, keys.keySecret) },
      signal: ctrl.signal,
    });
    clearTimeout(t);
  } catch (e) {
    logError("razorpay-direct-refresh-refund.network", e, {
      refund_id: refund.id, razorpay_refund_id: refund.razorpay_refund_id,
    });
    return json(504, {
      error: "Razorpay timed out — try again in a moment",
      refund_id: refund.id,
    });
  }

  if (!rzpRes.ok) {
    const errText = await rzpRes.text().catch(() => "");
    logError("razorpay-direct-refresh-refund.rejected", new Error(`Razorpay returned ${rzpRes.status}`), {
      refund_id: refund.id, razorpay_refund_id: refund.razorpay_refund_id,
      status: rzpRes.status, response: errText.slice(0, 500),
    });
    let safeMsg = "Razorpay rejected the lookup";
    try {
      const parsed = JSON.parse(errText);
      if (parsed?.error?.description) safeMsg = parsed.error.description;
    } catch { /* ignore */ }
    return json(502, { error: safeMsg, code: "LOOKUP_REJECTED", refund_id: refund.id });
  }

  const remote = await rzpRes.json();
  const rzpStatus: string = String(remote?.status ?? "").toLowerCase();

  let newStatus: "PENDING" | "PROCESSED" | "FAILED" | null = null;
  let failureReason: string | null = null;
  if (rzpStatus === "processed") {
    newStatus = "PROCESSED";
  } else if (rzpStatus === "failed") {
    newStatus = "FAILED";
    const desc =
      remote?.notes?.failure_reason ??
      remote?.error_description ??
      remote?.failure_reason ??
      "Refund failed at Razorpay";
    failureReason = typeof desc === "string" ? desc : "Refund failed at Razorpay";
  } else {
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
      .eq("status", refund.status);
    if (updErr) {
      logError("razorpay-direct-refresh-refund.update_failed", updErr, {
        refund_id: refund.id, target_status: newStatus,
      });
      return json(500, { error: "Could not update refund status", refund_id: refund.id });
    }
    changed = true;
    logInfo("razorpay-direct-refresh-refund.reconciled", "Refund status reconciled", {
      refund_id: refund.id, razorpay_refund_id: refund.razorpay_refund_id,
      from: refund.status, to: newStatus,
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
