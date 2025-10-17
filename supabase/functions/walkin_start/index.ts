import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function b64(buf: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

serve(async (req) => {
  try {
    const { hotel_code } = await req.json();
    if (!hotel_code) throw new Error("Missing hotel_code");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const WALKIN_SECRET = Deno.env.get("WALKIN_SECRET")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const { data: hotel, error } = await supabase
      .from("hotels")
      .select("id,slug,walkin_code")
      .eq("walkin_code", hotel_code.toUpperCase())
      .single();
    if (error || !hotel) throw new Error("Invalid code");

    const ts = Math.floor(Date.now() / 1000);
    const payload = `${hotel.slug}.${ts}`;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(WALKIN_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    const token = b64(sig);

    return new Response(
      JSON.stringify({ redirect: `/precheck?hotel=${hotel.slug}&ts=${ts}&token=${encodeURIComponent(token)}` }),
      { headers: { "content-type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 400 });
  }
});
