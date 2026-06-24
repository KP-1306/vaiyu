// supabase/functions/auto-apply-pricing/index.ts
//
// Scheduled auto-apply runner. Called on a cron (15–60 min) — either via
// pg_cron + pg_net, a GitHub Actions workflow, or Supabase's scheduled
// functions. For every hotel with BOTH auto_apply_enabled=TRUE and
// recommend_only=FALSE, it:
//   1. Computes current occupancy (inhouse + arriving stays / rooms).
//   2. Lists active (non-deleted) pricing rules.
//   3. For the property-wide scope AND each room_type that has rules:
//      a. Reads the current base price from pricing_current_rates.
//      b. Evaluates rules → recommended price + guardrail.
//      c. Calls apply_pricing_change_system to persist, respecting both
//         the max_delta_pct guardrail and the operator's kill-switch.
//
// Engine behavior (DOW / seasonality / lead-time / clamp / guardrail) is
// ported inline so the function is a single self-contained Deno file. Any
// change to pricing logic MUST update both this file and
// web/src/services/pricingEngine.ts — the TS engine is the reference; this
// is its Deno twin.
//
// Auth: invoker sends `Authorization: Bearer <CRON_SECRET>` matching the
// env var AUTO_APPLY_CRON_SECRET. No user JWT is needed. Inside, the
// function uses the SERVICE_ROLE_KEY to call apply_pricing_change_system.

import { serve as __serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { withObs as __withObs } from "../_shared/http-telemetry.ts";
const serve = (h: (req: Request) => Response | Promise<Response>) => __serve(__withObs("auto-apply-pricing", h));
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { secretKey } from "../_shared/keys.ts";
import { allowCors, j } from "../_shared/cors.ts";

// ---------------------------------------------------------------------------
// Types (duplicated from web/src/types/pricing.ts — keep in sync)
// ---------------------------------------------------------------------------

type Dow = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type AdjustmentType = "increase_pct" | "decrease_pct" | "set_fixed_price";
type ClampReason = "min_price" | "max_price" | null;

type Rule = {
  id: string;
  hotel_id: string;
  rule_name: string;
  active: boolean;
  scope_type: "property" | "room_type";
  room_type_id: string | null;
  occupancy_min_pct: number;
  occupancy_max_pct: number | null;
  adjustment_type: AdjustmentType;
  adjustment_value: number;
  min_price: number | null;
  max_price: number | null;
  priority: number;
  applicable_dow: Dow[] | null;
  season_start_mmdd: number | null;
  season_end_mmdd: number | null;
  lead_time_min_days: number | null;
  lead_time_max_days: number | null;
  deleted_at: string | null;
};

type Settings = {
  auto_apply_enabled: boolean;
  recommend_only: boolean;
  max_delta_pct: number | null;
};

type Scope = { room_type_id: string | null; base_price: number };

// ---------------------------------------------------------------------------
// Calendar helpers — timezone-free by construction
// ---------------------------------------------------------------------------

type CalDate = { year: number; month: number; day: number };

function todayIso(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  // Edge runs in UTC. For v1 we're IST-only; hotel-local today ≈ UTC+05:30,
  // which is the same calendar day for all but ~30 min around midnight IST.
  // Good enough for hourly auto-apply; phase 2 will use hotels.timezone.
  return `${y}-${m}-${day}`;
}

function parseIso(s: string): CalDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`bad date: ${s}`);
  return { year: +m[1], month: +m[2], day: +m[3] };
}

function dowOf(d: CalDate): number {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

function mmddOf(d: CalDate): number {
  return d.month * 100 + d.day;
}

function daysBetween(a: CalDate, b: CalDate): number {
  const ms = 24 * 60 * 60 * 1000;
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / ms,
  );
}

function inSeason(stay: number, start: number, end: number): boolean {
  if (start <= end) return stay >= start && stay <= end;
  return stay >= start || stay <= end;
}

function ruleMatchesTime(r: Rule, stay: CalDate, today: CalDate): boolean {
  if (r.applicable_dow && r.applicable_dow.length > 0) {
    const d = dowOf(stay);
    if (!r.applicable_dow.some((v) => v === d)) return false;
  }
  if (r.season_start_mmdd != null && r.season_end_mmdd != null) {
    if (!inSeason(mmddOf(stay), r.season_start_mmdd, r.season_end_mmdd)) return false;
  }
  if (r.lead_time_min_days != null || r.lead_time_max_days != null) {
    const lead = daysBetween(today, stay);
    if (r.lead_time_min_days != null && lead < r.lead_time_min_days) return false;
    if (r.lead_time_max_days != null && lead > r.lead_time_max_days) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Pricing math — match the TS engine 1:1
// ---------------------------------------------------------------------------

function applyAdjustment(base: number, t: AdjustmentType, v: number): number {
  if (t === "increase_pct") return base * (1 + v / 100);
  if (t === "decrease_pct") return base * (1 - v / 100);
  return v;
}

function clamp(
  n: number,
  min: number | null,
  max: number | null,
): { value: number; reason: ClampReason } {
  if (min != null && n < min) return { value: min, reason: "min_price" };
  if (max != null && n > max) return { value: max, reason: "max_price" };
  return { value: n, reason: null };
}

function evaluate(
  rules: Rule[],
  occPct: number,
  basePrice: number,
  today: CalDate,
): {
  matched: Rule | null;
  recommended: number;
  explanation: string;
  wasClamped: boolean;
  clampReason: ClampReason;
} {
  // Auto-apply targets the *current* day's pricing — no lookahead. If the
  // product later wants next-N-days batch updates, loop stay dates here.
  const stay = today;

  const active = rules
    .filter((r) => r.active && r.deleted_at == null)
    .sort((a, b) => a.priority - b.priority);

  const matched = active.find((r) => {
    if (occPct < r.occupancy_min_pct) return false;
    if (r.occupancy_max_pct != null && occPct > r.occupancy_max_pct) return false;
    return ruleMatchesTime(r, stay, today);
  });

  if (!matched) {
    return {
      matched: null,
      recommended: basePrice,
      explanation: `No active rule matched ${occPct.toFixed(1)}% occupancy.`,
      wasClamped: false,
      clampReason: null,
    };
  }

  const raw = applyAdjustment(basePrice, matched.adjustment_type, matched.adjustment_value);
  const { value, reason } = clamp(Math.round(raw), matched.min_price, matched.max_price);
  const adj =
    matched.adjustment_type === "increase_pct"
      ? `+${matched.adjustment_value}%`
      : matched.adjustment_type === "decrease_pct"
      ? `-${matched.adjustment_value}%`
      : `fixed ${matched.adjustment_value}`;
  const tail = reason ? ` (clamped by ${reason})` : "";
  return {
    matched,
    recommended: value,
    explanation: `Rule "${matched.rule_name}" matched at ${occPct.toFixed(1)}% occupancy. Applied ${adj} → ${value}${tail}.`,
    wasClamped: reason != null,
    clampReason: reason,
  };
}

// ---------------------------------------------------------------------------
// Supabase I/O
// ---------------------------------------------------------------------------

type Sb = ReturnType<typeof createClient>;

async function listEligibleHotels(sb: Sb): Promise<string[]> {
  const { data, error } = await sb
    .from("pricing_settings")
    .select("hotel_id")
    .eq("auto_apply_enabled", true)
    .eq("recommend_only", false);
  if (error) throw error;
  return (data ?? []).map((r: { hotel_id: string }) => r.hotel_id);
}

async function getHotelOccupancy(sb: Sb, hotelId: string): Promise<number> {
  // Filter active stays by scheduled_checkout_at > now() — same fix applied
  // to web/src/services/pricingService.ts.getHotelOccupancy. Zombies (stays
  // stuck in 'inhouse' past their scheduled checkout) would otherwise inflate
  // occupancy and trigger surge rules against fictitious demand.
  const nowIso = new Date().toISOString();
  const [roomsR, occR] = await Promise.all([
    sb.from("rooms").select("id", { count: "exact", head: true }).eq("hotel_id", hotelId),
    sb
      .from("stays")
      .select("id", { count: "exact", head: true })
      .eq("hotel_id", hotelId)
      .in("status", ["inhouse", "arriving"])
      .gt("scheduled_checkout_at", nowIso),
  ]);
  const total = roomsR.count ?? 0;
  const occupied = occR.count ?? 0;
  return total > 0 ? (occupied / total) * 100 : 0;
}

async function listRules(sb: Sb, hotelId: string): Promise<Rule[]> {
  const { data, error } = await sb
    .from("pricing_rules")
    .select("*")
    .eq("hotel_id", hotelId)
    .is("deleted_at", null)
    .order("priority", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Rule[];
}

async function listScopes(sb: Sb, hotelId: string): Promise<Scope[]> {
  // Source of truth for "what to price" after migration 004:
  //   • Per-room-type bases come from v_effective_room_price.base_price
  //     (which resolves rate_plan_prices via priority/dow/validity) — this
  //     covers every room type at the hotel, including new ones that have
  //     never had an override applied.
  //   • The property-wide scope (room_type_id IS NULL) is included only if
  //     a property-wide row already exists in pricing_current_rates — there's
  //     no rate_plan-derived "property base", so we trust the prior snapshot.
  //
  // We deliberately use base_price (not effective_price) because the engine
  // applies adjustments on top of base. Using effective_price would compound
  // overrides on every cron tick.
  const [perTypeR, propertyR] = await Promise.all([
    sb
      .from("v_effective_room_price")
      .select("room_type_id, base_price")
      .eq("hotel_id", hotelId)
      .not("base_price", "is", null),
    sb
      .from("pricing_current_rates")
      .select("base_price")
      .eq("hotel_id", hotelId)
      .is("room_type_id", null)
      .maybeSingle(),
  ]);
  if (perTypeR.error) throw perTypeR.error;
  if (propertyR.error) throw propertyR.error;

  const scopes: Scope[] = (perTypeR.data ?? []).map(
    (r: { room_type_id: string; base_price: number }) => ({
      room_type_id: r.room_type_id,
      base_price: Number(r.base_price),
    }),
  );

  if (propertyR.data && Number(propertyR.data.base_price) > 0) {
    scopes.push({
      room_type_id: null,
      base_price: Number(propertyR.data.base_price),
    });
  }

  return scopes.filter((s) => s.base_price > 0);
}

// Deterministic idempotency key so two overlapping runs (cron blip, retry)
// don't double-write. Hotel + scope + tick window → stable UUID-looking key.
// We use the current hour bucket; same bucket = same key → RPC dedups.
function tickKey(hotelId: string, roomTypeId: string | null): string {
  const bucket = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  const raw = `${hotelId}:${roomTypeId ?? "_"}:${bucket}`;
  // UUIDv5-style hash would be ideal; a simple deterministic fold is enough
  // for the unique index (which treats any UUID as opaque).
  return hashToUuid(raw);
}

function hashToUuid(s: string): string {
  // FNV-1a 64-bit to produce a stable 128-bit hex string. Good enough for
  // idempotency within a single hour window; not a cryptographic hash.
  let h1 = 0xcbf29ce484222325n;
  let h2 = 0x84222325cbf29ce4n;
  for (let i = 0; i < s.length; i++) {
    h1 ^= BigInt(s.charCodeAt(i));
    h1 = (h1 * 0x100000001b3n) & 0xffffffffffffffffn;
    h2 ^= BigInt(s.charCodeAt(s.length - 1 - i));
    h2 = (h2 * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  const hex = (h1.toString(16).padStart(16, "0") + h2.toString(16).padStart(16, "0")).padStart(32, "0");
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20, 32)
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

type ScopeResult = {
  hotel_id: string;
  room_type_id: string | null;
  status: "applied" | "no_change" | "no_rule" | "blocked" | "error";
  recommended?: number;
  base?: number;
  rule_id?: string;
  log_id?: string;
  error?: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: allowCors(req) });
  }
  if (req.method !== "POST") {
    return j(req, 405, { error: "method_not_allowed" });
  }

  // Shared-secret auth — rotate via AUTO_APPLY_CRON_SECRET env var.
  const expected = Deno.env.get("AUTO_APPLY_CRON_SECRET");
  const auth = req.headers.get("authorization") ?? "";
  if (!expected || auth !== `Bearer ${expected}`) {
    return j(req, 401, { error: "unauthorized" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = secretKey();
  if (!supabaseUrl || !serviceKey) {
    return j(req, 500, { error: "missing_env" });
  }
  const sb = createClient(supabaseUrl, serviceKey);
  const today = parseIso(todayIso());

  const results: ScopeResult[] = [];
  let hotels: string[] = [];
  try {
    hotels = await listEligibleHotels(sb);
  } catch (e) {
    return j(req, 500, { error: "list_hotels_failed", detail: String(e) });
  }

  for (const hotelId of hotels) {
    let occPct: number;
    let rules: Rule[];
    let scopes: Scope[];
    try {
      [occPct, rules, scopes] = await Promise.all([
        getHotelOccupancy(sb, hotelId),
        listRules(sb, hotelId),
        listScopes(sb, hotelId),
      ]);
    } catch (e) {
      results.push({
        hotel_id: hotelId,
        room_type_id: null,
        status: "error",
        error: `load: ${String(e)}`,
      });
      continue;
    }

    for (const scope of scopes) {
      // Filter rules to the scope: property-wide rules apply to all scopes;
      // room_type rules only apply to their own room_type_id.
      const scopeRules = rules.filter((r) => {
        if (r.scope_type === "property") return true;
        return r.room_type_id === scope.room_type_id;
      });

      const out = evaluate(scopeRules, occPct, scope.base_price, today);

      if (!out.matched) {
        results.push({
          hotel_id: hotelId,
          room_type_id: scope.room_type_id,
          status: "no_rule",
          base: scope.base_price,
        });
        continue;
      }
      if (out.recommended === scope.base_price) {
        results.push({
          hotel_id: hotelId,
          room_type_id: scope.room_type_id,
          status: "no_change",
          base: scope.base_price,
          recommended: out.recommended,
          rule_id: out.matched.id,
        });
        continue;
      }

      const { data: logId, error: rpcErr } = await sb.rpc(
        "apply_pricing_change_system",
        {
          p_hotel_id: hotelId,
          p_room_type_id: scope.room_type_id,
          p_rule_id: out.matched.id,
          p_base_price: scope.base_price,
          p_new_price: out.recommended,
          p_occupancy_pct: occPct,
          p_adjustment_type: out.matched.adjustment_type,
          p_adjustment_value: out.matched.adjustment_value,
          p_was_clamped: out.wasClamped,
          p_clamp_reason: out.clampReason,
          p_matched_rule_name: out.matched.rule_name,
          p_explanation: out.explanation,
          p_client_request_id: tickKey(hotelId, scope.room_type_id),
        },
      );

      if (rpcErr) {
        const msg = String(rpcErr.message ?? rpcErr);
        const blocked =
          msg.includes("guardrail_blocked") || msg.includes("auto_apply_disabled");
        results.push({
          hotel_id: hotelId,
          room_type_id: scope.room_type_id,
          status: blocked ? "blocked" : "error",
          base: scope.base_price,
          recommended: out.recommended,
          rule_id: out.matched.id,
          error: msg,
        });
        continue;
      }

      results.push({
        hotel_id: hotelId,
        room_type_id: scope.room_type_id,
        status: "applied",
        base: scope.base_price,
        recommended: out.recommended,
        rule_id: out.matched.id,
        log_id: logId as string,
      });
    }
  }

  const summary = {
    hotels_evaluated: hotels.length,
    scopes_evaluated: results.length,
    applied: results.filter((r) => r.status === "applied").length,
    blocked: results.filter((r) => r.status === "blocked").length,
    errors: results.filter((r) => r.status === "error").length,
    no_change: results.filter((r) => r.status === "no_change").length,
    no_rule: results.filter((r) => r.status === "no_rule").length,
  };

  return j(req, 200, { summary, results });
});
