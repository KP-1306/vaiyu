// supabase/functions/_shared/razorpay-direct.ts
//
// DIRECT-mode helpers for per-hotel Razorpay credentials. Used only by
// the razorpay-direct-* Edge Functions. The original Route helpers in
// _shared/razorpay.ts are NOT touched and remain the source of truth for
// HMAC, paise conversion, method mapping, etc.
//
// Responsibilities:
//   1. AES-256-GCM encrypt/decrypt for key_secret + webhook_secret
//      (we don't store plaintext at rest).
//   2. loadHotelDirectKeys() — service-role helper that fetches a hotel's
//      credentials and decrypts them in one call.
//
// Master key: RAZORPAY_DIRECT_SECRETS_KEY env var, 64 hex chars (= 32 bytes).
// Generate with: openssl rand -hex 32
//
// Ciphertext layout (base64-encoded):
//   bytes 0..11   : iv (12 bytes, GCM standard)
//   bytes 12..end : ciphertext concatenated with 16-byte auth tag (Web Crypto
//                   appends the tag automatically when sign=true).

import type { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const IV_BYTES = 12;

/* ============================================================
   Key derivation (cached for the lifetime of the function instance)
   ============================================================
   We read the env var inside getMasterKey(), NOT at module top-level.
   ES module imports are hoisted, so reading at top-level would race with
   any test code that sets the env after import. Production cold-starts
   pay one env lookup per first call — negligible. */

let cachedKey: CryptoKey | null = null;
let cachedKeyHex: string | null = null;

async function getMasterKey(): Promise<CryptoKey> {
  const masterKeyHex = Deno.env.get("RAZORPAY_DIRECT_SECRETS_KEY") ?? "";
  if (!masterKeyHex) {
    throw new Error(
      "RAZORPAY_DIRECT_SECRETS_KEY is not set. Generate with `openssl rand -hex 32` and `supabase secrets set RAZORPAY_DIRECT_SECRETS_KEY=...`",
    );
  }
  if (cachedKey && cachedKeyHex === masterKeyHex) return cachedKey;

  if (!/^[0-9a-fA-F]{64}$/.test(masterKeyHex)) {
    throw new Error("RAZORPAY_DIRECT_SECRETS_KEY must be 64 hex characters (32 bytes).");
  }
  const keyBytes = hexToBytes(masterKeyHex);
  cachedKey = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  cachedKeyHex = masterKeyHex;
  return cachedKey;
}

/* ============================================================
   Public API
   ============================================================ */

/** AES-256-GCM encrypt. Returns base64(iv || ciphertext+authTag).
 *  Each call uses a fresh random IV — required for GCM security. */
export async function encryptSecret(plaintext: string): Promise<string> {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encryptSecret: plaintext must be a non-empty string");
  }
  const key = await getMasterKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ctBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const ct = new Uint8Array(ctBuf);
  // pack iv || ct
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv, 0);
  packed.set(ct, iv.length);
  return bytesToBase64(packed);
}

/** AES-256-GCM decrypt. Throws on tamper / wrong key / malformed input. */
export async function decryptSecret(packedB64: string): Promise<string> {
  if (typeof packedB64 !== "string" || packedB64.length === 0) {
    throw new Error("decryptSecret: ciphertext must be a non-empty string");
  }
  const key = await getMasterKey();
  const packed = base64ToBytes(packedB64);
  if (packed.length <= IV_BYTES) {
    throw new Error("decryptSecret: ciphertext too short to contain IV + tag");
  }
  const iv = packed.subarray(0, IV_BYTES);
  const ct = packed.subarray(IV_BYTES);
  // crypto.subtle.decrypt throws DOMException("OperationError") on tamper —
  // we let it propagate so callers can catch and log uniformly.
  const ptBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ct as BufferSource,
  );
  return new TextDecoder().decode(ptBuf);
}

/* ============================================================
   Hotel DIRECT credential loader
   ============================================================ */

export type HotelDirectKeys = {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
};

/** Fetches a hotel's DIRECT credentials and decrypts them. Does NOT gate
 *  on `hotel.razorpay_mode === 'DIRECT'` — we intentionally allow loading
 *  even when the hotel has switched to ROUTE/NONE so that:
 *    • Refunds on historical DIRECT payments still work after a mode switch
 *      (refund must use the same keys that captured the original payment).
 *    • Webhook events for in-flight DIRECT activity are still processed
 *      after a mid-flight mode switch.
 *    • Reconciliation can audit historical DIRECT rows regardless of
 *      current mode.
 *  Callers that want to gate on the CURRENT mode (e.g. create-order, which
 *  should refuse new orders once the hotel is on ROUTE) MUST check
 *  `hotel.razorpay_mode` themselves. */
export async function loadHotelDirectKeys(
  svc: ReturnType<typeof createClient> | any,
  hotelId: string,
): Promise<HotelDirectKeys> {
  const { data: hotel, error } = await svc
    .from("hotels")
    .select("razorpay_direct_key_id, razorpay_direct_key_secret_enc, razorpay_direct_webhook_secret_enc")
    .eq("id", hotelId)
    .maybeSingle();

  if (error) throw new Error(`loadHotelDirectKeys: query failed: ${error.message}`);
  if (!hotel) throw new Error("HOTEL_NOT_FOUND");
  if (
    !hotel.razorpay_direct_key_id ||
    !hotel.razorpay_direct_key_secret_enc ||
    !hotel.razorpay_direct_webhook_secret_enc
  ) {
    throw new Error("DIRECT_CREDENTIALS_MISSING");
  }

  const [keySecret, webhookSecret] = await Promise.all([
    decryptSecret(hotel.razorpay_direct_key_secret_enc),
    decryptSecret(hotel.razorpay_direct_webhook_secret_enc),
  ]);

  return {
    keyId: hotel.razorpay_direct_key_id,
    keySecret,
    webhookSecret,
  };
}

/** Variant that loads only the webhook_secret. Used by razorpay-direct-webhook,
 *  which doesn't need the key pair to verify a signature. Same rationale as
 *  loadHotelDirectKeys: doesn't gate on mode, so in-flight webhook events
 *  for historical DIRECT activity still verify after a mode switch. Throws
 *  only if credentials are genuinely missing (cleared by clear-credentials). */
export async function loadHotelWebhookSecret(
  svc: ReturnType<typeof createClient> | any,
  hotelId: string,
): Promise<string> {
  const { data: hotel, error } = await svc
    .from("hotels")
    .select("razorpay_direct_webhook_secret_enc")
    .eq("id", hotelId)
    .maybeSingle();
  if (error) throw new Error(`loadHotelWebhookSecret: ${error.message}`);
  if (!hotel) throw new Error("HOTEL_NOT_FOUND");
  if (!hotel.razorpay_direct_webhook_secret_enc) {
    throw new Error("DIRECT_CREDENTIALS_MISSING");
  }
  return await decryptSecret(hotel.razorpay_direct_webhook_secret_enc);
}

/* ============================================================
   Byte / encoding helpers (no external deps)
   ============================================================ */

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Generates a 32-byte hex string suitable for a webhook secret.
 *  Used by razorpay-direct-set-credentials when provisioning a hotel. */
export function generateWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
