// supabase/functions/_shared/razorpay.test.ts
//
// Deno tests for the Razorpay HMAC + helpers. Run with:
//   deno test --allow-env supabase/functions/_shared/razorpay.test.ts
//
// Covers the money-correctness invariants the rest of the integration
// depends on. If any of these fail, refunds, captures, or signature
// validation could silently misbehave.

import {
    assert,
    assertEquals,
    assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
    hmacHex,
    timingSafeEqualHex,
    rupeesToPaise,
    mapRazorpayMethod,
    razorpayBasicAuth,
} from "./razorpay.ts";

/* ============================================================
   hmacHex — known-fixture cross-check
   ============================================================ */

Deno.test("hmacHex matches RFC 4231 SHA-256 test vector 1", async () => {
    // RFC 4231 test vector 1: key = 0x0b × 20, data = "Hi There"
    // Expected: b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7
    const keyBytes = new Uint8Array(20).fill(0x0b);
    const key = String.fromCharCode(...keyBytes);
    const out = await hmacHex(key, "Hi There");
    assertEquals(
        out,
        "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
    );
});

Deno.test("hmacHex produces 64-char lowercase hex output", async () => {
    const out = await hmacHex("secret", "payload");
    assertEquals(out.length, 64);
    assert(/^[0-9a-f]{64}$/.test(out), "should be 64 lowercase hex chars");
});

Deno.test("hmacHex is deterministic — same input twice → same output", async () => {
    const a = await hmacHex("the-quick-brown-fox", "jumps-over");
    const b = await hmacHex("the-quick-brown-fox", "jumps-over");
    assertEquals(a, b);
});

Deno.test("hmacHex differentiates payloads with same secret", async () => {
    const a = await hmacHex("secret", "order_X|pay_Y");
    const b = await hmacHex("secret", "order_X|pay_Z");
    assertNotEquals(a, b);
});

Deno.test("hmacHex differentiates secrets with same payload", async () => {
    const a = await hmacHex("test-secret", "order_X|pay_Y");
    const b = await hmacHex("live-secret", "order_X|pay_Y");
    assertNotEquals(a, b);
});

/* ============================================================
   timingSafeEqualHex
   ============================================================ */

Deno.test("timingSafeEqualHex true for identical strings", () => {
    assertEquals(
        timingSafeEqualHex(
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
        ),
        true,
    );
});

Deno.test("timingSafeEqualHex false for single-character diff at end", () => {
    assertEquals(
        timingSafeEqualHex(
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff8",
        ),
        false,
    );
});

Deno.test("timingSafeEqualHex false for single-character diff at start", () => {
    assertEquals(
        timingSafeEqualHex(
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
            "a0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
        ),
        false,
    );
});

Deno.test("timingSafeEqualHex false for length mismatch (defends against truncation attack)", () => {
    assertEquals(timingSafeEqualHex("abc", "abcd"), false);
    assertEquals(timingSafeEqualHex("abcd", "abc"), false);
});

Deno.test("timingSafeEqualHex true for two empty strings (edge case)", () => {
    assertEquals(timingSafeEqualHex("", ""), true);
});

/* ============================================================
   rupeesToPaise — money correctness
   ============================================================ */

Deno.test("rupeesToPaise: round integer rupees → exact paise", () => {
    assertEquals(rupeesToPaise(100), 10_000);
    assertEquals(rupeesToPaise(1), 100);
    assertEquals(rupeesToPaise(2500), 250_000);
});

Deno.test("rupeesToPaise: two-decimal rupees → exact paise (no float drift)", () => {
    assertEquals(rupeesToPaise(99.99), 9_999);
    assertEquals(rupeesToPaise(1234.56), 123_456);
});

Deno.test("rupeesToPaise: handles classic float drift case (.999999)", () => {
    // The exact case from the plan: 24999.999999 must round to 2499999 paise,
    // NOT 2499999.9999 (which would error from non-integer to Razorpay)
    assertEquals(rupeesToPaise(24999.999999), 2_500_000);
    // And ones that should round down
    assertEquals(rupeesToPaise(99.994), 9_999);
});

Deno.test("rupeesToPaise: small fractional inputs", () => {
    assertEquals(rupeesToPaise(0.5), 50);
    assertEquals(rupeesToPaise(0.01), 1);
});

Deno.test("rupeesToPaise: zero", () => {
    assertEquals(rupeesToPaise(0), 0);
});

/* ============================================================
   mapRazorpayMethod
   ============================================================ */

Deno.test("mapRazorpayMethod: known Razorpay methods", () => {
    assertEquals(mapRazorpayMethod("upi"), "UPI");
    assertEquals(mapRazorpayMethod("card"), "CARD");
    assertEquals(mapRazorpayMethod("wallet"), "WALLET");
});

Deno.test("mapRazorpayMethod: netbanking maps to OTHER (no enum slot)", () => {
    assertEquals(mapRazorpayMethod("netbanking"), "OTHER");
});

Deno.test("mapRazorpayMethod: EMI rolls up to CARD (underlying instrument)", () => {
    assertEquals(mapRazorpayMethod("emi"), "CARD");
});

Deno.test("mapRazorpayMethod: case-insensitive (Razorpay sometimes returns capitalized)", () => {
    assertEquals(mapRazorpayMethod("UPI"), "UPI");
    assertEquals(mapRazorpayMethod("Card"), "CARD");
});

Deno.test("mapRazorpayMethod: undefined/empty → OTHER (defensive default)", () => {
    assertEquals(mapRazorpayMethod(undefined), "OTHER");
    assertEquals(mapRazorpayMethod(""), "OTHER");
});

Deno.test("mapRazorpayMethod: unknown values → OTHER (forward-compat for new methods)", () => {
    assertEquals(mapRazorpayMethod("crypto"), "OTHER");
    assertEquals(mapRazorpayMethod("paylater"), "OTHER");
});

/* ============================================================
   razorpayBasicAuth
   ============================================================ */

Deno.test("razorpayBasicAuth: produces RFC-compliant Basic auth header", () => {
    // Basic base64("rzp_test_xxx:secret_yyy") = Basic cnpwX3Rlc3RfeHh4OnNlY3JldF95eXk=
    assertEquals(
        razorpayBasicAuth("rzp_test_xxx", "secret_yyy"),
        "Basic cnpwX3Rlc3RfeHh4OnNlY3JldF95eXk=",
    );
});

Deno.test("razorpayBasicAuth: prefixed with 'Basic ' (Razorpay rejects without)", () => {
    const header = razorpayBasicAuth("k", "s");
    assert(header.startsWith("Basic "), "Header must start with 'Basic '");
});

Deno.test("razorpayBasicAuth: differentiates between keys (no cross-contamination)", () => {
    const a = razorpayBasicAuth("rzp_test_A", "secret");
    const b = razorpayBasicAuth("rzp_test_B", "secret");
    assertNotEquals(a, b);
});
