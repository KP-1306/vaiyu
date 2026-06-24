import { withObs as __withObs } from "../_shared/http-telemetry.ts";
const __serveObs = (h: (req: Request) => Response | Promise<Response>) => Deno.serve(__withObs("resend-webhook", h));
// supabase/functions/resend-webhook/index.ts
//
// Receives Resend webhook events (email.sent / email.delivered / email.bounced
// / email.complained / email.opened / email.clicked). Verified via Svix
// signature using RESEND_WEBHOOK_SECRET.
//
// Side effects:
//   • email.bounced or email.complained → calls mark_notification_bounced
//     RPC which marks notification_queue.status='failed' AND auto-pauses
//     the linked drip subscription (if any) with paused_reason='BOUNCED'.
//   • email.delivered → no DB write (already 'sent' from send-notifications);
//     logged for observability.
//
// Setup:
//   • Configure Resend dashboard → Webhooks → add this function's URL
//   • Set the signing secret as RESEND_WEBHOOK_SECRET in Supabase env

import { createClient } from "npm:@supabase/supabase-js@2";
import { Webhook } from "npm:svix@1.40.0";
import { secretKey } from "../_shared/keys.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = secretKey();
const WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "";

interface ResendEvent {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    subject?: string;
    bounce?: { type?: string; subType?: string; message?: string };
    complaint?: { feedback?: string };
  };
}

__serveObs(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }
  if (req.method !== "POST") {
    return json(405, { ok: false, code: "METHOD_NOT_ALLOWED" });
  }

  if (!WEBHOOK_SECRET) {
    console.error("[resend-webhook] RESEND_WEBHOOK_SECRET not set");
    return json(500, { ok: false, code: "WEBHOOK_NOT_CONFIGURED" });
  }

  // ── Verify Svix signature ─────────────────────────────────────────────
  const svixId        = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return json(400, { ok: false, code: "MISSING_SIGNATURE_HEADERS" });
  }

  const rawBody = await req.text();
  let event: ResendEvent;
  try {
    const wh = new Webhook(WEBHOOK_SECRET);
    event = wh.verify(rawBody, {
      "svix-id":        svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ResendEvent;
  } catch (err) {
    console.error("[resend-webhook] signature verification failed", err);
    return json(401, { ok: false, code: "INVALID_SIGNATURE" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const eventType = event.type;
  const emailId   = event.data?.email_id ?? null;

  console.log(`[resend-webhook] ${eventType} email_id=${emailId}`);

  if (!emailId) {
    return json(200, { ok: true, ignored: true, reason: "no_email_id" });
  }

  try {
    switch (eventType) {
      case "email.bounced": {
        const reason = event.data?.bounce?.type === "transient"
          ? "BOUNCED_TRANSIENT"
          : "BOUNCED_PERMANENT";
        const { data, error } = await supabase.rpc("mark_notification_bounced", {
          p_external_id: emailId,
          p_reason: reason,
        });
        if (error) {
          console.error("[resend-webhook] mark_notification_bounced error", error);
          return json(500, { ok: false, code: "RPC_FAILED", detail: error.message });
        }
        return json(200, { ok: true, action: "marked_bounced", result: data });
      }

      case "email.complained": {
        const { data, error } = await supabase.rpc("mark_notification_bounced", {
          p_external_id: emailId,
          p_reason: "COMPLAINT",
        });
        if (error) {
          console.error("[resend-webhook] mark_notification_bounced (complaint) error", error);
          return json(500, { ok: false, code: "RPC_FAILED", detail: error.message });
        }
        return json(200, { ok: true, action: "marked_complaint", result: data });
      }

      case "email.delivered":
      case "email.sent":
      case "email.opened":
      case "email.clicked":
        // Observability only for v1. Could write to va_audit_logs later if
        // a hotel asks for delivery dashboards.
        return json(200, { ok: true, ignored: true, reason: `informational_${eventType}` });

      default:
        return json(200, { ok: true, ignored: true, reason: `unknown_type_${eventType}` });
    }
  } catch (err) {
    console.error("[resend-webhook] unhandled error", err);
    return json(500, { ok: false, code: "INTERNAL_ERROR" });
  }
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
