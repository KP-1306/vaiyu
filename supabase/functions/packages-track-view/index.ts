// supabase/functions/packages-track-view/index.ts
//
// Anon-callable view tracker for the public package landing page.
// Rate-limited per IP+package (1/min dedup so a guest refreshing doesn't
// double-count). Raw IP is NEVER stored — only sha256(ip + daily_salt).
//
// The `record_package_view` RPC silently no-ops for non-ACTIVE packages,
// so this function can't be used to probe whether a draft exists.

import {
  CORS_HEADERS,
  json,
  preflight,
  rateLimitOrThrow,
  supabaseAnon,
} from "../_shared/auth.ts";

interface Body {
  package_id?: string;
  source?: string;
  referrer?: string;
}

const RATE_LIMIT_PER_MIN = 1; // 1 view per IP per package per minute (dedup)
const HASH_SALT_ENV = "PACKAGE_VIEW_IP_SALT";

// Resolve the IP-hash salt. Prefer an explicitly configured salt; otherwise
// derive a stable, secret salt from the service-role key (always injected into
// the Edge Function env). This guarantees we never silently fall back to a
// guessable shared default — the hash is always keyed on something secret and
// stable per deployment, even if PACKAGE_VIEW_IP_SALT was never set.
function resolveSalt(): string {
  const explicit = Deno.env.get(HASH_SALT_ENV);
  if (explicit && explicit.trim().length >= 16) return explicit.trim();
  const serviceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE") ??
    "";
  // Namespaced so the derived salt can't collide with other uses of the key.
  return `pkgview:${serviceKey}`;
}

const IP_HASH_SALT = resolveSalt();

function classifyUa(ua: string | null | undefined): string {
  if (!ua) return "unknown";
  const lower = ua.toLowerCase();
  if (/bot|crawler|spider|crawling|preview/.test(lower)) return "bot";
  if (/mobile/.test(lower) && !/tablet|ipad/.test(lower)) return "mobile";
  if (/tablet|ipad/.test(lower)) return "tablet";
  return "desktop";
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function todayUtcStr(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json(405, { ok: false, code: "METHOD_NOT_ALLOWED" });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, code: "INVALID_REQUEST", detail: "malformed_json" });
  }

  const packageId = body.package_id;
  if (!packageId || typeof packageId !== "string") {
    return json(400, { ok: false, code: "INVALID_REQUEST", detail: "package_id_missing" });
  }

  const svc = supabaseAnon(req);

  // Dedup per IP+package per minute. Returns silently on dedup hit so the
  // client doesn't learn anything either way.
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    (req as Request & { cf?: { connectingIP?: string } }).cf?.connectingIP ||
    "0.0.0.0";

  try {
    await rateLimitOrThrow(svc, req, `package-view:${packageId}`, RATE_LIMIT_PER_MIN);
  } catch {
    // Dedup hit — return 200 silently. Client doesn't need to know.
    return json(200, { ok: true, deduped: true });
  }

  // Compute privacy-preserving hash. Daily date rotates the hash so the same
  // visitor doesn't have a stable identifier across days; the secret salt
  // (see resolveSalt) prevents reversing the hash from a known IP.
  const ipHash = await sha256Hex(`${ip}|${IP_HASH_SALT}|${todayUtcStr()}`);

  const ua = req.headers.get("user-agent");
  const uaClass = classifyUa(ua);

  const referrer = (body.referrer || req.headers.get("referer") || "").slice(0, 500) || null;
  const source = (body.source || "").slice(0, 40) || null;

  const { error } = await svc.rpc("record_package_view", {
    p_package_id: packageId,
    p_source: source,
    p_referrer: referrer,
    p_ip_hash: ipHash,
    p_ua_class: uaClass,
  });
  if (error) {
    // Best-effort — never block the client if analytics fails.
    console.warn("[packages-track-view] rpc error", error);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: CORS_HEADERS,
  });
});
