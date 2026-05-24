// web/src/services/razorpayDirectService.ts
//
// DIRECT-mode frontend service. Mirrors the Route-mode `razorpayService.ts`
// API exactly so the `razorpayClient` facade can swap them transparently.
//
// Differences vs Route service:
//   • Each function targets a `razorpay-direct-*` Edge Function.
//   • openRazorpayCheckout uses the HOTEL's key_id (returned by
//     razorpay-direct-create-order) — no platform key.
//   • New `setDirectCredentials` / `clearDirectCredentials` for onboarding.
//
// Types and error class are re-exported from `razorpayService.ts` so
// call sites can stay uniform.

import { supabase } from "../lib/supabase";
import { addBreadcrumb, captureException } from "../lib/monitoring";
import {
    RazorpayServiceError,
    type WalkInOrderInput,
    type WalkInOrderResult,
    type CheckoutOutcome,
    type VerifyPaymentInput,
    type VerifyPaymentResult,
    type CreateRefundInput,
    type CreateRefundResult,
    type RefreshRefundResult,
    type ReconcileInput,
    type ReconcileResult,
    type ReconcileDiscrepancy,
} from "./razorpayService";

export { RazorpayServiceError } from "./razorpayService";
export type {
    WalkInOrderInput,
    WalkInOrderResult,
    CheckoutOutcome,
    VerifyPaymentInput,
    VerifyPaymentResult,
    CreateRefundInput,
    CreateRefundResult,
    RefreshRefundResult,
    ReconcileInput,
    ReconcileResult,
    ReconcileDiscrepancy,
} from "./razorpayService";

/* ============================================================
   1) Create order — razorpay-direct-create-order
   ============================================================ */

export async function createWalkInOrder(input: WalkInOrderInput): Promise<WalkInOrderResult> {
    addBreadcrumb({
        category: "razorpay-direct",
        message: "createOrder.start",
        data: { hotelId: input.hotelId, bookingId: input.bookingId },
    });

    const { data, error } = await supabase.functions.invoke("razorpay-direct-create-order", {
        body: { hotel_id: input.hotelId, booking_id: input.bookingId },
    });

    if (error) {
        const status = (error as any)?.context?.status;
        const body = await readFunctionsErrorBody(error);
        const code = body?.code ?? body?.error ?? "ORDER_CREATE_FAILED";
        const msg = body?.error ?? "Could not start payment";
        const e = new RazorpayServiceError(msg, code, status);
        addBreadcrumb({ category: "razorpay-direct", message: "createOrder.error", level: "error", data: { code, status } });
        captureException(e, { hotelId: input.hotelId, bookingId: input.bookingId, code, status, mode: "DIRECT" });
        throw e;
    }
    if (!data?.order_id || !data?.key_id) {
        const e = new RazorpayServiceError("Invalid order response", "ORDER_CREATE_FAILED");
        captureException(e, { hotelId: input.hotelId, bookingId: input.bookingId, mode: "DIRECT" });
        throw e;
    }

    addBreadcrumb({
        category: "razorpay-direct",
        message: "createOrder.success",
        data: { orderId: data.order_id, amountPaise: data.amount },
    });

    return {
        orderId: data.order_id,
        keyId: data.key_id,        // ← hotel's own key_id (NOT platform's)
        amount: data.amount,
        currency: data.currency,
        hotelName: data.hotel_name,
        bookingCode: data.booking_code,
        folioId: data.folio_id,
        customer: data.customer ?? {},
    };
}

/* ============================================================
   2) Open Razorpay Checkout — identical to Route version
   (the hotel's key_id was baked into the WalkInOrderResult)
   ============================================================ */

export function openRazorpayCheckout(order: WalkInOrderResult): Promise<CheckoutOutcome> {
    addBreadcrumb({
        category: "razorpay-direct",
        message: "openCheckout.start",
        data: { orderId: order.orderId, amount: order.amount },
    });
    return new Promise((resolve) => {
        if (typeof window === "undefined" || !window.Razorpay) {
            addBreadcrumb({ category: "razorpay-direct", message: "openCheckout.sdk_not_loaded", level: "error" });
            resolve({
                ok: false,
                reason: "FAILED",
                error: { description: "Razorpay Checkout script not loaded" },
            });
            return;
        }

        const options = {
            key: order.keyId,
            order_id: order.orderId,
            amount: order.amount,
            currency: order.currency,
            name: order.hotelName,
            description: `Walk-in payment · ${order.bookingCode}`,
            prefill: {
                name: order.customer.name ?? "",
                email: order.customer.email ?? "",
                contact: order.customer.phone ?? "",
            },
            theme: { color: "#10b981" },
            handler: function (response: {
                razorpay_payment_id: string;
                razorpay_order_id: string;
                razorpay_signature: string;
            }) {
                addBreadcrumb({
                    category: "razorpay-direct",
                    message: "openCheckout.handler_success",
                    data: { paymentId: response.razorpay_payment_id, orderId: response.razorpay_order_id },
                });
                resolve({
                    ok: true,
                    paymentId: response.razorpay_payment_id,
                    orderId: response.razorpay_order_id,
                    signature: response.razorpay_signature,
                });
            },
            modal: {
                ondismiss: function () {
                    addBreadcrumb({ category: "razorpay-direct", message: "openCheckout.dismissed", level: "warning" });
                    resolve({ ok: false, reason: "DISMISSED" });
                },
            },
        };

        const rzp = new window.Razorpay(options);
        rzp.on("payment.failed", function (response: { error: any }) {
            addBreadcrumb({
                category: "razorpay-direct",
                message: "openCheckout.payment_failed",
                level: "error",
                data: { code: response.error?.code, description: response.error?.description },
            });
            resolve({ ok: false, reason: "FAILED", error: response.error });
        });
        rzp.open();
    });
}

/* ============================================================
   3) Verify payment — razorpay-direct-verify-payment
   ============================================================ */

export async function verifyWalkInPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    addBreadcrumb({
        category: "razorpay-direct",
        message: "verifyPayment.start",
        data: { orderId: input.orderId, paymentId: input.paymentId, bookingId: input.bookingId },
    });

    const { data, error } = await supabase.functions.invoke("razorpay-direct-verify-payment", {
        body: {
            razorpay_order_id: input.orderId,
            razorpay_payment_id: input.paymentId,
            razorpay_signature: input.signature,
            hotel_id: input.hotelId,
            booking_id: input.bookingId,
            folio_id: input.folioId,
        },
    });

    if (error) {
        const status = (error as any)?.context?.status;
        const body = await readFunctionsErrorBody(error);
        const code = body?.error ?? "VERIFY_FAILED";
        const msg =
            code === "INVALID_SIGNATURE" ? "Payment couldn't be verified — please contact support." :
            code === "AMOUNT_MISMATCH"   ? "Payment amount didn't match the folio. Please retry or use cash." :
            code === "NOT_CAPTURED"      ? "Razorpay reports the payment isn't captured. Please retry." :
            "Payment verification failed.";
        const e = new RazorpayServiceError(msg, code, status);
        addBreadcrumb({ category: "razorpay-direct", message: "verifyPayment.error", level: "error", data: { code, status } });
        captureException(e, {
            orderId: input.orderId, paymentId: input.paymentId, bookingId: input.bookingId, code, status, mode: "DIRECT",
        });
        throw e;
    }
    if (!data?.ok) {
        const e = new RazorpayServiceError("Verify returned non-ok", "VERIFY_FAILED");
        captureException(e, { orderId: input.orderId, paymentId: input.paymentId, mode: "DIRECT" });
        throw e;
    }
    addBreadcrumb({
        category: "razorpay-direct",
        message: "verifyPayment.success",
        data: { paymentDbId: data.paymentDbId, deduped: !!data.deduped },
    });
    return {
        ok: true,
        paymentDbId: data.paymentDbId ?? null,
        deduped: !!data.deduped,
    };
}

/* ============================================================
   4) Refund — razorpay-direct-create-refund
   ============================================================ */

export async function createRefund(input: CreateRefundInput): Promise<CreateRefundResult> {
    addBreadcrumb({
        category: "razorpay-direct",
        message: "createRefund.start",
        data: { paymentId: input.paymentId, amount: input.amount },
    });
    const { data, error } = await supabase.functions.invoke("razorpay-direct-create-refund", {
        body: { payment_id: input.paymentId, amount: input.amount, reason: input.reason },
    });

    if (error) {
        const status = (error as any)?.context?.status;
        const body = await readFunctionsErrorBody(error);
        const code = body?.code ?? body?.error ?? "REFUND_FAILED";
        const msg = body?.error ?? "Could not create refund";
        throw new RazorpayServiceError(msg, code, status);
    }
    if (!data?.ok) throw new RazorpayServiceError("Refund returned non-ok", "REFUND_FAILED");
    return {
        ok: true,
        refundId: data.refund_id,
        razorpayRefundId: data.razorpay_refund_id ?? null,
        status: data.status ?? "pending",
        amount: data.amount,
    };
}

export async function processPendingRefund(refundId: string): Promise<CreateRefundResult> {
    addBreadcrumb({
        category: "razorpay-direct",
        message: "processPendingRefund.start",
        data: { refundId },
    });
    const { data, error } = await supabase.functions.invoke("razorpay-direct-create-refund", {
        body: { refund_id: refundId },
    });
    if (error) {
        const status = (error as any)?.context?.status;
        const body = await readFunctionsErrorBody(error);
        const code = body?.code ?? body?.error ?? "REFUND_FAILED";
        const msg = body?.error ?? "Could not process refund";
        const e = new RazorpayServiceError(msg, code, status);
        captureException(e, { refundId, code, status, mode: "DIRECT" });
        throw e;
    }
    if (!data?.ok) {
        const e = new RazorpayServiceError("Process pending returned non-ok", "REFUND_FAILED");
        captureException(e, { refundId, mode: "DIRECT" });
        throw e;
    }
    return {
        ok: true,
        refundId: data.refund_id,
        razorpayRefundId: data.razorpay_refund_id ?? null,
        status: data.status ?? "pending",
        amount: data.amount,
    };
}

/* ============================================================
   5) Refresh refund status — razorpay-direct-refresh-refund
   ============================================================ */

export async function refreshRefundStatus(refundId: string): Promise<RefreshRefundResult> {
    addBreadcrumb({
        category: "razorpay-direct",
        message: "refreshRefundStatus.start",
        data: { refundId },
    });
    const { data, error } = await supabase.functions.invoke("razorpay-direct-refresh-refund", {
        body: { refund_id: refundId },
    });
    if (error) {
        const status = (error as any)?.context?.status;
        const body = await readFunctionsErrorBody(error);
        const code = body?.code ?? body?.error ?? "REFRESH_FAILED";
        const msg = body?.error ?? "Could not refresh refund status";
        const e = new RazorpayServiceError(msg, code, status);
        captureException(e, { refundId, code, status, mode: "DIRECT" });
        throw e;
    }
    if (!data?.ok) {
        const e = new RazorpayServiceError("Refresh returned non-ok", "REFRESH_FAILED");
        captureException(e, { refundId, mode: "DIRECT" });
        throw e;
    }
    return {
        ok: true,
        refundId: data.refund_id,
        ourStatus: data.our_status,
        razorpayStatus: data.razorpay_status,
        changed: !!data.changed,
    };
}

/* ============================================================
   6) Reconciliation — razorpay-direct-reconcile
   ============================================================ */

export async function reconcilePeriod(input: ReconcileInput): Promise<ReconcileResult> {
    addBreadcrumb({
        category: "razorpay-direct",
        message: "reconcilePeriod.start",
        data: { hotelId: input.hotelId, from: input.from, to: input.to },
    });
    const { data, error } = await supabase.functions.invoke("razorpay-direct-reconcile", {
        body: { hotel_id: input.hotelId, from: input.from, to: input.to },
    });
    if (error) {
        const status = (error as any)?.context?.status;
        const body = await readFunctionsErrorBody(error);
        const code = body?.code ?? body?.error ?? "RECONCILE_FAILED";
        const msg = body?.error ?? "Reconciliation failed";
        const e = new RazorpayServiceError(msg, code, status);
        captureException(e, { hotelId: input.hotelId, code, status, mode: "DIRECT" });
        throw e;
    }
    if (!data?.ok) throw new RazorpayServiceError("Reconcile returned non-ok", "RECONCILE_FAILED");
    const discrepancies: ReconcileDiscrepancy[] = (data.discrepancies ?? []).map((d: any) => ({
        kind: d.kind,
        severity: d.severity,
        ourId: d.our_id,
        razorpayId: d.razorpay_id ?? null,
        message: d.message,
        our: d.our ?? {},
        razorpay: d.razorpay ?? null,
    }));
    return {
        ok: true,
        from: data.from,
        to: data.to,
        paymentsChecked: Number(data.payments_checked ?? 0),
        refundsChecked: Number(data.refunds_checked ?? 0),
        discrepancies,
    };
}

/* ============================================================
   7) Direct-only: credential management
   (Route uses razorpay-onboard-account via /v2/accounts — different surface)
   ============================================================ */

export type SetDirectCredentialsInput = {
    hotelId: string;
    keyId: string;
    keySecret: string;
};

export type SetDirectCredentialsResult = {
    ok: true;
    mode: "test" | "live";
    /** Plaintext webhook secret — display ONCE in the UI, then never again
     *  (vaiyu stores only ciphertext at rest). */
    webhookSecret: string;
    webhookUrl: string;
    subscribedEvents: string[];
};

/** Stores a hotel's Razorpay credentials, flips razorpay_mode → 'DIRECT'.
 *  Returns the webhook secret + URL the hotel must paste into the Razorpay
 *  dashboard. The webhook secret is shown ONCE — server stores ciphertext only. */
export async function setDirectCredentials(input: SetDirectCredentialsInput): Promise<SetDirectCredentialsResult> {
    const { data, error } = await supabase.functions.invoke("razorpay-direct-set-credentials", {
        body: {
            hotel_id: input.hotelId,
            key_id: input.keyId,
            key_secret: input.keySecret,
        },
    });
    if (error) {
        const status = (error as any)?.context?.status;
        const body = await readFunctionsErrorBody(error);
        const code = body?.code ?? body?.error ?? "SET_CREDENTIALS_FAILED";
        const msg = body?.error ?? "Could not save credentials";
        throw new RazorpayServiceError(msg, code, status);
    }
    if (!data?.ok || !data?.webhook_secret) {
        throw new RazorpayServiceError("Set-credentials returned non-ok", "SET_CREDENTIALS_FAILED");
    }
    return {
        ok: true,
        mode: data.mode,
        webhookSecret: data.webhook_secret,
        webhookUrl: data.webhook_url,
        subscribedEvents: data.subscribed_events ?? [],
    };
}

/** Clears a hotel's DIRECT credentials and flips razorpay_mode → 'NONE'.
 *  Existing payments/refunds are preserved (still tagged razorpay_mode='DIRECT'
 *  so historical refunds can theoretically still be processed if credentials
 *  are restored). */
export async function clearDirectCredentials(hotelId: string): Promise<{ ok: true }> {
    const { data, error } = await supabase.functions.invoke("razorpay-direct-clear-credentials", {
        body: { hotel_id: hotelId },
    });
    if (error) {
        const status = (error as any)?.context?.status;
        const body = await readFunctionsErrorBody(error);
        const code = body?.code ?? body?.error ?? "CLEAR_CREDENTIALS_FAILED";
        const msg = body?.error ?? "Could not clear credentials";
        throw new RazorpayServiceError(msg, code, status);
    }
    if (!data?.ok) {
        throw new RazorpayServiceError("Clear-credentials returned non-ok", "CLEAR_CREDENTIALS_FAILED");
    }
    return { ok: true };
}

/* ============================================================
   Helpers
   ============================================================ */

async function readFunctionsErrorBody(err: unknown): Promise<any> {
    try {
        const ctx = (err as any)?.context;
        if (!ctx) return null;
        if (typeof ctx.json === "function") return await ctx.json();
        if (ctx.body) return ctx.body;
        return null;
    } catch {
        return null;
    }
}
