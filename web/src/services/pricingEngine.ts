// web/src/services/pricingEngine.ts
// Pure, deterministic, timezone-free pricing engine.
//
// No I/O, no framework deps, no currency symbols. Everything a reviewer
// would want to verify — DOW matching, seasonality (including wrap),
// lead-time, clamping — lives in a function they can call directly from a
// unit test.
//
// Date handling: the engine operates on calendar days ("YYYY-MM-DD"), not
// Date instants, so a user west of UTC never gets DOW shifted by one.

import { formatMoney } from "../lib/currency";
import type {
  PricingAdjustmentType,
  PricingClampReason,
  PricingEvaluationContext,
  PricingEvaluationResult,
  PricingGuardrail,
  PricingReason,
  PricingRule,
} from "../types/pricing";

// ---------------------------------------------------------------------------
// Calendar-date helpers (exported for tests)
// ---------------------------------------------------------------------------

export type CalDate = { year: number; month: number; day: number }; // month 1-12

export function parseIsoDate(s: string): CalDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`Invalid ISO date "${s}" (expected YYYY-MM-DD)`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Invalid calendar date "${s}"`);
  }
  return { year, month, day };
}

// Browser-local today as YYYY-MM-DD. Front-desk staff are at the hotel, so
// browser-local ≈ hotel-local in practice. When a `hotels.timezone` column
// lands, callers should compute today in that tz and pass it in explicitly.
export function todayIsoLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dowOf(d: CalDate): number {
  // Anchored to UTC so the result does not depend on runtime tz.
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

export function mmddOf(d: CalDate): number {
  return d.month * 100 + d.day;
}

export function daysBetween(a: CalDate, b: CalDate): number {
  const ms = 24 * 60 * 60 * 1000;
  const ua = Date.UTC(a.year, a.month - 1, a.day);
  const ub = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((ub - ua) / ms);
}

export function inSeasonWindow(
  stayMmdd: number,
  startMmdd: number,
  endMmdd: number,
): boolean {
  // Non-wrapping window (e.g. 0601..0831)
  if (startMmdd <= endMmdd) return stayMmdd >= startMmdd && stayMmdd <= endMmdd;
  // Wrapping window (e.g. 1215..0115)
  return stayMmdd >= startMmdd || stayMmdd <= endMmdd;
}

export function ruleMatchesTime(
  rule: PricingRule,
  stay: CalDate,
  today: CalDate,
): boolean {
  if (rule.applicable_dow && rule.applicable_dow.length > 0) {
    const dow = dowOf(stay);
    if (!rule.applicable_dow.some((d) => d === dow)) return false;
  }

  if (rule.season_start_mmdd != null && rule.season_end_mmdd != null) {
    if (!inSeasonWindow(mmddOf(stay), rule.season_start_mmdd, rule.season_end_mmdd)) {
      return false;
    }
  }

  if (rule.lead_time_min_days != null || rule.lead_time_max_days != null) {
    const lead = daysBetween(today, stay);
    if (rule.lead_time_min_days != null && lead < rule.lead_time_min_days) return false;
    if (rule.lead_time_max_days != null && lead > rule.lead_time_max_days) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Price computation
// ---------------------------------------------------------------------------

function applyAdjustment(
  basePrice: number,
  type: PricingAdjustmentType,
  value: number,
): number {
  switch (type) {
    case "increase_pct":
      return basePrice * (1 + value / 100);
    case "decrease_pct":
      return basePrice * (1 - value / 100);
    case "set_fixed_price":
      return value;
  }
}

function clamp(
  recommended: number,
  min: number | null,
  max: number | null,
): { value: number; reason: PricingClampReason | null } {
  if (min != null && recommended < min) return { value: min, reason: "min_price" };
  if (max != null && recommended > max) return { value: max, reason: "max_price" };
  return { value: recommended, reason: null };
}

// Max-delta guardrail: computes the absolute percentage swing from base and
// flags it `blocked` if it exceeds the configured cap. Guardrail enforcement
// happens in two places:
//   1. The `apply_pricing_change` RPC rejects `p_source='auto'` writes whose
//      delta exceeds the cap (defense-in-depth).
//   2. UI surfaces `blocked=true` so operators see why auto-apply skipped.
// Recommend-only mode never blocks on the client — the operator is the
// guardrail there.
function computeGuardrail(
  basePrice: number,
  recommendedPrice: number,
  maxDeltaPct: number | null | undefined,
): PricingGuardrail {
  const deltaPct =
    basePrice > 0 ? Math.abs(recommendedPrice - basePrice) / basePrice * 100 : 0;
  const rounded = Math.round(deltaPct * 100) / 100;
  const cap = maxDeltaPct ?? null;
  return {
    max_delta_pct: cap,
    actual_delta_pct: rounded,
    blocked: cap != null && rounded > cap,
  };
}

// ---------------------------------------------------------------------------
// Explanation renderer (locale/currency-aware)
// ---------------------------------------------------------------------------

export function formatPricingExplanation(
  reason: PricingReason,
  basePrice: number,
  recommendedPrice: number,
  money: (n: number) => string = formatMoney,
): string {
  if (reason.code === "no_rule_matched") {
    return (
      `No active rule matched ${reason.occupancy_pct.toFixed(1)}% occupancy. ` +
      `Base price unchanged.`
    );
  }

  const adjLabel =
    reason.adjustment_type === "increase_pct"
      ? `+${reason.adjustment_value}%`
      : reason.adjustment_type === "decrease_pct"
      ? `-${reason.adjustment_value}%`
      : `fixed ${money(reason.adjustment_value)}`;

  const occRange = `${reason.occupancy_min_pct}–${reason.occupancy_max_pct ?? "∞"}%`;
  const tail = reason.was_clamped ? ` (clamped by ${reason.clamp_reason})` : ".";

  return (
    `Rule "${reason.rule_name}" matched at ${reason.occupancy_pct.toFixed(1)}% occupancy ` +
    `(${occRange}). Applied ${adjLabel} to base ${money(basePrice)} → ${money(recommendedPrice)}` +
    tail
  );
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function evaluatePricingRules(
  rules: PricingRule[],
  occupancyPct: number,
  basePrice: number,
  ctx?: PricingEvaluationContext,
): PricingEvaluationResult {
  const stay = parseIsoDate(ctx?.stayDate ?? todayIsoLocal());
  const today = parseIsoDate(ctx?.evaluationDate ?? todayIsoLocal());

  const sorted = [...rules]
    .filter((r) => r.active)
    .sort((a, b) => a.priority - b.priority);

  const matched = sorted.find((r) => {
    const above = occupancyPct >= r.occupancy_min_pct;
    const below =
      r.occupancy_max_pct == null || occupancyPct <= r.occupancy_max_pct;
    if (!(above && below)) return false;
    return ruleMatchesTime(r, stay, today);
  });

  if (!matched) {
    const reason: PricingReason = {
      code: "no_rule_matched",
      occupancy_pct: occupancyPct,
    };
    return {
      matched_rule: null,
      recommended_price: basePrice,
      base_price: basePrice,
      occupancy_pct: occupancyPct,
      reason,
      explanation: formatPricingExplanation(reason, basePrice, basePrice),
      was_clamped: false,
      clamp_reason: null,
      guardrail: computeGuardrail(basePrice, basePrice, ctx?.maxDeltaPct),
    };
  }

  const raw = applyAdjustment(basePrice, matched.adjustment_type, matched.adjustment_value);
  const { value: clamped, reason: clampReason } = clamp(
    Math.round(raw),
    matched.min_price,
    matched.max_price,
  );

  const reason: PricingReason = {
    code: "rule_matched",
    rule_id: matched.id,
    rule_name: matched.rule_name,
    occupancy_pct: occupancyPct,
    occupancy_min_pct: matched.occupancy_min_pct,
    occupancy_max_pct: matched.occupancy_max_pct,
    adjustment_type: matched.adjustment_type,
    adjustment_value: matched.adjustment_value,
    was_clamped: clampReason != null,
    clamp_reason: clampReason,
  };

  return {
    matched_rule: matched,
    recommended_price: clamped,
    base_price: basePrice,
    occupancy_pct: occupancyPct,
    reason,
    explanation: formatPricingExplanation(reason, basePrice, clamped),
    was_clamped: clampReason != null,
    clamp_reason: clampReason,
    guardrail: computeGuardrail(basePrice, clamped, ctx?.maxDeltaPct),
  };
}
