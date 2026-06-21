// supabase/functions/razorpay-direct-clear-credentials/index.ts
//
// POST: clears a hotel's DIRECT-mode credentials and flips razorpay_mode
// back to 'NONE'. Used when a hotel wants to disconnect their Razorpay
// account (e.g. they're switching to ROUTE once the platform's Route is
// activated, or they want to revoke vaiyu's access after key rotation).
//
// Does NOT delete any payments / refunds — those rows stay tagged with
// razorpay_mode='DIRECT' so refunds against historical payments can still
// be processed.
//
// Inputs (JSON): { hotel_id: uuid }
// Outputs (200): { ok: true }
// Auth: user JWT, finance-manager role on the hotel.

import { serve as __serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withObs as __withObs } from "../_shared/http-telemetry.ts";
const serve = (h: (req: Request) => Response | Promise<Response>) => __serve(__withObs("razorpay-direct-clear-credentials", h));
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
import { logError, logInfo } from "../_shared/observability.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const authed = await assertAuthed(req);
  if (authed instanceof Response) return authed;
  const { user } = authed;

  let body: { hotel_id?: string };
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }
  if (!body.hotel_id) return json(400, { error: "hotel_id required" });

  const svc = supabaseService();

  const sbAnon = supabaseAnon(req);
  const { data: canAuthorize, error: rbacErr } = await sbAnon.rpc(
    "vaiyu_is_hotel_finance_manager",
    { p_hotel_id: body.hotel_id },
  );
  if (rbacErr) return json(500, { error: "Authorization check failed" });
  if (canAuthorize !== true) {
    return json(403, { error: "Forbidden: finance manager role required" });
  }

  const limit = await rateLimitForUser(svc, user.id, "razorpay-direct-clear-credentials", 10);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSec);

  // Wipe credentials AND flip mode back to NONE. We deliberately don't
  // touch razorpay_account_id / razorpay_platform_fee_pct so a hotel that
  // was previously on ROUTE keeps that configuration in place.
  const { error: updErr } = await svc
    .from("hotels")
    .update({
      razorpay_mode: "NONE",
      razorpay_direct_key_id: null,
      razorpay_direct_key_secret_enc: null,
      razorpay_direct_webhook_secret_enc: null,
    })
    .eq("id", body.hotel_id);
  if (updErr) {
    logError("razorpay-direct-clear-credentials.update_failed", updErr, { hotel_id: body.hotel_id });
    return json(500, { error: "Could not clear credentials" });
  }

  logInfo("razorpay-direct-clear-credentials.success", "DIRECT credentials cleared", {
    hotel_id: body.hotel_id,
    actor: user.id,
  });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS_HEADERS });
});
