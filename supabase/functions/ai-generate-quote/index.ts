// supabase/functions/ai-generate-quote/index.ts
//
// Phase 8B — AI-assisted quote-draft generation.
//
// Flow:
//   1. JWT-required, hotel-member check.
//   2. User-keyed rate-limit (10/min).
//   3. Hotel-level consent gate (`hotels.ai_quote_drafts_consented = true`).
//   4. Daily token-budget gate (`hotels.ai_quote_daily_token_cap`).
//   5. Resolve lead context (if lead_id provided) read-only.
//   6. Build versioned, structured prompt — NEVER concatenate raw text.
//   7. Call Claude (default: claude-haiku-4-5).
//   8. Append verbatim disclaimer defense-in-depth.
//   9. logTokens() — total = input + output.
//  10. Return draft_text + token meta. Frontend calls create_quote_draft RPC
//      separately so this function stays focused on the AI call.

import {
  assertAuthed,
  json,
  preflight,
  rateLimitForUser,
  supabaseAnon,
  supabaseService,
  tooManyRequests,
} from "../_shared/auth.ts";
import { logTokens } from "../_shared/ai.ts";
import { runAnthropic } from "../_shared/anthropic.ts";
import {
  QUOTE_DISCLAIMER_LINE,
  QUOTE_PROMPT_VERSION,
  buildQuotePrompt,
  type QuotePromptVars,
} from "../_shared/prompts/quote_v1.ts";

interface BodyShape {
  hotel_id?: string;
  lead_id?: string | null;
  package_code?: string | null;
  package_name?: string | null;
  package_duration_nights?: number | null;
  package_inclusions?: string[];
  selected_inclusions?: string[];
  package_policy_notes?: string | null;
  room_type_id?: string | null;
  room_type_name?: string | null;
  manual_price_text?: string;
  nights?: number;
  owner_notes?: string;
}

const FUNC_NAME = "ai-generate-quote";
const RATE_LIMIT_PER_MIN = 10;
const DEFAULT_MODEL = "claude-haiku-4-5";
const MAX_OUTPUT_TOKENS = 1500;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json(405, { ok: false, code: "METHOD_NOT_ALLOWED" });

  // ── Auth ──────────────────────────────────────────────────────────────
  const authed = await assertAuthed(req);
  if (authed instanceof Response) return authed;
  const userId = authed.user.id;

  // ── Parse + shape ─────────────────────────────────────────────────────
  let body: BodyShape;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, code: "INVALID_REQUEST", detail: "malformed_json" });
  }

  const hotelId = body.hotel_id;
  if (!hotelId || typeof hotelId !== "string") {
    return json(400, { ok: false, code: "INVALID_REQUEST", detail: "hotel_id_missing" });
  }

  // ── Membership ────────────────────────────────────────────────────────
  const anon = supabaseAnon(req);
  const { data: isMember, error: memberErr } = await anon.rpc("vaiyu_is_hotel_member", {
    p_hotel_id: hotelId,
  });
  if (memberErr) {
    console.error("[ai-generate-quote] member check failed", memberErr);
    return json(500, { ok: false, code: "UNKNOWN_ERROR" });
  }
  if (isMember !== true) return json(403, { ok: false, code: "NOT_AUTHORIZED" });

  // ── Rate-limit ────────────────────────────────────────────────────────
  const rl = await rateLimitForUser(anon, userId, `${FUNC_NAME}:${hotelId}`, RATE_LIMIT_PER_MIN);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

  // ── Hotel consent + budget + property meta (service-role read) ────────
  const svc = supabaseService();
  const { data: hotel, error: hotelErr } = await svc
    .from("hotels")
    .select(
      "id, name, city, ai_quote_drafts_consented, ai_quote_daily_token_cap",
    )
    .eq("id", hotelId)
    .maybeSingle();
  if (hotelErr || !hotel) {
    console.error("[ai-generate-quote] hotel fetch failed", { hotelId, hotelErr });
    return json(404, { ok: false, code: "HOTEL_NOT_FOUND" });
  }
  if (hotel.ai_quote_drafts_consented !== true) {
    return json(403, {
      ok: false,
      code: "CONSENT_REQUIRED",
      detail: "Owner must enable AI quote drafts in Settings before this can run.",
    });
  }

  // Daily budget check via dedicated RPC (single source of truth, uses index)
  const { data: usedToday, error: usedErr } = await svc.rpc("get_ai_quote_daily_usage", {
    p_hotel_id: hotelId,
  });
  if (usedErr) {
    console.error("[ai-generate-quote] usage check failed", usedErr);
    return json(500, { ok: false, code: "UNKNOWN_ERROR" });
  }
  const usedSoFar = Number(usedToday ?? 0);
  const cap = Number(hotel.ai_quote_daily_token_cap ?? 0);
  if (cap > 0 && usedSoFar >= cap) {
    return json(402, {
      ok: false,
      code: "BUDGET_EXCEEDED",
      detail: `Daily AI quote budget reached (${usedSoFar}/${cap} tokens).`,
    });
  }

  // ── Resolve lead context (read-only) ──────────────────────────────────
  let leadSnapshot: {
    name: string | null;
    party_adults: number;
    party_children: number;
    room_count: number;
    check_in: string | null;
    check_out: string | null;
  } | null = null;

  if (body.lead_id && typeof body.lead_id === "string") {
    const { data: lead, error: leadErr } = await svc
      .from("leads")
      .select(
        "id, hotel_id, contact_name, party_adults, party_children, room_count, requested_check_in, requested_check_out",
      )
      .eq("id", body.lead_id)
      .maybeSingle();
    if (leadErr) {
      console.error("[ai-generate-quote] lead fetch failed", leadErr);
      return json(500, { ok: false, code: "UNKNOWN_ERROR" });
    }
    if (lead && lead.hotel_id !== hotelId) {
      return json(400, { ok: false, code: "LEAD_HOTEL_MISMATCH" });
    }
    if (lead) {
      leadSnapshot = {
        name: lead.contact_name ?? null,
        party_adults: lead.party_adults ?? 1,
        party_children: lead.party_children ?? 0,
        room_count: lead.room_count ?? 1,
        check_in: lead.requested_check_in ?? null,
        check_out: lead.requested_check_out ?? null,
      };
    }
  }

  // ── Build structured vars (no raw concat into prompt) ─────────────────
  const vars: QuotePromptVars = {
    guest_name: leadSnapshot?.name ?? null,
    party_adults: leadSnapshot?.party_adults ?? 1,
    party_children: leadSnapshot?.party_children ?? 0,
    room_count: leadSnapshot?.room_count ?? 1,
    check_in: leadSnapshot?.check_in ?? null,
    check_out: leadSnapshot?.check_out ?? null,
    nights: Math.max(0, Number(body.nights ?? 0) | 0),
    room_type_name: body.room_type_name ?? null,
    package_name: body.package_name ?? null,
    package_duration_nights:
      body.package_duration_nights == null ? null : Math.max(0, Number(body.package_duration_nights) | 0),
    package_inclusions: Array.isArray(body.package_inclusions) ? body.package_inclusions : [],
    selected_inclusions: Array.isArray(body.selected_inclusions) ? body.selected_inclusions : [],
    package_policy_notes: body.package_policy_notes ?? null,
    manual_price_text: (body.manual_price_text ?? "").trim(),
    owner_notes: (body.owner_notes ?? "").trim(),
    property_name: hotel.name ?? "the property",
    property_city: hotel.city ?? null,
  };

  const { systemPrompt, userMessage } = buildQuotePrompt(vars);

  // ── LLM call ──────────────────────────────────────────────────────────
  const model = Deno.env.get("AI_QUOTE_MODEL") || DEFAULT_MODEL;
  const started = performance.now();
  let llm;
  try {
    llm = await runAnthropic({
      model,
      systemPrompt,
      userMessage,
      maxTokens: MAX_OUTPUT_TOKENS,
      temperature: 0.3,
    });
  } catch (e) {
    console.error("[ai-generate-quote] anthropic call failed", e);
    const msg = (e as Error).message ?? "";
    if (msg.includes("ANTHROPIC_API_KEY")) {
      return json(500, { ok: false, code: "AI_NOT_CONFIGURED" });
    }
    return json(502, { ok: false, code: "AI_UPSTREAM_ERROR" });
  }
  const durationMs = Math.round(performance.now() - started);

  // ── Guard against model refusal sentinel ──────────────────────────────
  if (llm.text.startsWith("CANNOT_DRAFT:")) {
    console.warn("[ai-generate-quote] model refused", { hotelId, reason: llm.text });
    // Token usage still gets logged — we paid for it.
    await logTokens(svc, hotelId, llm.totalTokens, { model: llm.model, func: FUNC_NAME });
    return json(422, {
      ok: false,
      code: "AI_REFUSED",
      detail: llm.text.replace(/^CANNOT_DRAFT:\s*/, "").trim(),
    });
  }

  // ── Defense-in-depth: ensure disclaimer line is present ───────────────
  let finalText = llm.text;
  if (!finalText.includes(QUOTE_DISCLAIMER_LINE)) {
    finalText = `${finalText.trim()}\n\n—\n${QUOTE_DISCLAIMER_LINE}`;
  }

  // ── Token logging (existing helper writes ai_usage + ai_usage_events) ─
  await logTokens(svc, hotelId, llm.totalTokens, { model: llm.model, func: FUNC_NAME });

  console.log("[ai-generate-quote] ok", {
    hotelId,
    userId,
    model: llm.model,
    tokens_in: llm.tokensIn,
    tokens_out: llm.tokensOut,
    duration_ms: durationMs,
    prompt_version: QUOTE_PROMPT_VERSION,
  });

  return json(200, {
    ok: true,
    draft_text: finalText,
    model: llm.model,
    tokens_in: llm.tokensIn,
    tokens_out: llm.tokensOut,
    prompt_version: QUOTE_PROMPT_VERSION,
    duration_ms: durationMs,
  });
});
