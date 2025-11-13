// supabase/functions/whatsapp/index.ts
// VAiyu – WhatsApp → Hotel Menu v1 (view-only)
//
// Responsibilities:
// - GET  (Meta verification): ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
// - POST (incoming messages): parse "MENU <slug> [ROOM <room>]" and reply with that hotel's menu.
//
// DB used:
// - hotels: id, slug, name, wa_phone_number_id
// - menu_items: hotel_id, item_key, name, base_price, active
//
// NOTE: This uses the SERVICE ROLE key because this webhook has no user JWT.
// Keep the endpoint URL secret; Meta will call it directly.

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN")!;
const WHATSAPP_VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN")!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !WHATSAPP_TOKEN || !WHATSAPP_VERIFY_TOKEN) {
  console.error("[whatsapp] Missing required environment variables");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------- Helpers ----------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

type MenuItem = {
  item_key: string | null;
  name: string;
  base_price: number | null;
};

type HotelRow = {
  id: string;
  slug: string;
  name: string;
};

// Parse "MENU <slug> [ROOM <room>]" or just "MENU"
function parseMenuCommand(rawBody: string): {
  ok: boolean;
  error?: string;
  hotelSlug?: string;
  roomCode?: string;
} {
  const normalized = rawBody.trim().toUpperCase().replace(/\s+/g, " ");
  const tokens = normalized.split(" ");
  if (!tokens.length) {
    return { ok: false, error: "Empty message" };
  }

  if (tokens[0] !== "MENU") {
    return { ok: false, error: "Not a MENU command" };
  }

  if (tokens.length === 1) {
    // Just "MENU" → slug missing (we'll try phone_number_id mapping)
    return { ok: true };
  }

  const hotelSlug = tokens[1]; // second token
  let roomCode: string | undefined;

  const roomIdx = tokens.indexOf("ROOM");
  if (roomIdx > 1 && roomIdx < tokens.length - 1) {
    roomCode = tokens.slice(roomIdx + 1).join(" ");
  }

  return { ok: true, hotelSlug, roomCode };
}

async function sendWhatsAppText(args: {
  to: string;
  phoneNumberId: string;
  body: string;
}): Promise<void> {
  const { to, phoneNumberId, body } = args;

  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    text: {
      body,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[whatsapp] Error sending message:", res.status, text);
  }
}

// Fetch hotel by slug OR by phone_number_id (if slug absent)
async function resolveHotel(opts: {
  hotelSlug?: string;
  phoneNumberId: string;
}): Promise<HotelRow | null> {
  const { hotelSlug, phoneNumberId } = opts;

  if (hotelSlug) {
    const { data, error } = await supabase
      .from("hotels")
      .select("id, slug, name")
      .eq("slug", hotelSlug)
      .single();

    if (error) {
      console.error("[whatsapp] hotel lookup by slug failed:", error);
      return null;
    }
    return data as HotelRow;
  }

  // Fallback: map phone_number_id -> hotel (if only one)
  const { data, error } = await supabase
    .from("hotels")
    .select("id, slug, name")
    .eq("wa_phone_number_id", phoneNumberId)
    .limit(2);

  if (error) {
    console.error("[whatsapp] hotel lookup by phone_number_id failed:", error);
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  if (data.length > 1) {
    console.warn(
      "[whatsapp] Multiple hotels share the same wa_phone_number_id; cannot auto-resolve",
    );
    return null;
  }

  return data[0] as HotelRow;
}

// Fetch menu items for a hotel (simple v1: flat list, ordered by item_key)
async function fetchMenuItems(hotelId: string): Promise<MenuItem[]> {
  const { data, error } = await supabase
    .from("menu_items")
    .select("item_key, name, base_price")
    .eq("hotel_id", hotelId)
    .eq("active", true)
    .order("item_key", { ascending: true });

  if (error) {
    console.error("[whatsapp] menu_items query failed:", error);
    return [];
  }

  return (data ?? []) as MenuItem[];
}

// Format menu items into 1–2 WhatsApp-safe text chunks
function formatMenuText(
  hotel: HotelRow,
  roomCode: string | undefined,
  items: MenuItem[],
): string[] {
  if (!items.length) {
    const header = `VAiyu Menu\n\n🏨 ${hotel.name}\n${
      roomCode ? `🏠 Room ${roomCode}\n` : ""
    }\nWe don’t have any items published yet. Please contact the front desk for assistance.`;
    return [header];
  }

  const headerLines = [
    "VAiyu Menu",
    "",
    `🏨 ${hotel.name}`,
  ];
  if (roomCode) headerLines.push(`🏠 Room ${roomCode}`);
  headerLines.push("");
  headerLines.push("Here is your current menu:");
  headerLines.push("");

  const itemLines = items.map((it) => {
    const code = it.item_key ?? "";
    const price = it.base_price != null ? ` – ₹${it.base_price}` : "";
    return `${code ? code + ". " : ""}${it.name}${price}`;
  });

  const footerLines = [
    "",
    "📝 This is a view-only menu in v1.",
    "Please call Reception or use in-room options to place your order.",
  ];

  const allLines = [...headerLines, ...itemLines, ...footerLines];
  const fullText = allLines.join("\n");

  // WhatsApp text limit is ~4096 chars. Split if needed.
  if (fullText.length <= 3800) {
    return [fullText];
  }

  // Simple split: header + first half of items, then rest + footer
  const mid = Math.ceil(itemLines.length / 2);
  const part1 = [...headerLines, ...itemLines.slice(0, mid)].join("\n");
  const part2 = [
    ...itemLines.slice(mid),
    "",
    ...footerLines,
  ].join("\n");

  return [part1, part2];
}

// ---------- Main handler ----------

serve(async (req: Request) => {
  const url = new URL(req.url);

  // 1) Meta webhook verification (GET)
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN && challenge) {
      console.log("[whatsapp] Webhook verified");
      return new Response(challenge, { status: 200 });
    }

    console.warn("[whatsapp] Webhook verification failed");
    return new Response("Forbidden", { status: 403 });
  }

  // 2) Incoming messages (POST)
  if (req.method === "POST") {
    let payload: any;
    try {
      payload = await req.json();
    } catch (e) {
      console.error("[whatsapp] Failed to parse JSON:", e);
      return json({ status: "ignored", reason: "invalid_json" }, 400);
    }

    try {
      const entry = payload?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const messages = value?.messages;
      const metadata = value?.metadata;

      if (!messages || !messages.length || !metadata) {
        return json({ status: "ignored", reason: "no_messages" }, 200);
      }

      const msg = messages[0];
      const from = msg.from as string;
      const type = msg.type as string;
      const phoneNumberId = metadata.phone_number_id as string;

      if (type !== "text" || !msg.text?.body) {
        // For v1 we only handle text messages
        return json({ status: "ignored", reason: "non_text_message" }, 200);
      }

      const body: string = msg.text.body;
      const parsed = parseMenuCommand(body);

      if (!parsed.ok) {
        // Not a MENU command → optional generic reply or ignore
        // For v1, we send a simple hint.
        await sendWhatsAppText({
          to: from,
          phoneNumberId,
          body:
            "Hi 👋\nTo open your hotel’s menu, please type:\n\nMENU <hotel-code>\n\nExample:\nMENU HILTON-MG-ROAD",
        });
        return json({ status: "ok", reason: "hint_sent" }, 200);
      }

      // Resolve hotel (slug or phone_number_id)
      const hotel = await resolveHotel({
        hotelSlug: parsed.hotelSlug,
        phoneNumberId,
      });

      if (!hotel) {
        await sendWhatsAppText({
          to: from,
          phoneNumberId,
          body:
            "We couldn’t find your hotel.\n\nPlease check your QR and try again with:\nMENU <hotel-code>\n\nExample:\nMENU HILTON-MG-ROAD",
        });
        return json({ status: "ok", reason: "hotel_not_found" }, 200);
      }

      const items = await fetchMenuItems(hotel.id);
      const chunks = formatMenuText(hotel, parsed.roomCode, items);

      for (const chunk of chunks) {
        await sendWhatsAppText({
          to: from,
          phoneNumberId,
          body: chunk,
        });
      }

      return json({ status: "ok" }, 200);
    } catch (err) {
      console.error("[whatsapp] Handler error:", err);
      return json({ status: "error", error: String(err) }, 500);
    }
  }

  return new Response("Not found", { status: 404 });
});
