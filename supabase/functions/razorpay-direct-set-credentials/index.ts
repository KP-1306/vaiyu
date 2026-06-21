// supabase/functions/razorpay-direct-set-credentials/index.ts
//
// POST: stores a hotel's own Razorpay credentials (DIRECT mode) and
// flips razorpay_mode → 'DIRECT'.
//
// Why this exists: Razorpay Route requires turnover proof we don't have
// yet, so each hotel uses their OWN Razorpay account (basic KYC). Funds
// settle straight to the hotel's bank; vaiyu never touches the money.
//
// Inputs (JSON):
//   {
//     hotel_id: uuid,
//     key_id:    "rzp_test_..." | "rzp_live_...",
//     key_secret: string,        // sent over HTTPS, encrypted before storage
//   }
//
// Outputs (200):
//   {
//     ok: true,
//     mode: "test" | "live",
//     webhook_secret: string,    // SHOWN ONCE — hotel pastes into Razorpay dashboard
//     webhook_url: string,       // the URL hotel registers in Razorpay dashboard
//     subscribed_events: string[],
//   }
//
// Auth: user JWT, finance-manager role on the hotel.

import { serve as __serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withObs as __withObs } from "../_shared/http-telemetry.ts";
const serve = (h: (req: Request) => Response | Promise<Response>) => __serve(__withObs("razorpay-direct-set-credentials", h));
import {
  CORS_HEADERS,
  json,
  preflight,
  assertAuthed,
  supabaseAnon,
  supabaseService,
  rateLimitForUser,
  tooManyRequests,
} from "../_shared/auth.ts";
import {
  razorpayBasicAuth,
  RAZORPAY_API_BASE,
} from "../_shared/razorpay.ts";
import {
  encryptSecret,
  decryptSecret,
  generateWebhookSecret,
} from "../_shared/razorpay-direct.ts";
import { logError, logInfo } from "../_shared/observability.ts";

const KEY_ID_REGEX = /^rzp_(test|live)_[A-Za-z0-9]+$/;

const SUBSCRIBED_EVENTS = [
  "payment.captured",
  "payment.failed",
  "order.paid",
  "refund.created",
  "refund.processed",
  "refund.failed",
];

type Body = {
  hotel_id?: string;
  key_id?: string;
  key_secret?: string;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // 1. Auth
  const authed = await assertAuthed(req);
  if (authed instanceof Response) return authed;
  const { user } = authed;

  // 2. Body
  let body: Body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }
  if (!body.hotel_id) return json(400, { error: "hotel_id required" });
  if (!body.key_id || !body.key_secret) {
    return json(400, { error: "key_id and key_secret required" });
  }
  if (!KEY_ID_REGEX.test(body.key_id)) {
    return json(400, {
      error: "key_id must look like rzp_test_xxx or rzp_live_xxx",
      code: "INVALID_KEY_ID_FORMAT",
    });
  }

  const svc = supabaseService();

  // 3. RBAC
  const sbAnon = supabaseAnon(req);
  const { data: canAuthorize, error: rbacErr } = await sbAnon.rpc(
    "vaiyu_is_hotel_finance_manager",
    { p_hotel_id: body.hotel_id },
  );
  if (rbacErr) return json(500, { error: "Authorization check failed" });
  if (canAuthorize !== true) {
    return json(403, { error: "Forbidden: finance manager role required" });
  }

  // 3a. Rate limit — credential setup is rare. 10/min user-keyed is plenty.
  const limit = await rateLimitForUser(svc, user.id, "razorpay-direct-set-credentials", 10);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSec);

  // 4. Verify the credentials actually work by calling Razorpay. This
  //    catches typos before we store the encrypted secret. GET /payments?count=1
  //    is the cheapest authenticated call available.
  let testRes: Response;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    testRes = await fetch(`${RAZORPAY_API_BASE}/payments?count=1`, {
      method: "GET",
      headers: {
        Authorization: razorpayBasicAuth(body.key_id, body.key_secret),
      },
      signal: ctrl.signal,
    });
    clearTimeout(t);
  } catch (e) {
    logError("razorpay-direct-set-credentials.network", e, { hotel_id: body.hotel_id });
    return json(504, {
      error: "Could not reach Razorpay to verify credentials. Try again.",
      code: "RAZORPAY_TIMEOUT",
    });
  }

  if (testRes.status === 401) {
    return json(401, {
      error: "Razorpay rejected these credentials. Double-check key_id and key_secret.",
      code: "INVALID_CREDENTIALS",
    });
  }
  if (!testRes.ok) {
    const txt = await testRes.text().catch(() => "");
    logError("razorpay-direct-set-credentials.verify_failed", new Error(`Razorpay returned ${testRes.status}`), {
      hotel_id: body.hotel_id,
      status: testRes.status,
      response: txt.slice(0, 500),
    });
    return json(502, {
      error: `Razorpay returned ${testRes.status} during credential check.`,
      code: "VERIFY_REJECTED",
    });
  }

  // 5. Preserve existing webhook secret across re-saves.
  //    If the hotel already has a webhook_secret stored (i.e. they've
  //    previously configured Razorpay's dashboard with it), we must NOT
  //    rotate it on every save — that would silently break webhook
  //    delivery whenever the hotel rotates their Razorpay key_secret.
  //    Generate fresh ONLY on first-ever save.
  const { data: existing, error: lookupErr } = await svc
    .from("hotels")
    .select("razorpay_direct_webhook_secret_enc")
    .eq("id", body.hotel_id)
    .maybeSingle();
  if (lookupErr) {
    logError("razorpay-direct-set-credentials.lookup_failed", lookupErr, { hotel_id: body.hotel_id });
    return json(500, { error: "Could not read existing credentials" });
  }

  let webhookSecret: string;
  let webhookSecretEnc: string;
  let keySecretEnc: string;
  try {
    keySecretEnc = await encryptSecret(body.key_secret);
    if (existing?.razorpay_direct_webhook_secret_enc) {
      // Reuse existing — decrypt for the UI response, keep ciphertext in DB.
      webhookSecret = await decryptSecret(existing.razorpay_direct_webhook_secret_enc);
      webhookSecretEnc = existing.razorpay_direct_webhook_secret_enc;
    } else {
      // First time — generate and store.
      webhookSecret = generateWebhookSecret();
      webhookSecretEnc = await encryptSecret(webhookSecret);
    }
  } catch (e) {
    logError("razorpay-direct-set-credentials.encrypt_failed", e, { hotel_id: body.hotel_id });
    return json(500, {
      error: "Encryption layer not configured. Contact support.",
      code: "ENCRYPTION_UNAVAILABLE",
    });
  }

  // 6. Persist — single UPDATE flips mode + writes ciphertext atomically.
  const { error: updErr } = await svc
    .from("hotels")
    .update({
      razorpay_mode: "DIRECT",
      razorpay_direct_key_id: body.key_id,
      razorpay_direct_key_secret_enc: keySecretEnc,
      razorpay_direct_webhook_secret_enc: webhookSecretEnc,
    })
    .eq("id", body.hotel_id);
  if (updErr) {
    logError("razorpay-direct-set-credentials.update_failed", updErr, { hotel_id: body.hotel_id });
    return json(500, { error: "Could not save credentials" });
  }

  // 7. Build the webhook URL the hotel needs to paste into Razorpay dashboard.
  //    SUPABASE_URL is the project URL; for prod it's https://<ref>.supabase.co.
  //    For local Docker dev, the value is `http://kong:8000` (internal Docker
  //    hostname) — substitute with 127.0.0.1:54321 so the displayed URL at
  //    least *looks* valid (Razorpay still can't reach localhost from public
  //    internet, but the substitution makes it clear it's a local URL and
  //    avoids the confusing "no such host: kong" error in the UI).
  const rawUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const projectUrl = rawUrl.replace(/^https?:\/\/kong:8000/, "http://127.0.0.1:54321");
  const webhookUrl = `${projectUrl.replace(/\/$/, "")}/functions/v1/razorpay-direct-webhook`;

  const mode = body.key_id.startsWith("rzp_live_") ? "live" : "test";

  logInfo("razorpay-direct-set-credentials.success", "DIRECT credentials saved", {
    hotel_id: body.hotel_id,
    actor: user.id,
    mode,
    key_id: body.key_id,
  });

  return new Response(
    JSON.stringify({
      ok: true,
      mode,
      webhook_secret: webhookSecret,
      webhook_url: webhookUrl,
      subscribed_events: SUBSCRIBED_EVENTS,
    }),
    { status: 200, headers: CORS_HEADERS },
  );
});
