// supabase/functions/razorpay-webhook/index.ts
//
// POST: receives Razorpay webhook events. JWT verification is disabled in
// config.toml — we authenticate purely by HMAC signature over the raw body.
//
// Subscribed events: payment.captured, payment.failed, order.paid.
//
// Idempotency: payments table has a UNIQUE partial index on
// razorpay_payment_id. We insert with ON CONFLICT DO NOTHING — webhook +
// client verify will both attempt the same row; whichever wins, the other
// gets a clean "deduped" outcome.
//
// Always return 200 on success/dedupe. Return 401 ONLY on signature failure.
// Razorpay treats non-2xx as retry-needed and will hammer the function
// every minute for 24h.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { CORS_HEADERS, supabaseService } from "../_shared/auth.ts";
import { hmacHex, timingSafeEqualHex, mapRazorpayMethod } from "../_shared/razorpay.ts";
import { logError, logWarn, logInfo } from "../_shared/observability.ts";

const RAZORPAY_WEBHOOK_SECRET = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") ?? "";

if (!RAZORPAY_WEBHOOK_SECRET) {
  logError("razorpay-webhook.boot", new Error("RAZORPAY_WEBHOOK_SECRET missing"));
}

// 200 OK helper. Always returns 200 for webhook idempotency / dedup.
function ack(body: unknown = { received: true }) {
  return new Response(JSON.stringify(body), { status: 200, headers: CORS_HEADERS });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  // 1. Read raw body BEFORE any JSON parse — signature is over raw bytes.
  const rawBody = await req.text();

  // 2. Verify signature
  const signature = req.headers.get("x-razorpay-signature") ?? "";
  if (!signature) {
    logWarn("razorpay-webhook.no_signature", "Request arrived without x-razorpay-signature header");
    return new Response(JSON.stringify({ error: "Missing signature" }), {
      status: 401,
      headers: CORS_HEADERS,
    });
  }
  const expected = await hmacHex(RAZORPAY_WEBHOOK_SECRET, rawBody);
  if (!timingSafeEqualHex(expected, signature)) {
    logWarn("razorpay-webhook.signature_mismatch", "HMAC signature did not validate", {
      body_bytes: rawBody.length,
    });
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: CORS_HEADERS,
    });
  }

  // 3. Parse and dispatch
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    // Signature verified but body unparseable — log and ack so Razorpay
    // doesn't retry forever.
    logError("razorpay-webhook.invalid_json", e, { body_bytes: rawBody.length });
    return ack({ received: true, ignored: "invalid_json" });
  }

  const event: string = payload?.event ?? "";
  const svc = supabaseService();

  try {
    switch (event) {
      case "payment.captured": {
        const e = payload?.payload?.payment?.entity;
        if (!e?.id) return ack({ received: true, ignored: "no_payment_id" });

        const notes = e.notes ?? {};
        if (!notes.hotel_id || !notes.booking_id || !notes.folio_id) {
          // Notes weren't set — likely from a non-walk-in flow. Ack and skip.
          return ack({ received: true, ignored: "missing_notes" });
        }

        const amountRupees = Number(e.amount) / 100;
        const method = mapRazorpayMethod(e.method);

        const { error } = await svc.from("payments").insert({
          hotel_id: notes.hotel_id,
          booking_id: notes.booking_id,
          folio_id: notes.folio_id,
          amount: amountRupees,
          currency: "INR",
          method,
          status: "COMPLETED",
          reference_id: e.id,
          collected_by: null, // webhook path — no staff user
          razorpay_order_id: e.order_id,
          razorpay_payment_id: e.id,
          razorpay_signature: null,
          notes: `Razorpay webhook ${method}`,
        });

        if (error && (error as any).code !== "23505") {
          // Real failure (not unique-violation dedup)
          logError("razorpay-webhook.payments_insert_error", error, {
            razorpay_payment_id: e.id,
            booking_id: notes.booking_id,
          });
        } else {
          logInfo("razorpay-webhook.payment_captured", "Webhook recorded payment", {
            razorpay_payment_id: e.id,
            booking_id: notes.booking_id,
            hotel_id: notes.hotel_id,
            amount: amountRupees,
            deduped: (error as any)?.code === "23505",
          });
        }
        return ack({ received: true, event });
      }

      case "payment.failed": {
        const e = payload?.payload?.payment?.entity;
        if (!e?.id) return ack({ received: true, ignored: "no_payment_id" });

        const notes = e.notes ?? {};
        if (!notes.hotel_id || !notes.booking_id || !notes.folio_id) {
          return ack({ received: true, ignored: "missing_notes" });
        }

        const amountRupees = Number(e.amount) / 100;
        const method = mapRazorpayMethod(e.method);

        const { error } = await svc.from("payments").insert({
          hotel_id: notes.hotel_id,
          booking_id: notes.booking_id,
          folio_id: notes.folio_id,
          amount: amountRupees,
          currency: "INR",
          method,
          status: "FAILED",
          reference_id: e.id,
          razorpay_order_id: e.order_id,
          razorpay_payment_id: e.id,
          notes: `Razorpay webhook FAILED: ${e.error_description ?? e.error_code ?? "unknown"}`,
        });
        if (error && (error as any).code !== "23505") {
          logError("razorpay-webhook.failed_payment_insert_error", error, {
            razorpay_payment_id: e.id,
            booking_id: notes.booking_id,
          });
        } else {
          logInfo("razorpay-webhook.payment_failed", "Webhook recorded failed payment", {
            razorpay_payment_id: e.id,
            booking_id: notes.booking_id,
            error_code: e.error_code,
            error_description: e.error_description,
          });
        }
        return ack({ received: true, event });
      }

      case "order.paid":
        // Informational only — order is fully paid. The companion
        // payment.captured event will have already inserted the row.
        return ack({ received: true, event });

      case "refund.created":
      case "refund.processed":
      case "refund.failed": {
        // Razorpay refund lifecycle:
        //   refund.created   → refund accepted by Razorpay (status='pending')
        //   refund.processed → refund actually settled (status='processed')
        //   refund.failed    → refund failed (status='failed')
        // The refund row is created up-front by razorpay-create-refund with
        // status='PENDING'. We update by razorpay_refund_id, which is set
        // before any webhook can arrive. If we somehow get a webhook for a
        // refund we don't know (e.g. dashboard-initiated refund), we ack
        // and move on — the refund still happened, just not via our flow.
        const r = payload?.payload?.refund?.entity;
        if (!r?.id) return ack({ received: true, ignored: "no_refund_id" });

        const nextStatus =
          event === "refund.processed" ? "PROCESSED" :
          event === "refund.failed"    ? "FAILED" :
          "PENDING";

        const updatePayload: Record<string, unknown> = {
          status: nextStatus,
          razorpay_response: r,
        };
        if (nextStatus === "FAILED") {
          updatePayload.failure_reason =
            r.error_description ?? r.notes?.error ?? "Razorpay reported refund failure";
        }

        const { error } = await svc
          .from("refunds")
          .update(updatePayload)
          .eq("razorpay_refund_id", r.id);

        if (error) {
          logError("razorpay-webhook.refund_update_error", error, {
            razorpay_refund_id: r.id,
            target_status: nextStatus,
          });
        } else {
          logInfo("razorpay-webhook.refund_updated", "Webhook updated refund status", {
            razorpay_refund_id: r.id,
            target_status: nextStatus,
          });
        }
        return ack({ received: true, event });
      }

      default:
        // Unknown / unsubscribed events — ack and ignore so Razorpay stops
        // retrying.
        return ack({ received: true, ignored: event });
    }
  } catch (e) {
    // Database genuinely down — return 500 so Razorpay retries later.
    logError("razorpay-webhook.unhandled", e, { event });
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
});
