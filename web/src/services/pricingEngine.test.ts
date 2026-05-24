// Unit tests for the pure pricing engine.
//
// The engine is I/O-free and timezone-free, so these tests run without
// Supabase, a browser, or any framework — they exercise the exact code
// path that renders rates in production.

import { describe, expect, it } from "vitest";

import {
  daysBetween,
  dowOf,
  evaluatePricingRules,
  inSeasonWindow,
  mmddOf,
  parseIsoDate,
  ruleMatchesTime,
} from "./pricingEngine";
import type { PricingRule } from "../types/pricing";

// ---------------------------------------------------------------------------
// Rule factory — keeps individual test bodies terse and the defaults boring.
// ---------------------------------------------------------------------------

function makeRule(patch: Partial<PricingRule> = {}): PricingRule {
  return {
    id: patch.id ?? "rule-1",
    hotel_id: "hotel-1",
    rule_name: patch.rule_name ?? "Test rule",
    active: patch.active ?? true,
    scope_type: "property",
    room_type_id: null,
    occupancy_min_pct: patch.occupancy_min_pct ?? 0,
    occupancy_max_pct: patch.occupancy_max_pct ?? 100,
    adjustment_type: patch.adjustment_type ?? "increase_pct",
    adjustment_value: patch.adjustment_value ?? 10,
    min_price: patch.min_price ?? null,
    max_price: patch.max_price ?? null,
    priority: patch.priority ?? 100,
    applicable_dow: patch.applicable_dow ?? null,
    season_start_mmdd: patch.season_start_mmdd ?? null,
    season_end_mmdd: patch.season_end_mmdd ?? null,
    lead_time_min_days: patch.lead_time_min_days ?? null,
    lead_time_max_days: patch.lead_time_max_days ?? null,
    created_by: null,
    updated_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    deleted_at: null,
    ...patch,
  };
}

// ---------------------------------------------------------------------------
// Calendar helpers
// ---------------------------------------------------------------------------

describe("parseIsoDate", () => {
  it("parses a valid ISO calendar date", () => {
    expect(parseIsoDate("2026-04-24")).toEqual({ year: 2026, month: 4, day: 24 });
  });

  it("rejects malformed input", () => {
    expect(() => parseIsoDate("2026/04/24")).toThrow(/Invalid ISO date/);
    expect(() => parseIsoDate("2026-4-24")).toThrow(/Invalid ISO date/);
    expect(() => parseIsoDate("")).toThrow(/Invalid ISO date/);
  });

  it("rejects out-of-range months/days", () => {
    expect(() => parseIsoDate("2026-13-01")).toThrow(/Invalid calendar date/);
    expect(() => parseIsoDate("2026-00-15")).toThrow(/Invalid calendar date/);
    expect(() => parseIsoDate("2026-02-32")).toThrow(/Invalid calendar date/);
  });
});

describe("dowOf", () => {
  it("returns JS-compatible day-of-week (0=Sun..6=Sat)", () => {
    // 2026-04-24 is a Friday → 5
    expect(dowOf({ year: 2026, month: 4, day: 24 })).toBe(5);
    // 2026-04-26 is a Sunday → 0
    expect(dowOf({ year: 2026, month: 4, day: 26 })).toBe(0);
    // 2026-04-25 is a Saturday → 6
    expect(dowOf({ year: 2026, month: 4, day: 25 })).toBe(6);
  });
});

describe("mmddOf", () => {
  it("packs month/day into MMDD", () => {
    expect(mmddOf({ year: 2026, month: 1, day: 1 })).toBe(101);
    expect(mmddOf({ year: 2026, month: 12, day: 31 })).toBe(1231);
    expect(mmddOf({ year: 2026, month: 6, day: 15 })).toBe(615);
  });
});

describe("daysBetween", () => {
  it("computes inclusive calendar-day delta", () => {
    expect(
      daysBetween({ year: 2026, month: 4, day: 24 }, { year: 2026, month: 4, day: 24 }),
    ).toBe(0);
    expect(
      daysBetween({ year: 2026, month: 4, day: 24 }, { year: 2026, month: 4, day: 25 }),
    ).toBe(1);
    expect(
      daysBetween({ year: 2026, month: 4, day: 25 }, { year: 2026, month: 4, day: 24 }),
    ).toBe(-1);
  });

  it("handles month and DST boundaries", () => {
    // US DST transition weekend in 2026: Mar 7 → Mar 8. Pure calendar arithmetic
    // must still return 1 even though wall-clock hours change.
    expect(
      daysBetween({ year: 2026, month: 3, day: 7 }, { year: 2026, month: 3, day: 8 }),
    ).toBe(1);
    // Month rollover
    expect(
      daysBetween({ year: 2026, month: 1, day: 31 }, { year: 2026, month: 2, day: 1 }),
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Seasonality
// ---------------------------------------------------------------------------

describe("inSeasonWindow", () => {
  it("non-wrapping window (Jun 01 – Aug 31)", () => {
    expect(inSeasonWindow(615, 601, 831)).toBe(true);
    expect(inSeasonWindow(601, 601, 831)).toBe(true); // left edge
    expect(inSeasonWindow(831, 601, 831)).toBe(true); // right edge
    expect(inSeasonWindow(531, 601, 831)).toBe(false);
    expect(inSeasonWindow(901, 601, 831)).toBe(false);
  });

  it("wrapping window (Dec 15 – Jan 15)", () => {
    expect(inSeasonWindow(1220, 1215, 115)).toBe(true); // inside Dec half
    expect(inSeasonWindow(110, 1215, 115)).toBe(true); // inside Jan half
    expect(inSeasonWindow(1215, 1215, 115)).toBe(true); // left edge
    expect(inSeasonWindow(115, 1215, 115)).toBe(true); // right edge
    expect(inSeasonWindow(601, 1215, 115)).toBe(false); // mid-summer
    expect(inSeasonWindow(1214, 1215, 115)).toBe(false); // one day short
    expect(inSeasonWindow(116, 1215, 115)).toBe(false); // one day over
  });
});

// ---------------------------------------------------------------------------
// ruleMatchesTime: DOW + seasonality + lead-time composition
// ---------------------------------------------------------------------------

describe("ruleMatchesTime", () => {
  const today = parseIsoDate("2026-04-24"); // Fri

  it("no time predicates → always matches", () => {
    const stay = parseIsoDate("2026-07-04");
    expect(ruleMatchesTime(makeRule(), stay, today)).toBe(true);
  });

  it("DOW list matches when stay's DOW is included", () => {
    const stay = parseIsoDate("2026-04-25"); // Sat (6)
    expect(
      ruleMatchesTime(makeRule({ applicable_dow: [5, 6] }), stay, today),
    ).toBe(true);
  });

  it("DOW list rejects when stay's DOW is absent", () => {
    const stay = parseIsoDate("2026-04-27"); // Mon (1)
    expect(
      ruleMatchesTime(makeRule({ applicable_dow: [5, 6] }), stay, today),
    ).toBe(false);
  });

  it("empty DOW list is treated as 'any'", () => {
    // Defensive: admins sometimes save an empty multi-select. We shouldn't
    // turn that into a no-op rule.
    const stay = parseIsoDate("2026-04-27");
    expect(
      ruleMatchesTime(makeRule({ applicable_dow: [] }), stay, today),
    ).toBe(true);
  });

  it("seasonality gate respects wrap", () => {
    const winter = parseIsoDate("2026-12-25");
    expect(
      ruleMatchesTime(
        makeRule({ season_start_mmdd: 1215, season_end_mmdd: 115 }),
        winter,
        today,
      ),
    ).toBe(true);

    const offSeason = parseIsoDate("2026-07-04");
    expect(
      ruleMatchesTime(
        makeRule({ season_start_mmdd: 1215, season_end_mmdd: 115 }),
        offSeason,
        today,
      ),
    ).toBe(false);
  });

  it("lead-time min/max boundaries", () => {
    const plus3 = parseIsoDate("2026-04-27"); // today+3
    const plus7 = parseIsoDate("2026-05-01"); // today+7
    const plus14 = parseIsoDate("2026-05-08"); // today+14

    const rule = makeRule({ lead_time_min_days: 3, lead_time_max_days: 7 });
    expect(ruleMatchesTime(rule, plus3, today)).toBe(true); // left edge inclusive
    expect(ruleMatchesTime(rule, plus7, today)).toBe(true); // right edge inclusive
    expect(ruleMatchesTime(rule, plus14, today)).toBe(false);
    expect(
      ruleMatchesTime(rule, parseIsoDate("2026-04-25"), today),
    ).toBe(false); // below min (1)
  });

  it("all three predicates compose (AND)", () => {
    const rule = makeRule({
      applicable_dow: [5, 6],
      season_start_mmdd: 601,
      season_end_mmdd: 831,
      lead_time_min_days: 0,
      lead_time_max_days: 90,
    });
    // Fri in season, within lead → match
    expect(ruleMatchesTime(rule, parseIsoDate("2026-07-03"), today)).toBe(true);
    // Fri out of season → no match
    expect(ruleMatchesTime(rule, parseIsoDate("2026-09-04"), today)).toBe(false);
    // In season but Mon → no match
    expect(ruleMatchesTime(rule, parseIsoDate("2026-07-06"), today)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluatePricingRules: end-to-end
// ---------------------------------------------------------------------------

describe("evaluatePricingRules", () => {
  const ctx = { stayDate: "2026-05-10", evaluationDate: "2026-04-24" };

  it("returns base price and no-match reason when no rule fires", () => {
    const result = evaluatePricingRules([], 50, 1000, ctx);
    expect(result.matched_rule).toBeNull();
    expect(result.recommended_price).toBe(1000);
    expect(result.reason.code).toBe("no_rule_matched");
    expect(result.was_clamped).toBe(false);
    expect(result.guardrail.blocked).toBe(false);
  });

  it("applies increase_pct adjustment", () => {
    const rules = [
      makeRule({
        occupancy_min_pct: 80,
        occupancy_max_pct: 100,
        adjustment_type: "increase_pct",
        adjustment_value: 20,
      }),
    ];
    const result = evaluatePricingRules(rules, 90, 1000, ctx);
    expect(result.recommended_price).toBe(1200);
    expect(result.reason.code).toBe("rule_matched");
  });

  it("applies decrease_pct adjustment", () => {
    const rules = [
      makeRule({
        occupancy_min_pct: 0,
        occupancy_max_pct: 30,
        adjustment_type: "decrease_pct",
        adjustment_value: 15,
      }),
    ];
    const result = evaluatePricingRules(rules, 20, 1000, ctx);
    expect(result.recommended_price).toBe(850);
  });

  it("applies set_fixed_price adjustment", () => {
    const rules = [
      makeRule({
        adjustment_type: "set_fixed_price",
        adjustment_value: 1499,
      }),
    ];
    const result = evaluatePricingRules(rules, 50, 1000, ctx);
    expect(result.recommended_price).toBe(1499);
  });

  it("clamps to max_price and flags the clamp reason", () => {
    const rules = [
      makeRule({
        adjustment_type: "increase_pct",
        adjustment_value: 100,
        max_price: 1500,
      }),
    ];
    const result = evaluatePricingRules(rules, 50, 1000, ctx);
    expect(result.recommended_price).toBe(1500);
    expect(result.was_clamped).toBe(true);
    expect(result.clamp_reason).toBe("max_price");
  });

  it("clamps to min_price and flags the clamp reason", () => {
    const rules = [
      makeRule({
        adjustment_type: "decrease_pct",
        adjustment_value: 50,
        min_price: 800,
      }),
    ];
    const result = evaluatePricingRules(rules, 50, 1000, ctx);
    expect(result.recommended_price).toBe(800);
    expect(result.was_clamped).toBe(true);
    expect(result.clamp_reason).toBe("min_price");
  });

  it("skips inactive rules", () => {
    const rules = [
      makeRule({ id: "a", priority: 1, active: false, adjustment_value: 50 }),
      makeRule({ id: "b", priority: 2, active: true, adjustment_value: 10 }),
    ];
    const result = evaluatePricingRules(rules, 50, 1000, ctx);
    expect(result.matched_rule?.id).toBe("b");
    expect(result.recommended_price).toBe(1100);
  });

  it("honors priority order (lower = first)", () => {
    const rules = [
      makeRule({ id: "late", priority: 10, adjustment_value: 30 }),
      makeRule({ id: "early", priority: 1, adjustment_value: 10 }),
    ];
    const result = evaluatePricingRules(rules, 50, 1000, ctx);
    expect(result.matched_rule?.id).toBe("early");
    expect(result.recommended_price).toBe(1100);
  });

  it("filters on occupancy window (inclusive)", () => {
    const rules = [
      makeRule({
        occupancy_min_pct: 80,
        occupancy_max_pct: 100,
        adjustment_value: 20,
      }),
    ];
    // below window
    expect(evaluatePricingRules(rules, 79, 1000, ctx).matched_rule).toBeNull();
    // left edge
    expect(evaluatePricingRules(rules, 80, 1000, ctx).matched_rule).not.toBeNull();
    // right edge
    expect(evaluatePricingRules(rules, 100, 1000, ctx).matched_rule).not.toBeNull();
  });

  it("treats null occupancy_max_pct as open-ended upper bound", () => {
    const rules = [
      makeRule({ occupancy_min_pct: 90, occupancy_max_pct: null, adjustment_value: 25 }),
    ];
    const result = evaluatePricingRules(rules, 999, 1000, ctx);
    expect(result.matched_rule).not.toBeNull();
    expect(result.recommended_price).toBe(1250);
  });

  it("discriminates reason codes cleanly", () => {
    const empty = evaluatePricingRules([], 50, 1000, ctx);
    if (empty.reason.code === "no_rule_matched") {
      expect(empty.reason.occupancy_pct).toBe(50);
    } else {
      throw new Error("expected no_rule_matched");
    }

    const matched = evaluatePricingRules([makeRule()], 50, 1000, ctx);
    if (matched.reason.code === "rule_matched") {
      expect(matched.reason.rule_id).toBe("rule-1");
      expect(matched.reason.adjustment_type).toBe("increase_pct");
    } else {
      throw new Error("expected rule_matched");
    }
  });

  // -------------------------------------------------------------------------
  // Guardrail
  // -------------------------------------------------------------------------

  it("guardrail disabled (undefined) → never blocked", () => {
    const rules = [
      makeRule({ adjustment_type: "increase_pct", adjustment_value: 80 }),
    ];
    const result = evaluatePricingRules(rules, 50, 1000, ctx);
    expect(result.recommended_price).toBe(1800);
    expect(result.guardrail.max_delta_pct).toBeNull();
    expect(result.guardrail.blocked).toBe(false);
    expect(result.guardrail.actual_delta_pct).toBe(80);
  });

  it("guardrail blocks when delta exceeds cap", () => {
    const rules = [
      makeRule({ adjustment_type: "increase_pct", adjustment_value: 50 }),
    ];
    const result = evaluatePricingRules(rules, 50, 1000, {
      ...ctx,
      maxDeltaPct: 25,
    });
    expect(result.recommended_price).toBe(1500);
    expect(result.guardrail.max_delta_pct).toBe(25);
    expect(result.guardrail.actual_delta_pct).toBe(50);
    expect(result.guardrail.blocked).toBe(true);
  });

  it("guardrail passes at the boundary (delta == cap)", () => {
    const rules = [
      makeRule({ adjustment_type: "increase_pct", adjustment_value: 25 }),
    ];
    const result = evaluatePricingRules(rules, 50, 1000, {
      ...ctx,
      maxDeltaPct: 25,
    });
    expect(result.guardrail.actual_delta_pct).toBe(25);
    expect(result.guardrail.blocked).toBe(false);
  });

  it("guardrail measures absolute delta (decrease)", () => {
    const rules = [
      makeRule({ adjustment_type: "decrease_pct", adjustment_value: 40 }),
    ];
    const result = evaluatePricingRules(rules, 50, 1000, {
      ...ctx,
      maxDeltaPct: 25,
    });
    expect(result.recommended_price).toBe(600);
    expect(result.guardrail.actual_delta_pct).toBe(40);
    expect(result.guardrail.blocked).toBe(true);
  });

  it("guardrail is unblocked on no-match (delta is 0)", () => {
    const result = evaluatePricingRules([], 50, 1000, { ...ctx, maxDeltaPct: 25 });
    expect(result.guardrail.actual_delta_pct).toBe(0);
    expect(result.guardrail.blocked).toBe(false);
  });
});
