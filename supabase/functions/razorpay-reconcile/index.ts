// supabase/functions/razorpay-reconcile/index.ts
//
// POST: spot-check every Razorpay payment and refund we recorded in a date
// range against Razorpay's source-of-truth API. Catches "silent drift" —
// cases where our DB state and Razorpay's diverged (dropped webhook,
// dashboard tweak, partial failure). Returns a structured discrepancy
// report; does NOT auto-fix.
//
// Why not auto-fix here:
//   • Reconciliation should be a read-only audit by default. Owners run it
//     on demand and decide what to do.
//   • For refund-status drift specifically, the per-row "Refresh status"
//     button (razorpay-refresh-refund) is the action; it flips one row with
//     full context. Bulk auto-flip from reconcile would be surprising and
//     would conflate "audit" with "fix".
//
// Inputs (JSON):
//   {
//     hotel_id: uuid,
//     from?: ISO string,  // default: now − 7d
//     to?:   ISO string,  // default: now
//   }
//
// Outputs (200):
//   {
//     ok: true,
//     from, to,
//     payments_checked: number,
//     refunds_checked: number,
//     discrepancies: Array<{
//       kind: "PAYMENT" | "REFUND",
//       severity: "INFO" | "WARN" | "ERROR",
//       our_id: uuid,
//       razorpay_id: string | null,
//       message: string,
//       our: Record<string, unknown>,
//       razorpay: Record<string, unknown> | null,
//     }>,
//   }
//
// Auth: user JWT, finance-manager role on the hotel.
// Range cap: 31 days (bounds Razorpay API call count; run multiple times for longer windows).

import { serve as __serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withObs as __withObs } from "../_shared/http-telemetry.ts";
const serve = (h: (req: Request) => Response | Promise<Response>) => __serve(__withObs("razorpay-reconcile", h));
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
  rupeesToPaise,
  RAZORPAY_API_BASE,
} from "../_shared/razorpay.ts";
import { logError, logInfo, logWarn } from "../_shared/observability.ts";

const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";

if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  logError("razorpay-reconcile.boot", new Error("Razorpay credentials missing"));
}

type Body = {
  hotel_id?: string;
  from?: string;
  to?: string;
};

type Severity = "INFO" | "WARN" | "ERROR";

interface Discrepancy {
  kind: "PAYMENT" | "REFUND";
  severity: Severity;
  our_id: string;
  razorpay_id: string | null;
  message: string;
  our: Record<string, unknown>;
  razorpay: Record<string, unknown> | null;
}

const MAX_RANGE_DAYS = 31;
const ROW_LIMIT = 200; // per type — keeps Razorpay API calls bounded per run

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
  if (!body.hotel_id) return json(400, { error: "hotel_id required" });

  // 3. Date range — default last 7 days, max 31 days, must be from <= to
  const now = new Date();
  const to = body.to ? new Date(body.to) : now;
  const from = body.from ? new Date(body.from) : new Date(now.getTime() - 7 * 86_400_000);
  if (Number.isNaN(to.getTime()) || Number.isNaN(from.getTime())) {
    return json(400, { error: "Invalid date format" });
  }
  if (from > to) return json(400, { error: "from must be <= to" });
  const rangeDays = (to.getTime() - from.getTime()) / 86_400_000;
  if (rangeDays > MAX_RANGE_DAYS) {
    return json(400, {
      error: `Range too large (${Math.round(rangeDays)}d). Max ${MAX_RANGE_DAYS}d per run.`,
      code: "RANGE_TOO_LARGE",
    });
  }

  const svc = supabaseService();

  // 4. RBAC: caller must be finance-manager-or-above for this hotel
  const sbAnon = supabaseAnon(req);
  const { data: canAuthorize, error: rbacErr } = await sbAnon.rpc(
    "vaiyu_is_hotel_finance_manager",
    { p_hotel_id: body.hotel_id },
  );
  if (rbacErr) return json(500, { error: "Authorization check failed" });
  if (canAuthorize !== true) {
    return json(403, { error: "Forbidden: finance manager role required" });
  }

  // 4a. Rate limit — reconcile is heavy (one Razorpay call per row); cap
  //     hard so a stuck client can't hammer their account.
  const limit = await rateLimitForUser(svc, user.id, "razorpay-reconcile", 5);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSec);

  // 5. Pull our payments and refunds in the window. Both queries scoped to
  //    hotel_id — no cross-hotel leak even if caller forges the body.
  const { data: payRows, error: payErr } = await svc
    .from("payments")
    .select("id, amount, currency, status, razorpay_order_id, razorpay_payment_id, created_at")
    .eq("hotel_id", body.hotel_id)
    .not("razorpay_payment_id", "is", null)
    .gte("created_at", from.toISOString())
    .lte("created_at", to.toISOString())
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT);
  if (payErr) {
    logError("razorpay-reconcile.payments_query", payErr, { hotel_id: body.hotel_id });
    return json(500, { error: "Could not load payments" });
  }

  const { data: refRows, error: refErr } = await svc
    .from("refunds")
    .select("id, amount, currency, status, razorpay_refund_id, initiated_at, processed_at, failure_reason")
    .eq("hotel_id", body.hotel_id)
    .not("razorpay_refund_id", "is", null)
    .gte("initiated_at", from.toISOString())
    .lte("initiated_at", to.toISOString())
    .order("initiated_at", { ascending: false })
    .limit(ROW_LIMIT);
  if (refErr) {
    logError("razorpay-reconcile.refunds_query", refErr, { hotel_id: body.hotel_id });
    return json(500, { error: "Could not load refunds" });
  }

  const discrepancies: Discrepancy[] = [];
  const authHeader = razorpayBasicAuth(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET);

  // 6. Verify each payment
  for (const p of payRows ?? []) {
    const rzp = await razorpayGet(`/payments/${p.razorpay_payment_id}`, authHeader);
    if (rzp === "NETWORK_ERROR") {
      discrepancies.push({
        kind: "PAYMENT",
        severity: "WARN",
        our_id: p.id,
        razorpay_id: p.razorpay_payment_id,
        message: "Could not reach Razorpay to verify",
        our: snapshotPayment(p),
        razorpay: null,
      });
      continue;
    }
    if (rzp === "NOT_FOUND") {
      discrepancies.push({
        kind: "PAYMENT",
        severity: "ERROR",
        our_id: p.id,
        razorpay_id: p.razorpay_payment_id,
        message: "We have this payment but Razorpay does not — likely fake or test-mode-only ID",
        our: snapshotPayment(p),
        razorpay: null,
      });
      continue;
    }
    if (!rzp.ok) {
      discrepancies.push({
        kind: "PAYMENT",
        severity: "WARN",
        our_id: p.id,
        razorpay_id: p.razorpay_payment_id,
        message: `Razorpay lookup error: ${rzp.error}`,
        our: snapshotPayment(p),
        razorpay: null,
      });
      continue;
    }

    const remote = rzp.body;
    const remoteAmountPaise = Number(remote.amount ?? 0);
    const ourAmountPaise = rupeesToPaise(Number(p.amount));
    const remoteStatus = String(remote.status ?? "").toLowerCase();

    // 6a. Status drift
    if (p.status === "COMPLETED" && remoteStatus !== "captured") {
      discrepancies.push({
        kind: "PAYMENT",
        severity: "ERROR",
        our_id: p.id,
        razorpay_id: p.razorpay_payment_id,
        message: `Our status is COMPLETED but Razorpay reports "${remoteStatus}"`,
        our: snapshotPayment(p),
        razorpay: { status: remoteStatus, amount: remoteAmountPaise, method: remote.method },
      });
    } else if (p.status === "FAILED" && remoteStatus === "captured") {
      discrepancies.push({
        kind: "PAYMENT",
        severity: "ERROR",
        our_id: p.id,
        razorpay_id: p.razorpay_payment_id,
        message: `Our status is FAILED but Razorpay actually captured the payment`,
        our: snapshotPayment(p),
        razorpay: { status: remoteStatus, amount: remoteAmountPaise, method: remote.method },
      });
    }

    // 6b. Amount drift (compare in paise — never trust float equality on rupees)
    if (ourAmountPaise !== remoteAmountPaise) {
      discrepancies.push({
        kind: "PAYMENT",
        severity: "ERROR",
        our_id: p.id,
        razorpay_id: p.razorpay_payment_id,
        message: `Amount mismatch: we have ₹${(ourAmountPaise / 100).toFixed(2)}, Razorpay has ₹${(remoteAmountPaise / 100).toFixed(2)}`,
        our: snapshotPayment(p),
        razorpay: { status: remoteStatus, amount: remoteAmountPaise, method: remote.method },
      });
    }
  }

  // 7. Verify each refund
  for (const r of refRows ?? []) {
    const rzp = await razorpayGet(`/refunds/${r.razorpay_refund_id}`, authHeader);
    if (rzp === "NETWORK_ERROR") {
      discrepancies.push({
        kind: "REFUND",
        severity: "WARN",
        our_id: r.id,
        razorpay_id: r.razorpay_refund_id,
        message: "Could not reach Razorpay to verify",
        our: snapshotRefund(r),
        razorpay: null,
      });
      continue;
    }
    if (rzp === "NOT_FOUND") {
      discrepancies.push({
        kind: "REFUND",
        severity: "ERROR",
        our_id: r.id,
        razorpay_id: r.razorpay_refund_id,
        message: "We have this refund but Razorpay does not",
        our: snapshotRefund(r),
        razorpay: null,
      });
      continue;
    }
    if (!rzp.ok) {
      discrepancies.push({
        kind: "REFUND",
        severity: "WARN",
        our_id: r.id,
        razorpay_id: r.razorpay_refund_id,
        message: `Razorpay lookup error: ${rzp.error}`,
        our: snapshotRefund(r),
        razorpay: null,
      });
      continue;
    }

    const remote = rzp.body;
    const remoteAmountPaise = Number(remote.amount ?? 0);
    const ourAmountPaise = rupeesToPaise(Number(r.amount));
    const remoteStatus = String(remote.status ?? "").toLowerCase();
    const ourStatus = r.status;

    // 7a. PENDING-but-actually-done — flag as INFO (Refresh-status fixes this)
    if (ourStatus === "PENDING" && (remoteStatus === "processed" || remoteStatus === "failed")) {
      discrepancies.push({
        kind: "REFUND",
        severity: "INFO",
        our_id: r.id,
        razorpay_id: r.razorpay_refund_id,
        message: `Pending in our DB; Razorpay reports "${remoteStatus}" — use Refresh Status to reconcile`,
        our: snapshotRefund(r),
        razorpay: { status: remoteStatus, amount: remoteAmountPaise },
      });
    } else if (ourStatus === "PROCESSED" && remoteStatus !== "processed") {
      discrepancies.push({
        kind: "REFUND",
        severity: "ERROR",
        our_id: r.id,
        razorpay_id: r.razorpay_refund_id,
        message: `Our status is PROCESSED but Razorpay reports "${remoteStatus}"`,
        our: snapshotRefund(r),
        razorpay: { status: remoteStatus, amount: remoteAmountPaise },
      });
    } else if (ourStatus === "FAILED" && remoteStatus === "processed") {
      discrepancies.push({
        kind: "REFUND",
        severity: "ERROR",
        our_id: r.id,
        razorpay_id: r.razorpay_refund_id,
        message: `Our status is FAILED but Razorpay actually processed the refund`,
        our: snapshotRefund(r),
        razorpay: { status: remoteStatus, amount: remoteAmountPaise },
      });
    }

    // 7b. Amount drift
    if (ourAmountPaise !== remoteAmountPaise) {
      discrepancies.push({
        kind: "REFUND",
        severity: "ERROR",
        our_id: r.id,
        razorpay_id: r.razorpay_refund_id,
        message: `Amount mismatch: we have ₹${(ourAmountPaise / 100).toFixed(2)}, Razorpay has ₹${(remoteAmountPaise / 100).toFixed(2)}`,
        our: snapshotRefund(r),
        razorpay: { status: remoteStatus, amount: remoteAmountPaise },
      });
    }
  }

  // 8. Ship each non-INFO discrepancy to observability so Sentry alerts fire.
  for (const d of discrepancies) {
    if (d.severity === "ERROR") {
      logError(`razorpay-reconcile.drift.${d.kind.toLowerCase()}`, new Error(d.message), {
        hotel_id: body.hotel_id,
        our_id: d.our_id,
        razorpay_id: d.razorpay_id,
        our: d.our,
        razorpay: d.razorpay,
      });
    } else if (d.severity === "WARN") {
      logWarn(`razorpay-reconcile.drift.${d.kind.toLowerCase()}`, d.message, {
        hotel_id: body.hotel_id,
        our_id: d.our_id,
        razorpay_id: d.razorpay_id,
      });
    }
  }

  logInfo("razorpay-reconcile.run", "Reconciliation complete", {
    hotel_id: body.hotel_id,
    from: from.toISOString(),
    to: to.toISOString(),
    payments_checked: (payRows ?? []).length,
    refunds_checked: (refRows ?? []).length,
    discrepancy_count: discrepancies.length,
  });

  return new Response(
    JSON.stringify({
      ok: true,
      from: from.toISOString(),
      to: to.toISOString(),
      payments_checked: (payRows ?? []).length,
      refunds_checked: (refRows ?? []).length,
      discrepancies,
    }),
    { status: 200, headers: CORS_HEADERS },
  );
});

/* ------------------------------------------------------------------ */

type RazorpayGetResult =
  | "NETWORK_ERROR"
  | "NOT_FOUND"
  | { ok: true; body: any }
  | { ok: false; error: string };

async function razorpayGet(path: string, authHeader: string): Promise<RazorpayGetResult> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(`${RAZORPAY_API_BASE}${path}`, {
      method: "GET",
      headers: { Authorization: authHeader },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.status === 404) return "NOT_FOUND";
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let msg = `HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(text);
        if (parsed?.error?.description) msg = parsed.error.description;
      } catch { /* keep generic msg */ }
      return { ok: false, error: msg };
    }
    const body = await res.json();
    return { ok: true, body };
  } catch {
    return "NETWORK_ERROR";
  }
}

function snapshotPayment(p: any): Record<string, unknown> {
  return {
    amount: Number(p.amount),
    status: p.status,
    currency: p.currency,
    razorpay_order_id: p.razorpay_order_id,
    created_at: p.created_at,
  };
}

function snapshotRefund(r: any): Record<string, unknown> {
  return {
    amount: Number(r.amount),
    status: r.status,
    currency: r.currency,
    initiated_at: r.initiated_at,
    processed_at: r.processed_at,
    failure_reason: r.failure_reason,
  };
}
