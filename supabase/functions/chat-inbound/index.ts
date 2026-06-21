// supabase/functions/chat-inbound/index.ts
//
// Inbound WhatsApp message handler. Two responsibilities (v1):
//   1. Auto-pause active lead drip subscriptions when a lead replies.
//      Looks up the lead by hotel_id + normalised phone, then calls
//      pause_drips_on_lead_reply. Bumps leads.last_activity_at.
//   2. Persist the message to chat_threads / chat_messages (still TODO —
//      pending the chat-threads schema work).
//
// Auth: no JWT — WhatsApp Cloud API uses its own signed callback.
// Hotel routing: caller passes hotelId in the body (Meta routes inbound
// messages per phone_number_id which is hotel-specific).

import { serve as __serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withObs as __withObs } from "../_shared/http-telemetry.ts";
const serve = (h: (req: Request) => Response | Promise<Response>) => __serve(__withObs("chat-inbound", h));
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

interface InboundPayload {
  hotelId?: string;
  guestPhone?: string;
  guestEmail?: string;
  guestName?: string;
  stayCode?: string;
  body?: string;
  provider?: string;
  providerMessageId?: string;
  source?: string;
}

interface LeadMatch {
  lead_id: string;
  status: string;
  source: string;
  contact_name: string;
  last_activity_at: string;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = (await req.json().catch(() => null)) as InboundPayload | null;
  if (!body) {
    return jsonResponse(400, { ok: false, error: "Invalid JSON" });
  }

  const {
    hotelId,
    guestPhone,
    guestEmail,
    body: messageBody,
  } = body;

  if (!hotelId || !messageBody) {
    return jsonResponse(400, {
      ok: false,
      error: "hotelId and body are required",
    });
  }

  // ── 1. Auto-pause active drips for any open lead matching this contact ──
  let dripsPaused = 0;
  let matchedLeadId: string | null = null;

  if (guestPhone || guestEmail) {
    const { data: matches, error: lookupErr } = await supabase.rpc(
      "lookup_lead_by_contact",
      {
        p_hotel_id: hotelId,
        p_phone: guestPhone ?? null,
        p_email: guestEmail ?? null,
      },
    );

    if (lookupErr) {
      console.error("[chat-inbound] lookup_lead_by_contact failed", lookupErr);
    } else {
      const leadRows = (matches as LeadMatch[] | null) ?? [];
      const freshest = leadRows[0]; // RPC orders by last_activity_at DESC
      if (freshest?.lead_id) {
        matchedLeadId = freshest.lead_id;
        const { data: pauseResult, error: pauseErr } = await supabase.rpc(
          "pause_drips_on_lead_reply",
          {
            p_hotel_id: hotelId,
            p_lead_id:  freshest.lead_id,
            p_channel:  "WHATSAPP",
          },
        );
        if (pauseErr) {
          console.error("[chat-inbound] pause_drips_on_lead_reply failed", pauseErr);
        } else {
          dripsPaused = Number((pauseResult as { paused_count?: number } | null)?.paused_count ?? 0);
        }
      }
    }
  }

  // ── 2. TODO: persist to chat_threads / chat_messages ────────────────────
  // Once the chat-threads schema is finalised, write the message row here
  // so the operator UI can render the conversation. For now, the auto-pause
  // is the operator-observable behaviour.

  return jsonResponse(200, {
    ok: true,
    matched_lead_id: matchedLeadId,
    drips_paused: dripsPaused,
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
