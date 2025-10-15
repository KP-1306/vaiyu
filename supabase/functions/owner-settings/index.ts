// supabase/functions/owner-settings/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { j } from "../_shared/cors.ts";

/* ---------- clients ---------- */
function supabaseAnon(req: Request) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  return createClient(url, anon, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
}
function supabaseService() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

/* ---------- helpers ---------- */
async function requireUser(anon: SupabaseClient) {
  const { data, error } = await anon.auth.getUser();
  if (error || !data?.user) throw new Error("Unauthorized");
  return data.user;
}
async function hotelBySlug(anon: SupabaseClient, slug: string) {
  const { data, error } = await anon.from("hotels").select("id, name, slug").eq("slug", slug).single();
  if (error || !data) throw new Error("Unknown hotel");
  return data;
}
async function requireOwnerOrAdmin(anon: SupabaseClient, hotelId: string, userId: string) {
  const { data } = await anon
    .from("v_user_roles")
    .select("role")
    .eq("hotel_id", hotelId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data || !["owner", "admin"].includes(String(data.role))) throw new Error("Forbidden");
}

async function audit(svc: SupabaseClient, row: {
  action: string; actor?: string | null; hotel_id?: string | null;
  entity?: string | null; entity_id?: string | null; meta?: unknown;
  ip?: string | null; ua?: string | null;
}) {
  await svc.from("va_audit_logs").insert({
    at: new Date().toISOString(),
    action: row.action,
    actor: row.actor ?? null,
    hotel_id: row.hotel_id ?? null,
    entity: row.entity ?? null,
    entity_id: row.entity_id ?? null,
    meta: row.meta ?? null,
    ip: row.ip ?? null,
    ua: row.ua ?? null,
  }).catch(() => {});
}

/* ---------- server ---------- */
serve(async (req) => {
  if (req.method === "OPTIONS") return j(req, 200, { ok: true });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  try {
    const anon = supabaseAnon(req);
    const svc  = supabaseService();

    // Auth
    const user = await requireUser(anon);

    const url = new URL(req.url);
    const slug = (url.searchParams.get("slug") || Deno.env.get("VA_TENANT_SLUG") || "TENANT1").trim();
    const hotel = await hotelBySlug(anon, slug);
    await requireOwnerOrAdmin(anon, hotel.id, user.id);

    if (req.method === "GET") {
      // Hotel basic + services list
      const { data: services, error: sErr } = await anon
        .from("services")
        .select("key, label, sla_minutes, active")
        .eq("hotel_id", hotel.id)
        .order("key", { ascending: true });
      if (sErr) return j(req, 400, { ok: false, error: sErr.message });

      return j(req, 200, {
        ok: true,
        hotel: { id: hotel.id, name: hotel.name, slug: hotel.slug },
        services: services ?? [],
      });
    }

    if (req.method === "POST") {
      // Body: { services: [{key,label?,sla_minutes?,active?}, ...], hotel?: {name?} }
      const body = await req.json().catch(() => ({} as any));

      // (A) optional hotel patch
      if (body?.hotel && typeof body.hotel === "object") {
        const patch: Record<string, unknown> = {};
        if (typeof body.hotel.name === "string" && body.hotel.name.trim().length > 1) {
          patch.name = body.hotel.name.trim();
        }
        if (Object.keys(patch).length > 0) {
          const { error } = await svc.from("hotels").update(patch).eq("id", hotel.id);
          if (error) return j(req, 400, { ok: false, error: error.message });
          await audit(svc, {
            action: "owner.settings.hotel.update",
            actor: user.email ?? user.id,
            hotel_id: hotel.id,
            entity: "hotel",
            entity_id: hotel.id,
            meta: patch, ip, ua,
          });
        }
      }

      // (B) services upsert
      if (Array.isArray(body?.services)) {
        const rows = body.services
          .map((s: any) => ({
            hotel_id: hotel.id,
            key: String(s.key || "").trim(),
            label: typeof s.label === "string" ? s.label.trim() : null,
            sla_minutes: Number.isFinite(Number(s.sla_minutes)) ? Math.max(1, Math.trunc(Number(s.sla_minutes))) : null,
            active: typeof s.active === "boolean" ? s.active : true,
          }))
          .filter((r: any) => r.key.length > 0);

        if (rows.length > 0) {
          // upsert by (hotel_id, key)
          const { error } = await svc.from("services").upsert(rows, {
            onConflict: "hotel_id,key",
            ignoreDuplicates: false,
          });
          if (error) return j(req, 400, { ok: false, error: error.message });

          await audit(svc, {
            action: "owner.settings.services.upsert",
            actor: user.email ?? user.id,
            hotel_id: hotel.id,
            entity: "service",
            entity_id: null,
            meta: { count: rows.length, keys: rows.map((r: any) => r.key) },
            ip, ua,
          });
        }
      }

      return j(req, 200, { ok: true });
    }

    return j(req, 405, { ok: false, error: "Method Not Allowed" });
  } catch (e) {
    const msg = String(e?.message || e);
    const status = /unauthorized/i.test(msg) ? 401 : /forbidden/i.test(msg) ? 403 : /unknown hotel/i.test(msg) ? 400 : 500;
    return j(req, status, { ok: false, error: msg });
  }
});
