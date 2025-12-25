// supabase/functions/rooms/index.ts
// VAiyu – Hotel Rooms API

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, init: ResponseInit = {}) {
    return new Response(JSON.stringify(body, null, 2), {
        headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
            ...(init.headers || {}),
        },
        status: init.status ?? 200,
    });
}

serve(async (req: Request) => {
    // CORS preflight
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    const url = new URL(req.url);
    const { searchParams } = url;
    const hotelId = searchParams.get("hotelId");

    if (req.method !== "GET") {
        return json({ error: "Method not allowed" }, { status: 405 });
    }

    if (!hotelId) {
        return json(
            { error: "Missing required query param 'hotelId'" },
            { status: 400 },
        );
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
    });

    try {
        const { data, error } = await supabase
            .from("rooms")
            .select("*")
            .eq("hotel_id", hotelId)
            .order("floor", { ascending: true })
            .order("number", { ascending: true });

        if (error) {
            console.error("fetch rooms error:", error);
            return json({ error: error.message }, { status: 400 });
        }

        return json({ items: data ?? [] });
    } catch (err) {
        console.error("rooms function error:", err);
        return json(
            { error: "Internal server error", details: String(err) },
            { status: 500 },
        );
    }
});
