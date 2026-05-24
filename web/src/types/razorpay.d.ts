// Type shim for the Razorpay Checkout script loaded via <script src="...">.
// We intentionally use `any` rather than full Razorpay types because the
// Checkout SDK is not on @types/* and the public API surface we use is small.

declare global {
    interface Window {
        Razorpay?: any;
    }
}

export {};
