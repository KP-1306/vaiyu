// web/src/services/razorpayClient.test.ts
//
// Unit tests for the Route-vs-Direct facade. Verifies that dispatch
// correctly picks the right service per mode and surfaces a clean error
// for NONE.

import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", () => ({
    supabase: { functions: { invoke: vi.fn() } },
}));
vi.mock("../lib/monitoring", () => ({
    addBreadcrumb: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
}));

import { getRazorpayClient, tryGetRazorpayClient, RazorpayServiceError } from "./razorpayClient";
import * as routeSvc from "./razorpayService";
import * as directSvc from "./razorpayDirectService";

describe("getRazorpayClient", () => {
    it("returns the Route service for mode='ROUTE'", () => {
        const client = getRazorpayClient("ROUTE");
        // Identity check — facade exposes the actual module functions
        expect(client.createWalkInOrder).toBe(routeSvc.createWalkInOrder);
        expect(client.verifyWalkInPayment).toBe(routeSvc.verifyWalkInPayment);
    });

    it("returns the Direct service for mode='DIRECT'", () => {
        const client = getRazorpayClient("DIRECT");
        expect(client.createWalkInOrder).toBe(directSvc.createWalkInOrder);
        expect(client.verifyWalkInPayment).toBe(directSvc.verifyWalkInPayment);
    });

    it("throws ONLINE_PAYMENTS_DISABLED for mode='NONE'", () => {
        expect(() => getRazorpayClient("NONE")).toThrow(RazorpayServiceError);
        try {
            getRazorpayClient("NONE");
        } catch (e) {
            expect((e as RazorpayServiceError).code).toBe("ONLINE_PAYMENTS_DISABLED");
        }
    });

    it("throws for unknown / null / undefined modes (safe default)", () => {
        expect(() => getRazorpayClient(null)).toThrow(RazorpayServiceError);
        expect(() => getRazorpayClient(undefined)).toThrow(RazorpayServiceError);
        expect(() => getRazorpayClient("MAGIC")).toThrow(RazorpayServiceError);
    });
});

describe("tryGetRazorpayClient", () => {
    it("returns the client for valid modes", () => {
        expect(tryGetRazorpayClient("ROUTE")).not.toBeNull();
        expect(tryGetRazorpayClient("DIRECT")).not.toBeNull();
    });

    it("returns null for NONE / unknown / nullish — never throws", () => {
        expect(tryGetRazorpayClient("NONE")).toBeNull();
        expect(tryGetRazorpayClient(null)).toBeNull();
        expect(tryGetRazorpayClient(undefined)).toBeNull();
        expect(tryGetRazorpayClient("MAGIC")).toBeNull();
    });
});

describe("API surface equivalence", () => {
    it("both services expose the same function names (drop-in replaceable)", () => {
        const apiNames = [
            "createWalkInOrder",
            "openRazorpayCheckout",
            "verifyWalkInPayment",
            "createRefund",
            "processPendingRefund",
            "refreshRefundStatus",
            "reconcilePeriod",
        ];
        for (const name of apiNames) {
            expect(typeof (routeSvc as any)[name]).toBe("function");
            expect(typeof (directSvc as any)[name]).toBe("function");
        }
    });
});
