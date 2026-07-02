// supabase/functions/site-publish/index.ts
//
// POST /site-publish   body: { hotel_id, action: "publish" | "unpublish" | "preview" }
//
// The backend of the site editor's Publish button.
//  - authz: caller must be a hotel MANAGER (owner/manager tier) or a platform admin
//    (same gate as hotel_sites write RLS).
//  - preview:   assemble the payload from live data and return it (no store).
//  - publish:   gate-check (ACTIVE + tagline + about + a hero photo) → assemble a
//               snapshot into hotel_sites.published_payload + status=PUBLISHED →
//               fire the Netlify build hook so the static site regenerates.
//  - unpublish: status → DRAFT (drops it from the published set) → rebuild.
//
// The publish snapshot decouples the live site from ongoing draft edits: the
// generator renders published_payload only.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  assertAuthed,
  supabaseAnon,
  supabaseService,
  json,
  ok,
  preflight,
} from "../_shared/auth.ts";
import { assembleSitePayload } from "../_shared/assembleSitePayload.mjs";

const SITE_BASE = Deno.env.get("SITE_BASE") || "https://vaiyu.co.in";
const BUILD_HOOK = Deno.env.get("NETLIFY_BUILD_HOOK_URL") || "";

async function fireBuildHook(): Promise<boolean> {
  if (!BUILD_HOOK) return false;
  try {
    await fetch(BUILD_HOOK, { method: "POST" });
    return true;
  } catch (e) {
    console.error("[site-publish] build hook failed:", e);
    return false;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  const authed = await assertAuthed(req);
  if (authed instanceof Response) return authed;
  const userId = authed.user.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }
  const hotelId = String(body?.hotel_id ?? "");
  const action = String(body?.action ?? "publish");
  if (!hotelId) return json(400, { ok: false, error: "hotel_id_required" });
  if (!["publish", "unpublish", "preview"].includes(action)) {
    return json(400, { ok: false, error: "invalid_action" });
  }

  // ── authz: platform admin OR hotel manager (RLS-equivalent, via caller JWT) ──
  const anon = supabaseAnon(req);
  const [mgrRes, adminRes] = await Promise.all([
    anon.rpc("vaiyu_is_hotel_manager", { p_hotel_id: hotelId }),
    anon.rpc("is_platform_admin"),
  ]);
  if (mgrRes.error) return json(500, { ok: false, error: mgrRes.error.message });
  if (adminRes.error) return json(500, { ok: false, error: adminRes.error.message });
  if (mgrRes.data !== true && adminRes.data !== true) {
    return json(403, { ok: false, error: "forbidden" });
  }

  const svc = supabaseService();

  // ── preview: assemble live, do not store ─────────────────────────────────────
  if (action === "preview") {
    try {
      const payload = await assembleSitePayload(svc, hotelId, { siteBase: SITE_BASE });
      return ok({ ok: true, action: "preview", payload });
    } catch (e) {
      return json(500, { ok: false, error: String((e as Error)?.message ?? e) });
    }
  }

  const { data: hotel, error: hErr } = await svc
    .from("hotels")
    .select("slug,lifecycle_status")
    .eq("id", hotelId)
    .maybeSingle();
  if (hErr) return json(500, { ok: false, error: hErr.message });
  if (!hotel) return json(404, { ok: false, error: "hotel_not_found" });

  // ── unpublish: drop from the published set ───────────────────────────────────
  if (action === "unpublish") {
    const { error } = await svc.from("hotel_sites").update({ status: "DRAFT" }).eq("hotel_id", hotelId);
    if (error) return json(500, { ok: false, error: error.message });
    const rebuild = await fireBuildHook();
    return ok({ ok: true, action: "unpublished", slug: hotel.slug, rebuild });
  }

  // ── publish: gate → snapshot → rebuild ───────────────────────────────────────
  const missing: string[] = [];
  if (hotel.lifecycle_status !== "ACTIVE") missing.push("Hotel must be ACTIVE (finish onboarding first).");

  const { data: site } = await svc
    .from("hotel_sites")
    .select("tagline,about_md")
    .eq("hotel_id", hotelId)
    .maybeSingle();
  if (!String(site?.tagline ?? "").trim()) missing.push("Add a tagline.");
  if (!String(site?.about_md ?? "").trim()) missing.push("Add the About section.");

  let payload;
  try {
    payload = await assembleSitePayload(svc, hotelId, { siteBase: SITE_BASE });
  } catch (e) {
    return json(500, { ok: false, error: String((e as Error)?.message ?? e) });
  }
  if (!payload.hero?.imageUrl) missing.push("Add at least one cover or room photo (needed for the hero).");

  if (missing.length) return json(422, { ok: false, error: "not_ready", missing });

  const { error: upErr } = await svc
    .from("hotel_sites")
    .update({
      status: "PUBLISHED",
      published_payload: payload,
      published_at: new Date().toISOString(),
      published_by: userId,
    })
    .eq("hotel_id", hotelId);
  if (upErr) return json(500, { ok: false, error: upErr.message });

  const rebuild = await fireBuildHook();
  return ok({ ok: true, action: "published", slug: hotel.slug, url: `${SITE_BASE}/${hotel.slug}`, rebuild });
});
