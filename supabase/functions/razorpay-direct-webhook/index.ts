// supabase/functions/razorpay-direct-webhook/index.ts
//
// DIRECT-mode webhook receiver. JWT verification is disabled in config.toml
// (set in this migration alongside the Route webhook). Authentication is
// purely HMAC over the raw body, BUT — unlike the Route webhook — there is
// no single platform-wide secret. Each hotel has their own webhook_secret,
// and Razorpay events come from many hotels to this one URL.
//
// Routing algorithm:
//   1. Read raw body (no JSON parse yet).
//   2. Carefully parse JUST `payload.payment|refund|order.entity.notes.hotel_id`
//      from the body without verifying — we need the hotel_id to know which
//      secret to use. Notes were originally written by vaiyu, sealed by HMAC.
//   3. Load that hotel's webhook_secret (decrypted from hotels table).
//   4. HMAC-verify the raw body against that secret.
//   5. On signature match, process the event.
//
// Cross-hotel safety:
//   - notes.hotel_id was set by vaiyu at order-create time. Razorpay echoes
//     it back unchanged in webhook events; the HMAC over the raw body
//     ensures the entire payload (including the notes) is signed by that
//     specific hotel's secret. So even if an attacker fabricates an event
//     with a forged hotel_id, they'd need that hotel's secret to sign it.
//
// Subscribed events: payment.captured, payment.failed, order.paid,
// refund.created, refund.processed, refund.failed.
//
// Always returns 200 on success/dedup. Returns 401 ONLY on signature failure
// or missing routing info.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { CORS_HEADERS, supabaseService } from "../_shared/auth.ts";
import { hmacHex, timingSafeEqualHex, mapRazorpayMethod } from "../_shared/razorpay.ts";
import { loadHotelWebhookSecret } from "../_shared/razorpay-direct.ts";
import { logError, logWarn, logInfo } from "../_shared/observability.ts";

function ack(body: unknown = { received: true }) {
  return new Response(JSON.stringify(body), { status: 200, headers: CORS_HEADERS });
}

/** Extracts notes.hotel_id from a Razorpay webhook payload regardless of
 *  event type. Returns null if not present (we ack and skip). */
function extractHotelId(payload: any): string | null {
  const p = payload?.payload ?? {};
  const candidates = [
    p?.payment?.entity?.notes?.hotel_id,
    p?.refund?.entity?.notes?.hotel_id,
    p?.order?.entity?.notes?.hotel_id,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: CORS_HEADERS,
    });
  }

  // 1. Read raw body — signature is over raw bytes, not pretty-printed JSON.
  const rawBody = await req.text();

  // 2. Get the signature header
  const signature = req.headers.get("x-razorpay-signature") ?? "";
  if (!signature) {
    logWarn("razorpay-direct-webhook.no_signature", "Request without x-razorpay-signature");
    return new Response(JSON.stringify({ error: "Missing signature" }), {
      status: 401, headers: CORS_HEADERS,
    });
  }

  // 3. Tentative parse to find hotel_id — UN-AUTHENTICATED so far.
  //    We don't dispatch on the parsed contents yet; we only use hotel_id
  //    to pick which secret to verify against.
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    logError("razorpay-direct-webhook.invalid_json", e, { body_bytes: rawBody.length });
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: CORS_HEADERS,
    });
  }

  const hotelId = extractHotelId(payload);
  if (!hotelId) {
    // Without hotel_id we can't pick a secret. Razorpay-dashboard-initiated
    // refunds may lack our notes — ack-and-skip rather than 401.
    logWarn("razorpay-direct-webhook.no_hotel_id", "Webhook payload missing notes.hotel_id");
    return ack({ received: true, ignored: "missing_hotel_id" });
  }

  const svc = supabaseService();

  // 4. Look up THIS hotel's webhook secret (decrypted) and HMAC-verify.
  let secret: string;
  try {
    secret = await loadHotelWebhookSecret(svc, hotelId);
  } catch (e) {
    // Hotel not in DIRECT mode or secret not provisioned — reject as 401
    // so Razorpay surfaces the failure in their dashboard.
    logWarn("razorpay-direct-webhook.no_secret", "Could not load webhook secret for hotel", {
      hotel_id: hotelId,
      err: String((e as any)?.message ?? e),
    });
    return new Response(JSON.stringify({ error: "Hotel not configured for DIRECT webhooks" }), {
      status: 401, headers: CORS_HEADERS,
    });
  }

  const expected = await hmacHex(secret, rawBody);
  if (!timingSafeEqualHex(expected, signature)) {
    logWarn("razorpay-direct-webhook.signature_mismatch", "HMAC did not validate", {
      hotel_id: hotelId, body_bytes: rawBody.length,
    });
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401, headers: CORS_HEADERS,
    });
  }

  // 5. Dispatch (post-verification)
  const event: string = payload?.event ?? "";

  try {
    switch (event) {
      case "payment.captured": {
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
          status: "COMPLETED",
          reference_id: e.id,
          collected_by: null,
          razorpay_order_id: e.order_id,
          razorpay_payment_id: e.id,
          razorpay_signature: null,
          razorpay_mode: "DIRECT",      // ← the new bit
          notes: `Razorpay webhook (DIRECT) ${method}`,
        });
        if (error && (error as any).code !== "23505") {
          logError("razorpay-direct-webhook.payments_insert_error", error, {
            razorpay_payment_id: e.id, booking_id: notes.booking_id,
          });
        } else {
          logInfo("razorpay-direct-webhook.payment_captured", "Webhook recorded payment", {
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
          razorpay_mode: "DIRECT",
          notes: `Razorpay webhook (DIRECT) FAILED: ${e.error_description ?? e.error_code ?? "unknown"}`,
        });
        if (error && (error as any).code !== "23505") {
          logError("razorpay-direct-webhook.failed_payment_insert_error", error, {
            razorpay_payment_id: e.id, booking_id: notes.booking_id,
          });
        } else {
          logInfo("razorpay-direct-webhook.payment_failed", "Webhook recorded failed payment", {
            razorpay_payment_id: e.id,
            booking_id: notes.booking_id,
            error_code: e.error_code,
            error_description: e.error_description,
          });
        }
        return ack({ received: true, event });
      }

      case "order.paid":
        return ack({ received: true, event });

      case "refund.created":
      case "refund.processed":
      case "refund.failed": {
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
          logError("razorpay-direct-webhook.refund_update_error", error, {
            razorpay_refund_id: r.id, target_status: nextStatus,
          });
        } else {
          logInfo("razorpay-direct-webhook.refund_updated", "Webhook updated refund status", {
            razorpay_refund_id: r.id, target_status: nextStatus,
          });
        }
        return ack({ received: true, event });
      }

      default:
        return ack({ received: true, ignored: event });
    }
  } catch (e) {
    logError("razorpay-direct-webhook.unhandled", e, { event });
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: CORS_HEADERS,
    });
  }
});
