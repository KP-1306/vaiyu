// Razorpay shared helpers — HMAC-SHA256 via Web Crypto.
//
// Used by:
//   • razorpay-verify-payment   — verifies the client-supplied signature on
//     the success callback (`order_id|payment_id` keyed with key_secret).
//   • razorpay-webhook          — verifies the webhook signature on every
//     event (raw body keyed with webhook_secret).
//
// We never roll our own crypto. `crypto.subtle` is available in Deno's
// runtime by default. Compare with constant-time hex equality.

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time hex string compare. Length-mismatch returns false. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) {
    r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return r === 0;
}

/** Convert rupees (NUMERIC) to integer paise. Always Math.round to avoid
 *  floating-point drift like 24999.999999. Razorpay min order is ₹1.00 (100p). */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/** Map Razorpay's payment.method value to the `payments.method` enum. */
export function mapRazorpayMethod(rzpMethod: string | undefined): "UPI" | "CARD" | "WALLET" | "OTHER" {
  switch ((rzpMethod || "").toLowerCase()) {
    case "upi": return "UPI";
    case "card": return "CARD";
    case "wallet": return "WALLET";
    case "netbanking": return "OTHER";
    case "emi": return "CARD";
    default: return "OTHER";
  }
}

/** Build Basic auth header from `key_id:key_secret`. */
export function razorpayBasicAuth(keyId: string, keySecret: string): string {
  return "Basic " + btoa(`${keyId}:${keySecret}`);
}

export const RAZORPAY_API_BASE = "https://api.razorpay.com/v1";
