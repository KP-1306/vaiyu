// functions/catalog_menu2/index.ts

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- simple JSON + CORS helper (replaces the old `j` import) ---
function jsonResponse(req: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
    },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY env");
}

// Simple UUID heuristic – good enough for routing
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function looksLikeUuid(value: string | null): value is string {
  return !!value && UUID_RE.test(value);
}

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return jsonResponse(req, 200, { ok: true });
  }

  if (req.method !== "GET") {
    return jsonResponse(req, 405, {
      ok: false,
      error: "Method Not Allowed",
    });
  }

  try {
    const url = new URL(req.url);

    // --- 1. Parse all possible inputs -------------------------------------
    // New style: /functions/v1/catalog_menu2?hotelId=<uuid>
    let hotelId: string | null = url.searchParams.get("hotelId");

    // Back-compat: ?hotel=<uuid|slug>
    const hotelParam = url.searchParams.get("hotel");

    // Slug-style: ?hotelSlug=TENANT1 or ?slug=TENANT1
    let slug: string | null =
      url.searchParams.get("hotelSlug") ?? url.searchParams.get("slug");

    // Optional slug from path:
    // /functions/v1/catalog_menu2/TENANT1  → segments = [..., "catalog_menu2", "TENANT1"]
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const tail = pathSegments[pathSegments.length - 1] ?? null;
    const slugFromPath =
      tail && tail !== "catalog_menu2" && tail !== "v1" ? tail : null;

    // Decide hotelId vs slug from ?hotel=
    if (!hotelId && hotelParam) {
      if (looksLikeUuid(hotelParam)) {
        hotelId = hotelParam;
      } else if (!slug) {
        slug = hotelParam;
      }
    }

    // If no explicit slug yet, use slugFromPath (if present)
    if (!slug && slugFromPath) {
      slug = slugFromPath;
    }

    // Final fallback (mainly for local/demo)
    if (!hotelId && !slug) {
      slug =
        Deno.env.get("VA_TENANT_SLUG")?.trim() ||
        "TENANT1"; // harmless if not present in DB
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // --- 2. If we only have slug, resolve it to hotel_id -------------------
    if (!hotelId && slug) {
      const { data: hotel, error: hErr } = await supabase
        .from("hotels")
        .select("id")
        .eq("slug", slug.trim())
        .maybeSingle();

      if (hErr || !hotel) {
        console.error("catalog_menu2 hotel lookup error:", hErr);
        // Safe empty response for unknown slug
        return jsonResponse(req, 200, { items: [] });
      }

      hotelId = hotel.id as string;
    }

    // If we STILL don't have a hotelId, we can’t serve a menu
    if (!hotelId) {
      return jsonResponse(req, 200, { items: [] });
    }

    // --- 3. Fetch active menu items for that hotel -------------------------
    const { data, error } = await supabase
      .from("menu_items")
      .select("item_key,name,price,base_price,active")
      .eq("hotel_id", hotelId)
      .eq("active", true);

    if (error) {
      console.error("catalog_menu2 menu_items error:", error);
      return jsonResponse(req, 200, { items: [] });
    }

    const items =
      (data ?? []).map((m: any) => ({
        item_key: m.item_key,
        name: m.name,
        // Prefer explicit price if set; else base_price; else null
        price:
          typeof m.price === "number"
            ? m.price
            : typeof m.base_price === "number"
            ? m.base_price
            : null,
        active: m.active,
      })) ?? [];

    return jsonResponse(req, 200, { items });
  } catch (e) {
    console.error("catalog_menu2 fatal error:", e);
    return jsonResponse(req, 500, {
      ok: false,
      error: String(e),
    });
  }
});
