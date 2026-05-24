// web/src/services/razorpayService.test.ts
// Unit tests for the Razorpay frontend service. Mocks supabase.functions.invoke
// and window.Razorpay so we can drive each branch deterministically.
//
// Coverage:
//   • createWalkInOrder       — success shape, error wrapping
//   • openRazorpayCheckout    — sdk-not-loaded, dismissed, payment.failed, handler success
//   • verifyWalkInPayment     — happy path, INVALID_SIGNATURE, AMOUNT_MISMATCH
//   • createRefund            — happy path, server error
//   • processPendingRefund    — happy path, refund_id propagation
//   • onboardRazorpayAccount  — happy path, activation_url passthrough

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const functionsInvoke = vi.fn();

vi.mock("../lib/supabase", () => ({
    supabase: {
        functions: {
            invoke: (name: string, opts?: unknown) => functionsInvoke(name, opts),
        },
    },
}));

// Monitoring is side-effect-only; stub it so tests stay quiet.
vi.mock("../lib/monitoring", () => ({
    addBreadcrumb: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
}));

import {
    createWalkInOrder,
    openRazorpayCheckout,
    verifyWalkInPayment,
    createRefund,
    processPendingRefund,
    onboardRazorpayAccount,
    refreshRefundStatus,
    reconcilePeriod,
    RazorpayServiceError,
    type WalkInOrderResult,
} from "./razorpayService";

// The service reads `window.Razorpay`. In Vitest's default Node environment
// there's no `window`, so we install a minimal stub on globalThis and ensure
// `window === globalThis` for the SDK-detection code path.
beforeEach(() => {
    functionsInvoke.mockReset();
    vi.stubGlobal("window", globalThis as any);
    delete (globalThis as any).Razorpay;
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

/* ============================================================
   createWalkInOrder
   ============================================================ */

describe("createWalkInOrder", () => {
    it("returns the camelCased order shape on success", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: {
                order_id: "order_test_123",
                key_id: "rzp_test_xxx",
                amount: 100000,
                currency: "INR",
                hotel_name: "Test Hotel",
                booking_code: "W-260513-1234",
                folio_id: "folio-uuid-1",
                customer: { name: "Ajit", email: "a@x.com", phone: "9999999999" },
            },
            error: null,
        });

        const out = await createWalkInOrder({ hotelId: "h1", bookingId: "b1" });

        expect(out.orderId).toBe("order_test_123");
        expect(out.amount).toBe(100000); // paise, preserved as int
        expect(out.folioId).toBe("folio-uuid-1");
        expect(out.customer.name).toBe("Ajit");
        // Confirm correct body shape forwarded to the Edge Function
        expect(functionsInvoke).toHaveBeenCalledWith("razorpay-create-order", {
            body: { hotel_id: "h1", booking_id: "b1" },
        });
    });

    it("wraps a server-side error as RazorpayServiceError with code + status", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: null,
            error: {
                message: "boom",
                context: {
                    status: 412,
                    json: async () => ({ error: "Razorpay not configured", code: "NO_LINKED_ACCOUNT" }),
                },
            },
        });

        await expect(createWalkInOrder({ hotelId: "h1", bookingId: "b1" }))
            .rejects.toMatchObject({
                name: "RazorpayServiceError",
                code: "NO_LINKED_ACCOUNT",
                status: 412,
            });
    });

    it("rejects when server returns ok=true but no order_id (malformed)", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: { hotel_name: "Test" }, // missing order_id + key_id
            error: null,
        });
        await expect(createWalkInOrder({ hotelId: "h1", bookingId: "b1" }))
            .rejects.toBeInstanceOf(RazorpayServiceError);
    });
});

/* ============================================================
   openRazorpayCheckout
   ============================================================ */

describe("openRazorpayCheckout", () => {
    const order: WalkInOrderResult = {
        orderId: "order_test_123",
        keyId: "rzp_test_xxx",
        amount: 100000,
        currency: "INR",
        hotelName: "Test Hotel",
        bookingCode: "W-260513-1234",
        folioId: "folio-uuid-1",
        customer: { name: "Ajit" },
    };

    it("resolves FAILED when window.Razorpay isn't loaded", async () => {
        // No window.Razorpay set
        const out = await openRazorpayCheckout(order);
        expect(out.ok).toBe(false);
        if (out.ok) throw new Error("unreachable");
        expect(out.reason).toBe("FAILED");
        expect(out.error?.description).toMatch(/script not loaded/i);
    });

    it("resolves ok:true when Razorpay's handler fires", async () => {
        let capturedOptions: any;
        (globalThis as any).Razorpay = class {
            constructor(opts: any) { capturedOptions = opts; }
            on(_evt: string, _cb: (r: any) => void) { /* no-op for this test */ }
            open() {
                // Simulate Razorpay invoking handler asynchronously
                queueMicrotask(() => {
                    capturedOptions.handler({
                        razorpay_payment_id: "pay_test_abc",
                        razorpay_order_id: "order_test_123",
                        razorpay_signature: "sig_xxx",
                    });
                });
            }
        };

        const out = await openRazorpayCheckout(order);
        expect(out.ok).toBe(true);
        if (!out.ok) throw new Error("unreachable");
        expect(out.paymentId).toBe("pay_test_abc");
        expect(out.signature).toBe("sig_xxx");
        // Sanity-check we passed order_id and not amount alone (Route requirement)
        expect(capturedOptions.order_id).toBe("order_test_123");
    });

    it("resolves ok:false reason=DISMISSED when modal is dismissed", async () => {
        let capturedOptions: any;
        (globalThis as any).Razorpay = class {
            constructor(opts: any) { capturedOptions = opts; }
            on() { /* no-op */ }
            open() {
                queueMicrotask(() => capturedOptions.modal.ondismiss());
            }
        };

        const out = await openRazorpayCheckout(order);
        expect(out.ok).toBe(false);
        if (out.ok) throw new Error("unreachable");
        expect(out.reason).toBe("DISMISSED");
    });

    it("resolves ok:false reason=FAILED on Razorpay payment.failed event", async () => {
        let failCb: ((r: any) => void) | null = null;
        (globalThis as any).Razorpay = class {
            constructor(_opts: any) { /* ignore */ }
            on(event: string, cb: (r: any) => void) {
                if (event === "payment.failed") failCb = cb;
            }
            open() {
                queueMicrotask(() => failCb?.({ error: { code: "BAD_DESCRIPTOR", description: "Card declined" } }));
            }
        };

        const out = await openRazorpayCheckout(order);
        expect(out.ok).toBe(false);
        if (out.ok) throw new Error("unreachable");
        expect(out.reason).toBe("FAILED");
        expect(out.error?.code).toBe("BAD_DESCRIPTOR");
    });
});

/* ============================================================
   verifyWalkInPayment
   ============================================================ */

describe("verifyWalkInPayment", () => {
    const input = {
        hotelId: "h1",
        bookingId: "b1",
        folioId: "f1",
        orderId: "order_test_123",
        paymentId: "pay_test_abc",
        signature: "sig_xxx",
    };

    it("returns success on ok:true response", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: { ok: true, paymentDbId: "db-uuid-1", deduped: false },
            error: null,
        });
        const out = await verifyWalkInPayment(input);
        expect(out.ok).toBe(true);
        expect(out.paymentDbId).toBe("db-uuid-1");
        expect(out.deduped).toBe(false);
    });

    it("handles deduped:true (webhook beat us — still a successful outcome)", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: { ok: true, paymentDbId: "db-uuid-1", deduped: true },
            error: null,
        });
        const out = await verifyWalkInPayment(input);
        expect(out.deduped).toBe(true);
    });

    it("surfaces INVALID_SIGNATURE with a support-oriented message", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: null,
            error: {
                message: "rejected",
                context: { status: 400, json: async () => ({ error: "INVALID_SIGNATURE" }) },
            },
        });
        await expect(verifyWalkInPayment(input)).rejects.toMatchObject({
            code: "INVALID_SIGNATURE",
            message: expect.stringMatching(/contact support/i),
        });
    });

    it("surfaces AMOUNT_MISMATCH with retry-or-cash message", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: null,
            error: {
                message: "rejected",
                context: { status: 409, json: async () => ({ error: "AMOUNT_MISMATCH" }) },
            },
        });
        await expect(verifyWalkInPayment(input)).rejects.toMatchObject({
            code: "AMOUNT_MISMATCH",
            message: expect.stringMatching(/didn't match/i),
        });
    });

    it("surfaces NOT_CAPTURED with retry message", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: null,
            error: {
                message: "rejected",
                context: { status: 409, json: async () => ({ error: "NOT_CAPTURED" }) },
            },
        });
        await expect(verifyWalkInPayment(input)).rejects.toMatchObject({
            code: "NOT_CAPTURED",
            message: expect.stringMatching(/retry/i),
        });
    });
});

/* ============================================================
   createRefund
   ============================================================ */

describe("createRefund", () => {
    it("returns the camelCased refund shape on success", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: {
                ok: true,
                refund_id: "refund-uuid-1",
                razorpay_refund_id: "rfnd_test_abc",
                status: "pending",
                amount: 500,
            },
            error: null,
        });
        const out = await createRefund({ paymentId: "p1", amount: 500, reason: "guest disputed" });
        expect(out.refundId).toBe("refund-uuid-1");
        expect(out.razorpayRefundId).toBe("rfnd_test_abc");
        expect(out.amount).toBe(500);
        expect(functionsInvoke).toHaveBeenCalledWith("razorpay-create-refund", {
            body: { payment_id: "p1", amount: 500, reason: "guest disputed" },
        });
    });

    it("wraps EXCEEDS_REFUNDABLE rejection", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: null,
            error: {
                context: {
                    status: 409,
                    json: async () => ({ error: "Amount exceeds refundable balance", code: "EXCEEDS_REFUNDABLE" }),
                },
            },
        });
        await expect(createRefund({ paymentId: "p1", amount: 99999 })).rejects.toMatchObject({
            code: "EXCEEDS_REFUNDABLE",
            status: 409,
        });
    });
});

/* ============================================================
   processPendingRefund
   ============================================================ */

describe("processPendingRefund", () => {
    it("forwards refund_id to the Edge Function and unwraps the response", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: { ok: true, refund_id: "refund-uuid-2", razorpay_refund_id: "rfnd_test_xyz", status: "pending", amount: 1500 },
            error: null,
        });

        const out = await processPendingRefund("refund-uuid-2");

        expect(functionsInvoke).toHaveBeenCalledWith("razorpay-create-refund", {
            body: { refund_id: "refund-uuid-2" },
        });
        expect(out.refundId).toBe("refund-uuid-2");
        expect(out.razorpayRefundId).toBe("rfnd_test_xyz");
        expect(out.amount).toBe(1500);
    });

    it("propagates NOT_PENDING (already processed) as RazorpayServiceError", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: null,
            error: {
                context: {
                    status: 409,
                    json: async () => ({ error: "Refund already processed or failed", code: "NOT_PENDING" }),
                },
            },
        });
        await expect(processPendingRefund("refund-x")).rejects.toMatchObject({
            code: "NOT_PENDING",
        });
    });
});

/* ============================================================
   onboardRazorpayAccount
   ============================================================ */

describe("onboardRazorpayAccount", () => {
    it("returns acc_xxx + activationUrl=null in test mode", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: { ok: true, account_id: "acc_test_abc", status: "created", activation_url: null },
            error: null,
        });
        const out = await onboardRazorpayAccount({ hotelId: "h1" });
        expect(out.accountId).toBe("acc_test_abc");
        expect(out.activationUrl).toBeNull();
    });

    it("passes through live-mode activation_url for KYC redirect", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: {
                ok: true,
                account_id: "acc_live_xyz",
                status: "created",
                activation_url: "https://razorpay.com/onboarding/123",
            },
            error: null,
        });
        const out = await onboardRazorpayAccount({ hotelId: "h1" });
        expect(out.accountId).toBe("acc_live_xyz");
        expect(out.activationUrl).toBe("https://razorpay.com/onboarding/123");
    });
});

/* ============================================================
   refreshRefundStatus
   ============================================================ */

describe("refreshRefundStatus", () => {
    it("returns changed=true when Razorpay flipped a pending refund to processed", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: {
                ok: true,
                refund_id: "refund-uuid-1",
                our_status: "PROCESSED",
                razorpay_status: "processed",
                changed: true,
            },
            error: null,
        });
        const out = await refreshRefundStatus("refund-uuid-1");
        expect(functionsInvoke).toHaveBeenCalledWith("razorpay-refresh-refund", {
            body: { refund_id: "refund-uuid-1" },
        });
        expect(out.changed).toBe(true);
        expect(out.ourStatus).toBe("PROCESSED");
        expect(out.razorpayStatus).toBe("processed");
    });

    it("returns changed=false when Razorpay still reports pending (no DB write)", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: {
                ok: true,
                refund_id: "refund-uuid-2",
                our_status: "PENDING",
                razorpay_status: "pending",
                changed: false,
            },
            error: null,
        });
        const out = await refreshRefundStatus("refund-uuid-2");
        expect(out.changed).toBe(false);
        expect(out.ourStatus).toBe("PENDING");
    });

    it("wraps NOT_SUBMITTED rejection (refund row has no razorpay_refund_id yet)", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: null,
            error: {
                context: {
                    status: 409,
                    json: async () => ({ error: "Refund has not been submitted to Razorpay yet", code: "NOT_SUBMITTED" }),
                },
            },
        });
        await expect(refreshRefundStatus("refund-x")).rejects.toMatchObject({
            code: "NOT_SUBMITTED",
            status: 409,
        });
    });

    it("wraps 504 timeout as RazorpayServiceError so the UI can show a retry hint", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: null,
            error: {
                context: {
                    status: 504,
                    json: async () => ({ error: "Razorpay timed out — try again in a moment" }),
                },
            },
        });
        await expect(refreshRefundStatus("refund-y")).rejects.toBeInstanceOf(RazorpayServiceError);
    });
});

/* ============================================================
   reconcilePeriod
   ============================================================ */

describe("reconcilePeriod", () => {
    it("returns an empty-discrepancy result when our DB matches Razorpay", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: {
                ok: true,
                from: "2026-05-07T00:00:00.000Z",
                to: "2026-05-14T23:59:59.000Z",
                payments_checked: 12,
                refunds_checked: 2,
                discrepancies: [],
            },
            error: null,
        });
        const out = await reconcilePeriod({ hotelId: "h1" });
        expect(out.paymentsChecked).toBe(12);
        expect(out.refundsChecked).toBe(2);
        expect(out.discrepancies).toEqual([]);
    });

    it("camelCases discrepancy fields (our_id → ourId, razorpay_id → razorpayId)", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: {
                ok: true,
                from: "2026-05-07T00:00:00.000Z",
                to: "2026-05-14T23:59:59.000Z",
                payments_checked: 1,
                refunds_checked: 1,
                discrepancies: [
                    {
                        kind: "PAYMENT",
                        severity: "ERROR",
                        our_id: "pay-uuid-1",
                        razorpay_id: "pay_test_xyz",
                        message: "Amount mismatch",
                        our: { amount: 100, status: "COMPLETED" },
                        razorpay: { amount: 9999, status: "captured" },
                    },
                    {
                        kind: "REFUND",
                        severity: "INFO",
                        our_id: "ref-uuid-1",
                        razorpay_id: "rfnd_test_xyz",
                        message: "Pending in our DB; Razorpay reports \"processed\" — use Refresh Status to reconcile",
                        our: { amount: 50, status: "PENDING" },
                        razorpay: { amount: 5000, status: "processed" },
                    },
                ],
            },
            error: null,
        });
        const out = await reconcilePeriod({ hotelId: "h1" });
        expect(out.discrepancies).toHaveLength(2);
        expect(out.discrepancies[0].ourId).toBe("pay-uuid-1");
        expect(out.discrepancies[0].razorpayId).toBe("pay_test_xyz");
        expect(out.discrepancies[0].kind).toBe("PAYMENT");
        expect(out.discrepancies[0].severity).toBe("ERROR");
        expect(out.discrepancies[1].kind).toBe("REFUND");
        expect(out.discrepancies[1].severity).toBe("INFO");
    });

    it("forwards from/to into the Edge Function body when provided", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: {
                ok: true,
                from: "2026-05-01T00:00:00.000Z",
                to: "2026-05-08T00:00:00.000Z",
                payments_checked: 0,
                refunds_checked: 0,
                discrepancies: [],
            },
            error: null,
        });
        await reconcilePeriod({
            hotelId: "h1",
            from: "2026-05-01T00:00:00.000Z",
            to: "2026-05-08T00:00:00.000Z",
        });
        expect(functionsInvoke).toHaveBeenCalledWith("razorpay-reconcile", {
            body: {
                hotel_id: "h1",
                from: "2026-05-01T00:00:00.000Z",
                to: "2026-05-08T00:00:00.000Z",
            },
        });
    });

    it("wraps RANGE_TOO_LARGE rejection with code", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: null,
            error: {
                context: {
                    status: 400,
                    json: async () => ({ error: "Range too large (60d). Max 31d per run.", code: "RANGE_TOO_LARGE" }),
                },
            },
        });
        await expect(reconcilePeriod({ hotelId: "h1" })).rejects.toMatchObject({
            code: "RANGE_TOO_LARGE",
            status: 400,
        });
    });

    it("wraps a forbidden response (caller is not a finance manager)", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: null,
            error: {
                context: {
                    status: 403,
                    json: async () => ({ error: "Forbidden: finance manager role required" }),
                },
            },
        });
        await expect(reconcilePeriod({ hotelId: "h1" })).rejects.toMatchObject({
            status: 403,
        });
    });
});
