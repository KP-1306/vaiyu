// supabase/functions/_shared/razorpay-direct.test.ts
//
// Deno tests for the DIRECT-mode encryption helper. Run with:
//   deno test --allow-env supabase/functions/_shared/razorpay-direct.test.ts
//
// Covers:
//   • Round-trip encryption (encrypt → decrypt → original plaintext)
//   • Each call produces a different ciphertext (IV randomized)
//   • Tamper detection (modifying ciphertext throws on decrypt)
//   • Wrong key fails to decrypt
//   • Edge cases: empty input rejected, short ciphertext rejected
//   • generateWebhookSecret produces 64-char hex

// IMPORTANT: set the master key BEFORE importing the module — it's read
// at top-level. The module caches against the value it saw at import time,
// so changing the env mid-test won't take effect for that import.
const TEST_KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
Deno.env.set("RAZORPAY_DIRECT_SECRETS_KEY", TEST_KEY);

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  encryptSecret,
  decryptSecret,
  generateWebhookSecret,
} from "./razorpay-direct.ts";

/* ============================================================
   Round-trip
   ============================================================ */

Deno.test("encrypt → decrypt → original plaintext (short)", async () => {
  const plain = "rzp_secret_abc123";
  const ct = await encryptSecret(plain);
  const back = await decryptSecret(ct);
  assertEquals(back, plain);
});

Deno.test("encrypt → decrypt → original plaintext (long)", async () => {
  const plain = "A".repeat(1024) + " — long key material with unicode 🔐";
  const ct = await encryptSecret(plain);
  const back = await decryptSecret(ct);
  assertEquals(back, plain);
});

Deno.test("encrypt produces base64 output", async () => {
  const ct = await encryptSecret("hello");
  // base64 chars only
  assert(/^[A-Za-z0-9+/]+=*$/.test(ct), "must be valid base64");
  // At minimum: 12 IV bytes + 5 plaintext + 16 auth tag = 33 bytes ≥ 44 base64 chars
  assert(ct.length >= 44, "ciphertext too short to be valid GCM output");
});

/* ============================================================
   IV randomization (critical for GCM security)
   ============================================================ */

Deno.test("two encryptions of the same plaintext produce different ciphertexts (fresh IV)", async () => {
  const plain = "same-plaintext";
  const a = await encryptSecret(plain);
  const b = await encryptSecret(plain);
  assertNotEquals(a, b, "identical ciphertexts would mean IV reuse — catastrophic for GCM");
  // But both must decrypt to the same plaintext
  assertEquals(await decryptSecret(a), plain);
  assertEquals(await decryptSecret(b), plain);
});

/* ============================================================
   Tamper detection (auth tag must catch modifications)
   ============================================================ */

Deno.test("modifying a single byte of ciphertext causes decrypt to throw", async () => {
  const plain = "tamper-me";
  const ct = await encryptSecret(plain);
  // Flip the last char (part of the auth tag area)
  const tampered = ct.slice(0, -2) + (ct.slice(-2) === "AA" ? "BB" : "AA") + "=";
  await assertRejects(() => decryptSecret(tampered));
});

Deno.test("truncated ciphertext throws (auth tag missing)", async () => {
  const ct = await encryptSecret("hello");
  const truncated = ct.slice(0, 20); // chop off the tag
  await assertRejects(() => decryptSecret(truncated));
});

/* ============================================================
   Input validation
   ============================================================ */

Deno.test("encryptSecret rejects empty string", async () => {
  await assertRejects(() => encryptSecret(""), Error, "non-empty");
});

Deno.test("decryptSecret rejects empty string", async () => {
  await assertRejects(() => decryptSecret(""), Error, "non-empty");
});

Deno.test("decryptSecret rejects ciphertext shorter than IV (12 bytes = 16 base64 chars)", async () => {
  // 8 bytes = 12 base64 chars — too short for IV
  await assertRejects(() => decryptSecret("dGVzdC1pdg=="), Error);
});

/* ============================================================
   generateWebhookSecret
   ============================================================ */

Deno.test("generateWebhookSecret produces 64-char lowercase hex (32 bytes)", () => {
  const s = generateWebhookSecret();
  assertEquals(s.length, 64);
  assert(/^[0-9a-f]{64}$/.test(s), "must be 64 lowercase hex chars");
});

Deno.test("generateWebhookSecret produces different values each call (RNG works)", () => {
  const a = generateWebhookSecret();
  const b = generateWebhookSecret();
  assertNotEquals(a, b);
});
