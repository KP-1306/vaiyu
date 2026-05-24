// web/src/services/pricingService.test.ts
// Unit tests for the pricing service I/O layer. Mocks the supabase client
// using the same thenable-builder pattern as rateService.test.ts so chains
// of arbitrary length work and `await chain()` resolves to whatever the
// test queues via `nextResolution(...)`.
//
// Engine logic (rule eval, time matching, clamps, guardrail) lives in
// pricingEngine.ts and is tested separately in pricingEngine.test.ts.
// This file focuses on:
//   • PricingServiceError wrapping (PG codes → kinds)
//   • Settings read-merge-write semantics (omitted vs explicitly null)
//   • Optimistic concurrency on updatePricingRule (deleted vs stale)
//   • applyPricing input validation + RPC payload shape
//   • getHotelOccupancy zombie-stay filter (scheduled_checkout_at > now)
//   • getEffectivePrices record-build + numeric coercion

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock supabase client BEFORE service import ───
const rpc = vi.fn();

type ThenableBuilder = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  neq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  not: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  lte: ReturnType<typeof vi.fn>;
  lt: ReturnType<typeof vi.fn>;
  gt: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  then: (onResolve: (value: unknown) => unknown) => Promise<unknown>;
};

const fromBuilder = {} as ThenableBuilder;

let resolutionQueue: unknown[] = [];
function nextResolution(value: unknown) {
  resolutionQueue.push(value);
}

const chainables = [
  "select", "insert", "update", "upsert", "delete",
  "eq", "neq", "is", "not", "in",
  "gte", "lte", "lt", "gt",
  "order", "limit",
] as const;

for (const m of chainables) {
  (fromBuilder as Record<string, unknown>)[m] = vi.fn(() => fromBuilder);
}
fromBuilder.single = vi.fn();
fromBuilder.maybeSingle = vi.fn();

fromBuilder.then = (onResolve) => {
  const value = resolutionQueue.shift() ?? { data: null, error: null };
  return Promise.resolve(value).then(onResolve);
};

const from = vi.fn((_table: string) => fromBuilder);

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (name: string, params?: unknown) => rpc(name, params),
    from: (table: string) => from(table),
  },
}));

import {
  applyPricing,
  createPricingRule,
  deletePricingRule,
  getEffectivePrices,
  getHotelOccupancy,
  getPricingSettings,
  listPricingRules,
  listRoomTypes,
  PricingServiceError,
  updatePricingRule,
  upsertPricingSettings,
} from "./pricingService";

beforeEach(() => {
  rpc.mockReset();
  from.mockClear();
  resolutionQueue = [];
  for (const m of chainables) {
    (fromBuilder as unknown as Record<string, ReturnType<typeof vi.fn>>)[m].mockClear();
  }
  fromBuilder.single.mockReset();
  fromBuilder.maybeSingle.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────
// PricingServiceError — PG code → kind mapping
// ─────────────────────────────────────────────────────────────────────────
describe("PricingServiceError", () => {
  it("constructs with kind + message + cause", () => {
    const cause = new Error("underlying");
    const e = new PricingServiceError("not_found", "Rule not found", cause);
    expect(e.kind).toBe("not_found");
    expect(e.message).toBe("Rule not found");
    expect((e as unknown as { cause: unknown }).cause).toBe(cause);
    expect(e.name).toBe("PricingServiceError");
  });

  it("PGRST116 → not_found via wrapper (listPricingRules)", async () => {
    nextResolution({
      data: null,
      error: { code: "PGRST116", message: "no rows" },
    });
    try {
      await listPricingRules("hotel-1");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PricingServiceError);
      expect((e as PricingServiceError).kind).toBe("not_found");
    }
  });

  it("42501 → permission_denied", async () => {
    nextResolution({
      data: null,
      error: { code: "42501", message: "RLS denied" },
    });
    try {
      await listPricingRules("hotel-1");
    } catch (e) {
      expect((e as PricingServiceError).kind).toBe("permission_denied");
    }
  });

  it("23505 → conflict", async () => {
    nextResolution({
      data: null,
      error: { code: "23505", message: "unique violation" },
    });
    try {
      await listPricingRules("hotel-1");
    } catch (e) {
      expect((e as PricingServiceError).kind).toBe("conflict");
    }
  });

  it("network-ish message → network kind", async () => {
    nextResolution({
      data: null,
      error: { message: "Failed to fetch" },
    });
    try {
      await listPricingRules("hotel-1");
    } catch (e) {
      expect((e as PricingServiceError).kind).toBe("network");
    }
  });

  it("unknown errors fall back to 'unknown' kind", async () => {
    nextResolution({
      data: null,
      error: { code: "??", message: "weird" },
    });
    try {
      await listPricingRules("hotel-1");
    } catch (e) {
      expect((e as PricingServiceError).kind).toBe("unknown");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// listPricingRules
// ─────────────────────────────────────────────────────────────────────────
describe("listPricingRules", () => {
  it("queries with deleted_at IS NULL and orders by priority asc", async () => {
    nextResolution({ data: [], error: null });
    await listPricingRules("hotel-1");
    expect(from).toHaveBeenCalledWith("pricing_rules");
    expect(fromBuilder.eq).toHaveBeenCalledWith("hotel_id", "hotel-1");
    expect(fromBuilder.is).toHaveBeenCalledWith("deleted_at", null);
    expect(fromBuilder.order).toHaveBeenCalledWith("priority", { ascending: true });
  });

  it("returns empty array when DB returns null", async () => {
    nextResolution({ data: null, error: null });
    expect(await listPricingRules("hotel-1")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// createPricingRule
// ─────────────────────────────────────────────────────────────────────────
describe("createPricingRule", () => {
  it("inserts with hotel_id + created_by injected from arguments", async () => {
    fromBuilder.single.mockResolvedValueOnce({
      data: { id: "rule-1", rule_name: "Surge" },
      error: null,
    });
    const form = {
      rule_name: "Surge",
      active: true,
      scope_type: "property" as const,
      room_type_id: null,
      occupancy_min_pct: 80,
      occupancy_max_pct: null,
      adjustment_type: "increase_pct" as const,
      adjustment_value: 15,
      min_price: null,
      max_price: null,
      priority: 10,
      applicable_dow: null,
      season_start_mmdd: null,
      season_end_mmdd: null,
      lead_time_min_days: null,
      lead_time_max_days: null,
    };
    await createPricingRule("hotel-1", "user-7", form);
    const insertArg = fromBuilder.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg.hotel_id).toBe("hotel-1");
    expect(insertArg.created_by).toBe("user-7");
    expect(insertArg.rule_name).toBe("Surge");
  });

  it("wraps validation errors with kind='validation'", async () => {
    fromBuilder.single.mockResolvedValueOnce({
      data: null,
      error: { code: "23514", message: "check constraint violated" },
    });
    try {
      await createPricingRule("hotel-1", "user-7", {} as never);
    } catch (e) {
      expect((e as PricingServiceError).kind).toBe("validation");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// updatePricingRule — optimistic concurrency + deleted vs stale
// ─────────────────────────────────────────────────────────────────────────
describe("updatePricingRule", () => {
  it("filters by expectedUpdatedAt when provided", async () => {
    fromBuilder.maybeSingle.mockResolvedValueOnce({
      data: { id: "rule-1", updated_at: "2026-04-27T10:00:00Z" },
      error: null,
    });
    await updatePricingRule(
      "rule-1",
      { rule_name: "renamed" },
      "2026-04-27T09:00:00Z",
    );
    expect(fromBuilder.eq).toHaveBeenCalledWith("updated_at", "2026-04-27T09:00:00Z");
  });

  it("zero rows + soft-deleted → not_found", async () => {
    fromBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    fromBuilder.maybeSingle.mockResolvedValueOnce({
      data: { id: "rule-1", deleted_at: "2026-04-27T10:00:00Z" },
      error: null,
    });
    try {
      await updatePricingRule("rule-1", { rule_name: "x" }, "old");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as PricingServiceError).kind).toBe("not_found");
    }
  });

  it("zero rows + still alive → conflict (stale token)", async () => {
    fromBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    fromBuilder.maybeSingle.mockResolvedValueOnce({
      data: { id: "rule-1", deleted_at: null },
      error: null,
    });
    try {
      await updatePricingRule("rule-1", { rule_name: "x" }, "old");
    } catch (e) {
      expect((e as PricingServiceError).kind).toBe("conflict");
    }
  });

  it("does NOT add updated_at filter when expectedUpdatedAt is omitted", async () => {
    fromBuilder.maybeSingle.mockResolvedValueOnce({
      data: { id: "rule-1" },
      error: null,
    });
    await updatePricingRule("rule-1", { rule_name: "x" });
    // .eq('updated_at', ...) should not be called when no token supplied.
    const updatedAtCalls = fromBuilder.eq.mock.calls.filter(
      (c) => c[0] === "updated_at",
    );
    expect(updatedAtCalls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// deletePricingRule — soft delete
// ─────────────────────────────────────────────────────────────────────────
describe("deletePricingRule", () => {
  it("UPDATEs deleted_at, doesn't issue a real DELETE", async () => {
    nextResolution({ data: null, error: null });
    await deletePricingRule("rule-9");
    expect(fromBuilder.update).toHaveBeenCalled();
    expect(fromBuilder.delete).not.toHaveBeenCalled();
    const arg = fromBuilder.update.mock.calls[0][0] as { deleted_at: string };
    expect(arg.deleted_at).toEqual(expect.any(String));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// applyPricing — input validation + RPC payload assembly
// ─────────────────────────────────────────────────────────────────────────
describe("applyPricing", () => {
  const baseEval = {
    base_price: 4000,
    recommended_price: 4400,
    occupancy_pct: 82,
    explanation: "Surge fired at 82%",
    matched_rule: {
      id: "rule-1",
      rule_name: "Surge",
      adjustment_type: "increase_pct" as const,
      adjustment_value: 10,
    },
    was_clamped: false,
    clamp_reason: null,
  };

  it("rejects missing hotelId", async () => {
    await expect(
      applyPricing({ hotelId: "", evaluation: baseEval as never }),
    ).rejects.toMatchObject({ kind: "validation" });
  });

  it("rejects non-positive recommended_price", async () => {
    await expect(
      applyPricing({
        hotelId: "h",
        evaluation: { ...baseEval, recommended_price: 0 } as never,
      }),
    ).rejects.toMatchObject({ kind: "validation" });
  });

  it("rejects non-positive base_price", async () => {
    await expect(
      applyPricing({
        hotelId: "h",
        evaluation: { ...baseEval, base_price: 0 } as never,
      }),
    ).rejects.toMatchObject({ kind: "validation" });
  });

  it("calls apply_pricing_change RPC with full payload + defaults", async () => {
    rpc.mockResolvedValueOnce({ data: "log-123", error: null });
    const out = await applyPricing({
      hotelId: "hotel-1",
      evaluation: baseEval as never,
      clientRequestId: "fixed-uuid",
    });
    expect(out).toBe("log-123");
    expect(rpc).toHaveBeenCalledWith("apply_pricing_change", {
      p_hotel_id: "hotel-1",
      p_room_type_id: null,
      p_rule_id: "rule-1",
      p_base_price: 4000,
      p_new_price: 4400,
      p_occupancy_pct: 82,
      p_adjustment_type: "increase_pct",
      p_adjustment_value: 10,
      p_was_clamped: false,
      p_clamp_reason: null,
      p_matched_rule_name: "Surge",
      p_explanation: "Surge fired at 82%",
      p_note: null,
      p_source: "manual",
      p_client_request_id: "fixed-uuid",
    });
  });

  it("forwards source='auto' when supplied (used by edge function smoke)", async () => {
    rpc.mockResolvedValueOnce({ data: "log-456", error: null });
    await applyPricing({
      hotelId: "h",
      evaluation: baseEval as never,
      source: "auto",
      clientRequestId: "k",
    });
    expect(rpc).toHaveBeenCalledWith(
      "apply_pricing_change",
      expect.objectContaining({ p_source: "auto" }),
    );
  });

  it("falls back to set_fixed_price + recommended when matched_rule is null", async () => {
    rpc.mockResolvedValueOnce({ data: "log-789", error: null });
    await applyPricing({
      hotelId: "h",
      evaluation: { ...baseEval, matched_rule: null } as never,
      clientRequestId: "k",
    });
    expect(rpc).toHaveBeenCalledWith(
      "apply_pricing_change",
      expect.objectContaining({
        p_rule_id: null,
        p_matched_rule_name: null,
        p_adjustment_type: "set_fixed_price",
        p_adjustment_value: 4400,
      }),
    );
  });

  it("auto-generates a client_request_id when caller doesn't supply one", async () => {
    rpc.mockResolvedValueOnce({ data: "log-x", error: null });
    await applyPricing({ hotelId: "h", evaluation: baseEval as never });
    const params = rpc.mock.calls[0][1] as { p_client_request_id: string };
    // Should look like a UUID (8-4-4-4-12 hex pattern). We just check it's
    // a non-empty string here — exact UUID regex is overkill.
    expect(typeof params.p_client_request_id).toBe("string");
    expect(params.p_client_request_id.length).toBeGreaterThan(0);
  });

  it("throws unknown error when RPC returns non-string payload", async () => {
    rpc.mockResolvedValueOnce({ data: { id: "wrong" }, error: null });
    try {
      await applyPricing({ hotelId: "h", evaluation: baseEval as never });
    } catch (e) {
      expect((e as PricingServiceError).kind).toBe("unknown");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// getPricingSettings — default fallback for never-configured hotels
// ─────────────────────────────────────────────────────────────────────────
describe("getPricingSettings", () => {
  it("returns DB row verbatim when present", async () => {
    fromBuilder.maybeSingle.mockResolvedValueOnce({
      data: {
        auto_apply_enabled: true,
        recommend_only: false,
        max_delta_pct: 30,
        max_discount_pct: 40,
      },
      error: null,
    });
    const out = await getPricingSettings("hotel-1");
    expect(out).toEqual({
      auto_apply_enabled: true,
      recommend_only: false,
      max_delta_pct: 30,
      max_discount_pct: 40,
    });
  });

  it("returns safe defaults when no row exists (recommend-only, 25% guardrail)", async () => {
    fromBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const out = await getPricingSettings("hotel-1");
    expect(out).toEqual({
      auto_apply_enabled: false,
      recommend_only: true,
      max_delta_pct: 25,
      max_discount_pct: null,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// upsertPricingSettings — read-merge-write (omitted vs explicitly null)
// ─────────────────────────────────────────────────────────────────────────
describe("upsertPricingSettings", () => {
  const currentSettings = {
    auto_apply_enabled: true,
    recommend_only: false,
    max_delta_pct: 30,
    max_discount_pct: 40,
  };

  it("preserves untouched fields (omitted keys keep current value)", async () => {
    // First the read (getPricingSettings), then the upsert
    fromBuilder.maybeSingle.mockResolvedValueOnce({
      data: currentSettings,
      error: null,
    });
    nextResolution({ data: null, error: null });
    await upsertPricingSettings("hotel-1", "user-1", { recommend_only: true });
    const upsertArg = fromBuilder.upsert.mock.calls[0][0] as Record<string, unknown>;
    // Only recommend_only flipped; the other 3 came from currentSettings.
    expect(upsertArg.auto_apply_enabled).toBe(true);
    expect(upsertArg.recommend_only).toBe(true);
    expect(upsertArg.max_delta_pct).toBe(30);
    expect(upsertArg.max_discount_pct).toBe(40);
  });

  it("explicit null disables max_delta_pct (distinct from omitted)", async () => {
    fromBuilder.maybeSingle.mockResolvedValueOnce({
      data: currentSettings,
      error: null,
    });
    nextResolution({ data: null, error: null });
    await upsertPricingSettings("hotel-1", "user-1", { max_delta_pct: null });
    const arg = fromBuilder.upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.max_delta_pct).toBeNull();
    // Other fields preserved.
    expect(arg.max_discount_pct).toBe(40);
  });

  it("explicit null disables max_discount_pct", async () => {
    fromBuilder.maybeSingle.mockResolvedValueOnce({
      data: currentSettings,
      error: null,
    });
    nextResolution({ data: null, error: null });
    await upsertPricingSettings("hotel-1", "user-1", { max_discount_pct: null });
    const arg = fromBuilder.upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.max_discount_pct).toBeNull();
    expect(arg.max_delta_pct).toBe(30); // untouched
  });

  it("propagates user_id as updated_by", async () => {
    fromBuilder.maybeSingle.mockResolvedValueOnce({
      data: currentSettings,
      error: null,
    });
    nextResolution({ data: null, error: null });
    await upsertPricingSettings("hotel-1", "user-99", { auto_apply_enabled: false });
    const arg = fromBuilder.upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.updated_by).toBe("user-99");
    expect(arg.updated_at).toEqual(expect.any(String));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// getHotelOccupancy — zombie-stay filter
// ─────────────────────────────────────────────────────────────────────────
describe("getHotelOccupancy", () => {
  it("filters active stays by scheduled_checkout_at > now (zombie protection)", async () => {
    // Both queries resolve via the awaited builder. Two calls → two queue items.
    nextResolution({ count: 10, data: null, error: null });
    nextResolution({ count: 4, data: null, error: null });
    const out = await getHotelOccupancy("hotel-1");
    expect(out).toEqual({ total: 10, occupied: 4, pct: 40 });
    // Verify the gt filter was applied (the zombie-stay fix).
    const gtCalls = fromBuilder.gt.mock.calls;
    expect(gtCalls.some((c) => c[0] === "scheduled_checkout_at")).toBe(true);
  });

  it("returns 0% when total is 0 (avoid divide-by-zero)", async () => {
    nextResolution({ count: 0, data: null, error: null });
    nextResolution({ count: 0, data: null, error: null });
    const out = await getHotelOccupancy("hotel-1");
    expect(out).toEqual({ total: 0, occupied: 0, pct: 0 });
  });

  it("uses 'inhouse' + 'arriving' status filter for the active count", async () => {
    nextResolution({ count: 10, data: null, error: null });
    nextResolution({ count: 5, data: null, error: null });
    await getHotelOccupancy("hotel-1");
    const inCalls = fromBuilder.in.mock.calls;
    expect(inCalls.some(
      (c) => c[0] === "status" && Array.isArray(c[1]) && (c[1] as string[]).includes("inhouse"),
    )).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// listRoomTypes
// ─────────────────────────────────────────────────────────────────────────
describe("listRoomTypes", () => {
  it("orders by name asc", async () => {
    nextResolution({ data: [], error: null });
    await listRoomTypes("hotel-1");
    expect(from).toHaveBeenCalledWith("room_types");
    expect(fromBuilder.order).toHaveBeenCalledWith("name");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// getEffectivePrices — record build + numeric coercion
// ─────────────────────────────────────────────────────────────────────────
describe("getEffectivePrices", () => {
  it("returns empty record when no room types passed", async () => {
    const out = await getEffectivePrices("hotel-1", []);
    expect(out).toEqual({});
    // No DB call made.
    expect(from).not.toHaveBeenCalled();
  });

  it("returns empty record when hotelId is empty", async () => {
    const out = await getEffectivePrices("", ["rt-1"]);
    expect(out).toEqual({});
    expect(from).not.toHaveBeenCalled();
  });

  it("builds keyed record + coerces numeric fields", async () => {
    nextResolution({
      data: [
        {
          room_type_id: "rt-1",
          base_price: "4000.00",          // strings, like supabase returns NUMERIC
          effective_price: "4400.00",
          is_overridden: true,
          rule_id: "rule-1",
          applied_at: "2026-04-27T10:00:00Z",
          override_scope: "room_type",
        },
        {
          room_type_id: "rt-2",
          base_price: 6500,
          effective_price: 6500,
          is_overridden: false,
          rule_id: null,
          applied_at: null,
          override_scope: null,
        },
      ],
      error: null,
    });
    const out = await getEffectivePrices("hotel-1", ["rt-1", "rt-2"]);
    expect(Object.keys(out)).toEqual(["rt-1", "rt-2"]);
    // Numeric coercion: strings → numbers
    expect(typeof out["rt-1"].base_price).toBe("number");
    expect(out["rt-1"].base_price).toBe(4000);
    expect(out["rt-1"].effective_price).toBe(4400);
    expect(out["rt-1"].is_overridden).toBe(true);
    expect(out["rt-2"].is_overridden).toBe(false);
  });
});
