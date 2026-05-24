// web/src/services/razorpayClient.ts
//
// Thin facade that picks the right Razorpay service (Route vs Direct) at
// call time based on a hotel's `razorpay_mode`. Lets the rest of the app
// stay mode-agnostic — callers do:
//
//   const svc = getRazorpayClient(hotel.razorpay_mode);
//   const order = await svc.createWalkInOrder({...});
//
// Without this facade, every payment-collecting page would import both
// services and switch by mode inline — duplicated dispatch logic that
// drifts over time. Centralizing here means adding a new mode (or
// switching one) is a one-line change.

import * as routeSvc from "./razorpayService";
import * as directSvc from "./razorpayDirectService";
import { RazorpayServiceError } from "./razorpayService";

export type RazorpayMode = "NONE" | "DIRECT" | "ROUTE";

/** The shared API surface between Route and Direct services. Both modules
 *  export functions with identical signatures, so a single union type
 *  describes the dispatched value. */
export type RazorpayClient = {
    createWalkInOrder: typeof routeSvc.createWalkInOrder;
    openRazorpayCheckout: typeof routeSvc.openRazorpayCheckout;
    verifyWalkInPayment: typeof routeSvc.verifyWalkInPayment;
    createRefund: typeof routeSvc.createRefund;
    processPendingRefund: typeof routeSvc.processPendingRefund;
    refreshRefundStatus: typeof routeSvc.refreshRefundStatus;
    reconcilePeriod: typeof routeSvc.reconcilePeriod;
};

/** Returns the active Razorpay client for a given mode. Throws a
 *  caller-friendly `RazorpayServiceError` for NONE so payment-collecting
 *  pages can show "online payments not enabled" without special-casing. */
export function getRazorpayClient(mode: RazorpayMode | string | null | undefined): RazorpayClient {
    if (mode === "ROUTE") return routeSvc as RazorpayClient;
    if (mode === "DIRECT") return directSvc as RazorpayClient;
    throw new RazorpayServiceError(
        "Online payments are not enabled for this hotel",
        "ONLINE_PAYMENTS_DISABLED",
    );
}

/** Returns the active client OR null without throwing — useful for UI
 *  that wants to conditionally hide an online-pay button when mode is NONE. */
export function tryGetRazorpayClient(mode: RazorpayMode | string | null | undefined): RazorpayClient | null {
    if (mode === "ROUTE") return routeSvc as RazorpayClient;
    if (mode === "DIRECT") return directSvc as RazorpayClient;
    return null;
}

/** Re-export the error class so callers don't need a separate import. */
export { RazorpayServiceError };
