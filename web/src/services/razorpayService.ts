// web/src/services/razorpayService.ts
//
// Frontend service for the Razorpay Checkout flow on the walk-in payment
// surface. Three responsibilities:
//
//   1. createWalkInOrder(input)        — POST razorpay-create-order
//   2. openRazorpayCheckout(order, ..) — opens the Razorpay modal, returns a
//                                        Promise that resolves on success
//                                        callback or rejects/{ok:false} on
//                                        dismiss/failure
//   3. verifyWalkInPayment(args)       — POST razorpay-verify-payment after
//                                        the modal returns success
//
// Server is the source of truth: it re-derives amount from the folio and
// cross-checks against Razorpay's GET /payments/{id}. The client just shuttles
// signatures and ids between Razorpay and our Edge Function.

import { supabase } from "../lib/supabase";
import { addBreadcrumb, captureException } from "../lib/monitoring";

/* ============================================================
   Types
   ============================================================ */

export type WalkInOrderInput = {
    hotelId: string;
    bookingId: string;
};

export type WalkInOrderResult = {
    orderId: string;
    keyId: string;
    amount: number; // paise
    currency: string;
    hotelName: string;
    bookingCode: string;
    folioId: string;
    customer: {
        name?: string;
        email?: string;
        phone?: string;
    };
};

export type CheckoutOutcome =
    | {
        ok: true;
        paymentId: string;
        orderId: string;
        signature: string;
    }
    | {
        ok: false;
        reason: "DISMISSED" | "FAILED";
        error?: { code?: string; description?: string; reason?: string };
    };

export type VerifyPaymentInput = {
    hotelId: string;
    bookingId: string;
    folioId: string;
    orderId: string;
    paymentId: string;
    signature: string;
};

export type VerifyPaymentResult = {
    ok: true;
    paymentDbId: string | null;
    deduped: boolean;
};

/* ============================================================
   Error class
   ============================================================ */

export class RazorpayServiceError extends Error {
    readonly code: string;
    readonly status?: number;
    constructor(message: string, code: string, status?: number) {
        super(message);
        this.name = "RazorpayServiceError";
        this.code = code;
        this.status = status;
    }
}

/* ============================================================
   1) Create order via Edge Function
   ============================================================ */

export async function createWalkInOrder(
    input: WalkInOrderInput,
): Promise<WalkInOrderResult> {
    addBreadcrumb({
        category: "razorpay",
        message: "createOrder.start",
        data: { hotelId: input.hotelId, bookingId: input.bookingId },
    });

    const { data, error } = await supabase.functions.invoke("razorpay-create-order", {
        body: { hotel_id: input.hotelId, booking_id: input.bookingId },
    });

    if (error) {
        // Edge function 4xx/5xx surface as FunctionsHttpError with
        // `context` carrying the response body.
        const status = (error as any)?.context?.status;
        const body = await readFunctionsErrorBody(error);
        const code = body?.code ?? body?.error ?? "ORDER_CREATE_FAILED";
        const msg = body?.error ?? "Could not start payment";
        const e = new RazorpayServiceError(msg, code, status);
        addBreadcrumb({ category: "razorpay", message: "createOrder.error", level: "error", data: { code, status } });
        captureException(e, { hotelId: input.hotelId, bookingId: input.bookingId, code, status });
        throw e;
    }
    if (!data?.order_id || !data?.key_id) {
        const e = new RazorpayServiceError("Invalid order response", "ORDER_CREATE_FAILED");
        captureException(e, { hotelId: input.hotelId, bookingId: input.bookingId });
        throw e;
    }

    addBreadcrumb({
        category: "razorpay",
        message: "createOrder.success",
        data: { orderId: data.order_id, amountPaise: data.amount },
    });

    return {
        orderId: data.order_id,
        keyId: data.key_id,
        amount: data.amount,
        currency: data.currency,
        hotelName: data.hotel_name,
        bookingCode: data.booking_code,
        folioId: data.folio_id,
        customer: data.customer ?? {},
    };
}

/* ============================================================
   2) Open Razorpay Checkout modal
   ============================================================ */

export function openRazorpayCheckout(
    order: WalkInOrderResult,
): Promise<CheckoutOutcome> {
    addBreadcrumb({
        category: "razorpay",
        message: "openCheckout.start",
        data: { orderId: order.orderId, amount: order.amount },
    });
    return new Promise((resolve) => {
        if (typeof window === "undefined" || !window.Razorpay) {
            addBreadcrumb({
                category: "razorpay",
                message: "openCheckout.sdk_not_loaded",
                level: "error",
            });
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
            // handler fires only on successful payment
            handler: function (response: {
                razorpay_payment_id: string;
                razorpay_order_id: string;
                razorpay_signature: string;
            }) {
                addBreadcrumb({
                    category: "razorpay",
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
                    addBreadcrumb({ category: "razorpay", message: "openCheckout.dismissed", level: "warning" });
                    resolve({ ok: false, reason: "DISMISSED" });
                },
            },
        };

        const rzp = new window.Razorpay(options);
        rzp.on("payment.failed", function (response: { error: any }) {
            addBreadcrumb({
                category: "razorpay",
                message: "openCheckout.payment_failed",
                level: "error",
                data: { code: response.error?.code, description: response.error?.description },
            });
            resolve({
                ok: false,
                reason: "FAILED",
                error: response.error,
            });
        });
        rzp.open();
    });
}

/* ============================================================
   3) Server-side verify
   ============================================================ */

export async function verifyWalkInPayment(
    input: VerifyPaymentInput,
): Promise<VerifyPaymentResult> {
    addBreadcrumb({
        category: "razorpay",
        message: "verifyPayment.start",
        data: { orderId: input.orderId, paymentId: input.paymentId, bookingId: input.bookingId },
    });

    const { data, error } = await supabase.functions.invoke("razorpay-verify-payment", {
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
            code === "INVALID_SIGNATURE"
                ? "Payment couldn't be verified — please contact support."
                : code === "AMOUNT_MISMATCH"
                    ? "Payment amount didn't match the folio. Please retry or use cash."
                    : code === "NOT_CAPTURED"
                        ? "Razorpay reports the payment isn't captured. Please retry."
                        : "Payment verification failed.";
        const e = new RazorpayServiceError(msg, code, status);
        addBreadcrumb({ category: "razorpay", message: "verifyPayment.error", level: "error", data: { code, status } });
        // Verification failures are the most actionable thing for Sentry —
        // they signal real money state mismatch.
        captureException(e, {
            orderId: input.orderId,
            paymentId: input.paymentId,
            bookingId: input.bookingId,
            code,
            status,
        });
        throw e;
    }
    if (!data?.ok) {
        const e = new RazorpayServiceError("Verify returned non-ok", "VERIFY_FAILED");
        captureException(e, { orderId: input.orderId, paymentId: input.paymentId });
        throw e;
    }
    addBreadcrumb({
        category: "razorpay",
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
   4) Onboarding — create a Linked Account in-app
   ============================================================ */

export type OnboardAccountInput = {
    hotelId: string;
    /** Optional override fields; usually inferred from the hotel record. */
    businessType?: "proprietorship" | "individual" | "private_limited" | "partnership" | "llp" | "trust" | "society" | "ngo";
};

export type OnboardAccountResult = {
    ok: true;
    accountId: string;
    status: string;
    /** Live mode only — present when KYC is required. Empty/null in test mode. */
    activationUrl: string | null;
};

/** Creates a Razorpay Route Linked Account for a hotel and persists its
 *  `acc_xxx` to `hotels.razorpay_account_id`. Test mode returns immediately;
 *  live mode returns an `activationUrl` for the hotel to complete KYC. */
export async function onboardRazorpayAccount(
    input: OnboardAccountInput,
): Promise<OnboardAccountResult> {
    const { data, error } = await supabase.functions.invoke("razorpay-onboard-account", {
        body: {
            hotel_id: input.hotelId,
            business_type: input.businessType,
        },
    });

    if (error) {
        const status = (error as any)?.context?.status;
        const body = await readFunctionsErrorBody(error);
        const code = body?.code ?? body?.error ?? "ONBOARD_FAILED";
        const msg = body?.error ?? "Could not create Razorpay account";
        throw new RazorpayServiceError(msg, code, status);
    }
    if (!data?.ok || !data?.account_id) {
        throw new RazorpayServiceError("Onboarding returned non-ok", "ONBOARD_FAILED");
    }
    return {
        ok: true,
        accountId: data.account_id,
        status: data.status ?? "created",
        activationUrl: data.activation_url ?? null,
    };
}

/* ============================================================
   5) Refund — staff-initiated refund of a Razorpay payment
   ============================================================ */

export type CreateRefundInput = {
    /** Our payments.id (NOT the razorpay_payment_id). */
    paymentId: string;
    /** Rupees. Omit for full refund of the remaining refundable balance. */
    amount?: number;
    /** Staff note; surfaced in audit + on the folio REFUND entry. */
    reason?: string;
};

export type CreateRefundResult = {
    ok: true;
    refundId: string;            // our refunds.id
    razorpayRefundId: string | null;
    /** Razorpay's response status (usually "pending" until webhook arrives). */
    status: string;
    amount: number;
};

/** Initiates a refund against a Razorpay-captured payment. Route-split
 *  payments are reversed via `reverse_all: 1` so funds come back from
 *  the hotel's Linked Account, not the platform. */
export async function createRefund(
    input: CreateRefundInput,
): Promise<CreateRefundResult> {
    addBreadcrumb({
        category: "razorpay",
        message: "createRefund.start",
        data: { paymentId: input.paymentId, amount: input.amount },
    });
    const { data, error } = await supabase.functions.invoke("razorpay-create-refund", {
        body: {
            payment_id: input.paymentId,
            amount: input.amount,
            reason: input.reason,
        },
    });

    if (error) {
        const status = (error as any)?.context?.status;
        const body = await readFunctionsErrorBody(error);
        const code = body?.code ?? body?.error ?? "REFUND_FAILED";
        const msg = body?.error ?? "Could not create refund";
        throw new RazorpayServiceError(msg, code, status);
    }
    if (!data?.ok) {
        throw new RazorpayServiceError("Refund returned non-ok", "REFUND_FAILED");
    }
    return {
        ok: true,
        refundId: data.refund_id,
        razorpayRefundId: data.razorpay_refund_id ?? null,
        status: data.status ?? "pending",
        amount: data.amount,
    };
}

/** Processes an already-flagged PENDING refund row (created by the
 *  booking-cancellation trigger). Same Edge Function as createRefund, just
 *  the alternate entry path. */
export async function processPendingRefund(
    refundId: string,
): Promise<CreateRefundResult> {
    addBreadcrumb({
        category: "razorpay",
        message: "processPendingRefund.start",
        data: { refundId },
    });
    const { data, error } = await supabase.functions.invoke("razorpay-create-refund", {
        body: { refund_id: refundId },
    });

    if (error) {
        const status = (error as any)?.context?.status;
        const body = await readFunctionsErrorBody(error);
        const code = body?.code ?? body?.error ?? "REFUND_FAILED";
        const msg = body?.error ?? "Could not process refund";
        const e = new RazorpayServiceError(msg, code, status);
        captureException(e, { refundId, code, status });
        throw e;
    }
    if (!data?.ok) {
        const e = new RazorpayServiceError("Process pending returned non-ok", "REFUND_FAILED");
        captureException(e, { refundId });
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
   6) Refresh refund status — pulls Razorpay's view of a refund and
      reconciles our row. Used when the webhook never arrived.
   ============================================================ */

export type RefreshRefundResult = {
    ok: true;
    refundId: string;
    /** Status of our row AFTER the refresh — may equal the prior status. */
    ourStatus: "PENDING" | "PROCESSED" | "FAILED";
    /** Status as reported by Razorpay just now (lowercase). */
    razorpayStatus: string;
    /** Did this call change our DB state? */
    changed: boolean;
};

/** Refreshes the status of a refund that was submitted to Razorpay but is
 *  still PENDING in our DB (e.g. webhook never arrived). Safe to call
 *  repeatedly — returns `changed: false` once reconciled. */
export async function refreshRefundStatus(refundId: string): Promise<RefreshRefundResult> {
    addBreadcrumb({
        category: "razorpay",
        message: "refreshRefundStatus.start",
        data: { refundId },
    });
    const { data, error } = await supabase.functions.invoke("razorpay-refresh-refund", {
        body: { refund_id: refundId },
    });

    if (error) {
        const status = (error as any)?.context?.status;
        const body = await readFunctionsErrorBody(error);
        const code = body?.code ?? body?.error ?? "REFRESH_FAILED";
        const msg = body?.error ?? "Could not refresh refund status";
        const e = new RazorpayServiceError(msg, code, status);
        captureException(e, { refundId, code, status });
        throw e;
    }
    if (!data?.ok) {
        const e = new RazorpayServiceError("Refresh returned non-ok", "REFRESH_FAILED");
        captureException(e, { refundId });
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
   7) Reconciliation — audit our DB against Razorpay's source of truth
   ============================================================ */

export type ReconcileInput = {
    hotelId: string;
    /** ISO date strings. Defaults to last 7 days. Range capped at 31 days. */
    from?: string;
    to?: string;
};

export type ReconcileDiscrepancy = {
    kind: "PAYMENT" | "REFUND";
    severity: "INFO" | "WARN" | "ERROR";
    ourId: string;
    razorpayId: string | null;
    message: string;
    our: Record<string, unknown>;
    razorpay: Record<string, unknown> | null;
};

export type ReconcileResult = {
    ok: true;
    from: string;
    to: string;
    paymentsChecked: number;
    refundsChecked: number;
    discrepancies: ReconcileDiscrepancy[];
};

/** Runs a read-only reconciliation between our `payments` + `refunds`
 *  tables and Razorpay's API for a date range. Returns a structured
 *  discrepancy report; does not auto-fix anything. */
export async function reconcilePeriod(input: ReconcileInput): Promise<ReconcileResult> {
    addBreadcrumb({
        category: "razorpay",
        message: "reconcilePeriod.start",
        data: { hotelId: input.hotelId, from: input.from, to: input.to },
    });
    const { data, error } = await supabase.functions.invoke("razorpay-reconcile", {
        body: {
            hotel_id: input.hotelId,
            from: input.from,
            to: input.to,
        },
    });

    if (error) {
        const status = (error as any)?.context?.status;
        const body = await readFunctionsErrorBody(error);
        const code = body?.code ?? body?.error ?? "RECONCILE_FAILED";
        const msg = body?.error ?? "Reconciliation failed";
        const e = new RazorpayServiceError(msg, code, status);
        captureException(e, { hotelId: input.hotelId, code, status });
        throw e;
    }
    if (!data?.ok) {
        throw new RazorpayServiceError("Reconcile returned non-ok", "RECONCILE_FAILED");
    }

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
   Helpers
   ============================================================ */

async function readFunctionsErrorBody(err: unknown): Promise<any> {
    // supabase-js wraps non-2xx in FunctionsHttpError with `context.response`.
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
