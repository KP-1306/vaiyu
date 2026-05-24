// web/src/services/razorpayDirectService.test.ts
//
// Unit tests for the DIRECT-mode frontend service. Mocks
// supabase.functions.invoke and window.Razorpay — drives each branch
// deterministically.
//
// Coverage:
//   • createWalkInOrder        — success shape + error wrapping
//   • verifyWalkInPayment      — invokes razorpay-direct-verify-payment
//   • createRefund             — wraps WRONG_MODE rejection
//   • refreshRefundStatus      — invokes razorpay-direct-refresh-refund
//   • reconcilePeriod          — invokes razorpay-direct-reconcile
//   • setDirectCredentials     — returns webhook secret + URL
//   • clearDirectCredentials   — happy path

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const functionsInvoke = vi.fn();

vi.mock("../lib/supabase", () => ({
    supabase: {
        functions: {
            invoke: (name: string, opts?: unknown) => functionsInvoke(name, opts),
        },
    },
}));

vi.mock("../lib/monitoring", () => ({
    addBreadcrumb: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
}));

import {
    createWalkInOrder,
    verifyWalkInPayment,
    createRefund,
    processPendingRefund,
    refreshRefundStatus,
    reconcilePeriod,
    setDirectCredentials,
    clearDirectCredentials,
    RazorpayServiceError,
} from "./razorpayDirectService";

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
   createWalkInOrder — DIRECT
   ============================================================ */

describe("createWalkInOrder (DIRECT)", () => {
    it("targets razorpay-direct-create-order and unwraps the response", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: {
                order_id: "order_direct_xyz",
                key_id: "rzp_test_HOTEL_OWN_KEY",
                amount: 50000,
                currency: "INR",
                hotel_name: "Tenant1 Hotel",
                booking_code: "W-260518-9999",
                folio_id: "folio-direct-1",
                customer: { name: "Test Guest" },
            },
            error: null,
        });
        const out = await createWalkInOrder({ hotelId: "h1", bookingId: "b1" });

        expect(functionsInvoke).toHaveBeenCalledWith("razorpay-direct-create-order", {
            body: { hotel_id: "h1", booking_id: "b1" },
        });
        expect(out.orderId).toBe("order_direct_xyz");
        // Key returned to client is the HOTEL'S own key, not the platform's
        expect(out.keyId).toBe("rzp_test_HOTEL_OWN_KEY");
        expect(out.folioId).toBe("folio-direct-1");
    });

    it("wraps DIRECT_CREDENTIALS_MISSING when hotel hasn't configured keys", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: null,
            error: {
                context: {
                    status: 412,
                    json: async () => ({
                        error: "Hotel's Razorpay credentials are not configured",
                        code: "DIRECT_CREDENTIALS_MISSING",
                    }),
                },
            },
        });
        await expect(createWalkInOrder({ hotelId: "h1", bookingId: "b1" })).rejects.toMatchObject({
            code: "DIRECT_CREDENTIALS_MISSING",
            status: 412,
        });
    });
});

/* ============================================================
   verifyWalkInPayment — DIRECT
   ============================================================ */

describe("verifyWalkInPayment (DIRECT)", () => {
    const input = {
        hotelId: "h1",
        bookingId: "b1",
        folioId: "f1",
        orderId: "order_direct_xyz",
        paymentId: "pay_direct_abc",
        signature: "sig_xxx",
    };

    it("targets razorpay-direct-verify-payment", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: { ok: true, paymentDbId: "db-1", deduped: false },
            error: null,
        });
        const out = await verifyWalkInPayment(input);
        expect(functionsInvoke).toHaveBeenCalledWith("razorpay-direct-verify-payment", {
            body: {
                razorpay_order_id: "order_direct_xyz",
                razorpay_payment_id: "pay_direct_abc",
                razorpay_signature: "sig_xxx",
                hotel_id: "h1",
                booking_id: "b1",
                folio_id: "f1",
            },
        });
        expect(out.paymentDbId).toBe("db-1");
        expect(out.deduped).toBe(false);
    });

    it("surfaces INVALID_SIGNATURE with support-oriented message", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: null,
            error: {
                context: { status: 400, json: async () => ({ error: "INVALID_SIGNATURE" }) },
            },
        });
        await expect(verifyWalkInPayment(input)).rejects.toMatchObject({
            code: "INVALID_SIGNATURE",
            message: expect.stringMatching(/contact support/i),
        });
    });
});

/* ============================================================
   createRefund — DIRECT
   ============================================================ */

describe("createRefund (DIRECT)", () => {
    it("targets razorpay-direct-create-refund", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: {
                ok: true, refund_id: "rfd-1", razorpay_refund_id: "rfnd_direct_xyz",
                status: "pending", amount: 250,
            },
            error: null,
        });
        const out = await createRefund({ paymentId: "p1", amount: 250 });
        expect(functionsInvoke).toHaveBeenCalledWith("razorpay-direct-create-refund", {
            body: { payment_id: "p1", amount: 250, reason: undefined },
        });
        expect(out.refundId).toBe("rfd-1");
    });

    it("wraps WRONG_MODE rejection (caller tried to refund a ROUTE payment via DIRECT)", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: null,
            error: {
                context: {
                    status: 409,
                    json: async () => ({
                        error: "This payment was collected via Route, not DIRECT. Use the Route refund flow.",
                        code: "WRONG_MODE",
                    }),
                },
            },
        });
        await expect(createRefund({ paymentId: "p1" })).rejects.toMatchObject({
            code: "WRONG_MODE",
            status: 409,
        });
    });
});

describe("processPendingRefund (DIRECT)", () => {
    it("forwards refund_id and targets the DIRECT Edge Function", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: { ok: true, refund_id: "rfd-2", razorpay_refund_id: "rfnd_xyz", status: "pending", amount: 99 },
            error: null,
        });
        await processPendingRefund("rfd-2");
        expect(functionsInvoke).toHaveBeenCalledWith("razorpay-direct-create-refund", {
            body: { refund_id: "rfd-2" },
        });
    });
});

/* ============================================================
   refreshRefundStatus — DIRECT
   ============================================================ */

describe("refreshRefundStatus (DIRECT)", () => {
    it("returns changed=true when Razorpay flipped pending → processed", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: {
                ok: true, refund_id: "rfd-1",
                our_status: "PROCESSED", razorpay_status: "processed", changed: true,
            },
            error: null,
        });
        const out = await refreshRefundStatus("rfd-1");
        expect(functionsInvoke).toHaveBeenCalledWith("razorpay-direct-refresh-refund", {
            body: { refund_id: "rfd-1" },
        });
        expect(out.changed).toBe(true);
        expect(out.ourStatus).toBe("PROCESSED");
    });

    it("wraps WRONG_MODE rejection", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: null,
            error: {
                context: {
                    status: 409,
                    json: async () => ({ error: "Wrong mode", code: "WRONG_MODE" }),
                },
            },
        });
        await expect(refreshRefundStatus("rfd-x")).rejects.toMatchObject({ code: "WRONG_MODE" });
    });
});

/* ============================================================
   reconcilePeriod — DIRECT
   ============================================================ */

describe("reconcilePeriod (DIRECT)", () => {
    it("targets razorpay-direct-reconcile and camelCases discrepancies", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: {
                ok: true,
                from: "2026-05-11T00:00:00.000Z",
                to: "2026-05-18T23:59:59.000Z",
                payments_checked: 3,
                refunds_checked: 1,
                discrepancies: [{
                    kind: "REFUND", severity: "INFO",
                    our_id: "rfd-1", razorpay_id: "rfnd_xyz",
                    message: "stuck pending",
                    our: { status: "PENDING" }, razorpay: { status: "processed" },
                }],
            },
            error: null,
        });
        const out = await reconcilePeriod({ hotelId: "h1" });
        expect(functionsInvoke).toHaveBeenCalledWith("razorpay-direct-reconcile", {
            body: { hotel_id: "h1", from: undefined, to: undefined },
        });
        expect(out.paymentsChecked).toBe(3);
        expect(out.discrepancies[0].ourId).toBe("rfd-1");
    });
});

/* ============================================================
   setDirectCredentials
   ============================================================ */

describe("setDirectCredentials", () => {
    it("returns webhook secret + URL on success", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: {
                ok: true,
                mode: "test",
                webhook_secret: "abc123def456",
                webhook_url: "https://x.supabase.co/functions/v1/razorpay-direct-webhook",
                subscribed_events: ["payment.captured", "refund.processed"],
            },
            error: null,
        });
        const out = await setDirectCredentials({
            hotelId: "h1",
            keyId: "rzp_test_xxx",
            keySecret: "secret_xxx",
        });
        expect(out.mode).toBe("test");
        expect(out.webhookSecret).toBe("abc123def456");
        expect(out.webhookUrl).toContain("razorpay-direct-webhook");
        expect(out.subscribedEvents.length).toBe(2);
    });

    it("wraps INVALID_CREDENTIALS when Razorpay rejected the key pair", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: null,
            error: {
                context: {
                    status: 401,
                    json: async () => ({
                        error: "Razorpay rejected these credentials. Double-check key_id and key_secret.",
                        code: "INVALID_CREDENTIALS",
                    }),
                },
            },
        });
        await expect(setDirectCredentials({
            hotelId: "h1", keyId: "rzp_test_bad", keySecret: "wrong",
        })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS", status: 401 });
    });

    it("wraps INVALID_KEY_ID_FORMAT when key_id is malformed", async () => {
        functionsInvoke.mockResolvedValueOnce({
            data: null,
            error: {
                context: {
                    status: 400,
                    json: async () => ({
                        error: "key_id must look like rzp_test_xxx or rzp_live_xxx",
                        code: "INVALID_KEY_ID_FORMAT",
                    }),
                },
            },
        });
        await expect(setDirectCredentials({
            hotelId: "h1", keyId: "not_a_key", keySecret: "secret",
        })).rejects.toBeInstanceOf(RazorpayServiceError);
    });
});

describe("clearDirectCredentials", () => {
    it("returns ok on success", async () => {
        functionsInvoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
        const out = await clearDirectCredentials("h1");
        expect(out.ok).toBe(true);
        expect(functionsInvoke).toHaveBeenCalledWith("razorpay-direct-clear-credentials", {
            body: { hotel_id: "h1" },
        });
    });
});
