// supabase/functions/chat-send/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// WhatsApp Cloud API envs (set them when you wire the provider)
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const WA_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const WA_API_BASE =
  Deno.env.get("WHATSAPP_API_BASE") ??
  "https://graph.facebook.com/v18.0";

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

type SendPayload = {
  threadId: string;
  hotelId: string;
  body: string;
  channel: "whatsapp" | "web";
  senderName?: string;
  senderStaffId?: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405, req);
  }

  let payload: SendPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400, req);
  }

  const { threadId, hotelId, body, channel, senderName, senderStaffId } =
    payload;

  if (!threadId || !hotelId || !body || !channel) {
    return json(
      { ok: false, error: "threadId, hotelId, body and channel are required" },
      400,
      req
    );
  }

  try {
    // 1) Fetch thread (to confirm hotel + get guest phone)
    const { data: thread, error: threadErr } = await supabase
      .from("chat_threads")
      .select("id, hotel_id, guest_phone")
      .eq("id", threadId)
      .maybeSingle();

    if (threadErr || !thread) {
      throw new Error("Thread not found");
    }
    if (thread.hotel_id !== hotelId) {
      throw new Error("Thread does not belong to this hotel");
    }

    let providerMessageId: string | null = null;

    // 2) If channel is WhatsApp, send via WA Cloud (best-effort)
    if (channel === "whatsapp") {
      if (!WA_TOKEN || !WA_PHONE_NUMBER_ID) {
        console.warn(
          "[chat-send] WhatsApp env missing, skipping provider send"
        );
      } else if (!thread.guest_phone) {
        console.warn(
          "[chat-send] Thread has no guest_phone, cannot send WhatsApp"
        );
      } else {
        const waRes = await sendWhatsAppMessage({
          to: thread.guest_phone,
          body,
        });
        providerMessageId = waRes?.id ?? null;
      }
    }

    // 3) Insert outbound chat message
    const { data: msg, error: msgErr } = await supabase
      .from("chat_messages")
      .insert({
        thread_id: threadId,
        hotel_id: hotelId,
        direction: "outbound",
        channel,
        sender_role: "staff",
        sender_name: senderName || null,
        body,
        wa_message_id: providerMessageId,
      })
      .select("id")
      .single();

    if (msgErr) throw msgErr;

    // 4) Update thread preview
    const preview = body.length > 120 ? body.slice(0, 117) + "…" : body;
    const { error: updErr } = await supabase
      .from("chat_threads")
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: preview,
      })
      .eq("id", threadId);

    if (updErr) console.error("[chat-send] failed to update thread", updErr);

    return json(
      {
        ok: true,
        messageId: msg?.id ?? null,
        providerMessageId,
      },
      200,
      req
    );
  } catch (err) {
    console.error("[chat-send] error", err);
    return json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      500,
      req
    );
  }
});

async function sendWhatsAppMessage(args: { to: string; body: string }) {
  const { to, body } = args;
  try {
    const url = `${WA_API_BASE}/${WA_PHONE_NUMBER_ID}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[chat-send] WhatsApp error", res.status, text);
      return null;
    }

    const json = await res.json();
    // Typical WA response shape: { messages: [{ id: "wamid..." }] }
    const msgId = json?.messages?.[0]?.id ?? null;
    return { id: msgId };
  } catch (err) {
    console.error("[chat-send] WhatsApp fetch error", err);
    return null;
  }
}

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

function json(body: unknown, status: number, req: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(req),
    },
  });
}
