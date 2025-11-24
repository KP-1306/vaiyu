// supabase/functions/chat-inbound/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await req.json().catch(() => null);

  // This is the canonical payload you pasted:
  // {
  //   hotelId, guestPhone, guestName, stayCode,
  //   body, provider, providerMessageId, source
  // }

  const {
    hotelId,
    guestPhone,
    guestName,
    stayCode,
    body: messageBody,
    provider,
    providerMessageId,
    source,
  } = body ?? {};

  if (!hotelId || !messageBody) {
    return new Response(
      JSON.stringify({ ok: false, error: "hotelId and body are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // TODO: find/create chat_threads row + ticket, then insert chat_messages row
  // using the tables we just created.

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
