// supabase/functions/leads-public-capture/index.ts
//
// Public lead-capture endpoint for hotel website enquiry forms.
// NO JWT auth. Rate-limited per IP per hotel. Calls create_lead_public RPC.
//
// Errors return generic INVALID_REQUEST for unknown hotel / disallowed source
// to avoid hotel UUID probing leaks. Per-field validation errors return
// specific codes (INVALID_NAME, INVALID_CONTACT, etc.) since they don't leak.
//
// Origin host is logged into api_hits' `key` field for future audit / abuse
// investigation. CORS allows any origin (hotels embed from their own domains).

import {
  CORS_HEADERS,
  json,
  preflight,
  rateLimitOrThrow,
  supabaseAnon,
} from "../_shared/auth.ts";

interface PublicCaptureBody {
  hotel_id?: string;
  source?: "WEBSITE" | "OTHER";
  contact_name?: string;
  contact_phone?: string;
  contact_email?: string;
  check_in?: string;
  check_out?: string;
  party_adults?: number;
  party_children?: number;
  room_count?: number;
  notes?: string;
  source_detail?: string;
}

const RATE_LIMIT_PER_MIN = 5; // 5/min = 300/hr — generous for real form usage; blocks bots
const ALLOWED_SOURCES = new Set(["WEBSITE", "OTHER"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json(405, { ok: false, code: "METHOD_NOT_ALLOWED" });

  // Anonymous client — RPC is SECURITY DEFINER and granted to anon
  const svc = supabaseAnon(req);

  // Parse + basic shape check
  let body: PublicCaptureBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, code: "INVALID_REQUEST", detail: "malformed_json" });
  }

  const {
    hotel_id,
    source = "WEBSITE",
    contact_name,
    contact_phone,
    contact_email,
    check_in,
    check_out,
    party_adults,
    party_children,
    room_count,
    notes,
    source_detail,
  } = body;

  if (!hotel_id || typeof hotel_id !== "string") {
    return json(400, { ok: false, code: "INVALID_REQUEST", detail: "hotel_id_missing" });
  }
  if (!ALLOWED_SOURCES.has(source)) {
    return json(400, { ok: false, code: "INVALID_REQUEST", detail: "source_not_allowed" });
  }

  // Rate limit — scoped per hotel + IP. Key includes the origin for audit.
  const origin = req.headers.get("origin") ?? "no-origin";
  const rateLimitKey = `lead-public:${hotel_id}:${origin}`;
  try {
    await rateLimitOrThrow(svc, req, rateLimitKey, RATE_LIMIT_PER_MIN);
  } catch (e) {
    console.warn("[leads-public-capture] rate-limited", { hotel_id, origin });
    return json(429, {
      ok: false,
      code: "RATE_LIMITED",
      message: (e as Error).message,
    });
  }

  // Call RPC
  const start = performance.now();
  const { data, error } = await svc.rpc("create_lead_public", {
    p_hotel_id: hotel_id,
    p_source: source,
    p_contact_name: contact_name ?? "",
    p_contact_phone: contact_phone ?? null,
    p_contact_email: contact_email ?? null,
    p_check_in: check_in ?? null,
    p_check_out: check_out ?? null,
    p_party_adults: typeof party_adults === "number" ? party_adults : 1,
    p_party_children: typeof party_children === "number" ? party_children : 0,
    p_room_count: typeof room_count === "number" ? room_count : 1,
    p_notes: notes ?? null,
    p_source_detail: source_detail ?? null,
  });

  const duration_ms = Math.round(performance.now() - start);

  if (error) {
    // Parse RPC error → user-friendly response
    const msg = error.message ?? "";
    const codeMatch = msg.match(/^([A-Z][A-Z0-9_]*)/);
    const code = codeMatch?.[1] ?? "UNKNOWN_ERROR";
    console.warn("[leads-public-capture] rpc error", {
      hotel_id,
      origin,
      code,
      duration_ms,
    });
    return json(400, { ok: false, code });
  }

  console.log("[leads-public-capture] ok", {
    hotel_id,
    origin,
    lead_id: data?.lead_id,
    possible_duplicate: data?.possible_duplicate,
    duration_ms,
  });

  return new Response(
    JSON.stringify({
      ok: true,
      lead_id: data?.lead_id,
      possible_duplicate: data?.possible_duplicate ?? false,
    }),
    { status: 200, headers: CORS_HEADERS },
  );
});
