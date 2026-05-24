// web/src/services/rateService.test.ts
// Comprehensive unit tests for the rate management service layer.
// Mocks the supabase client and asserts each helper's call shape and
// (where logic exists) the return-value transformation.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock supabase client BEFORE service import ───
//
// We use a "thenable builder" so chains of arbitrary length work:
//   from('t').select(...).eq(...).order(...).order(...).order(...)
// All chainable methods return the same builder. Only `await`-ing the
// builder (or calling `.single()` / `.maybeSingle()`) resolves it to the
// configured response. Tests set the response via `nextResolution(...)`
// or, for terminal-method calls, `fromBuilder.single.mockResolvedValueOnce`.

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
  // PromiseLike interface so `await fromBuilder` works.
  then: (
    onResolve: (value: { data: unknown; error: unknown }) => unknown,
  ) => Promise<unknown>;
};

const fromBuilder = {} as ThenableBuilder;

// Per-test configuration: queue of awaited resolutions (FIFO).
let resolutionQueue: Array<{ data: unknown; error: unknown }> = [];

function nextResolution(value: { data: unknown; error: unknown }) {
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

// `then` makes the builder a PromiseLike. When awaited, dequeue the next
// resolution. If none queued, resolve with `{ data: null, error: null }`
// so noisy tests don't crash.
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
  canGrantDiscount,
  createRatePlan,
  createRatePlanWithPrices,
  deletePlanPrice,
  deleteRatePlan,
  deleteRestriction,
  getEffectivePriceForDate,
  getMonthlyDiscountSummary,
  isClosedToDeparture,
  listPlanPrices,
  listRatePlans,
  listRestrictions,
  listRestrictionsForStay,
  updateRatePlan,
  upsertPlanPrice,
  upsertRestriction,
} from "./rateService";
import { PricingServiceError } from "./pricingService";

beforeEach(() => {
  rpc.mockReset();
  from.mockClear();
  resolutionQueue = [];
  // Reset call history on chainables but keep their implementation
  // (returning fromBuilder for continued chaining).
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
// listRatePlans
// ─────────────────────────────────────────────────────────────────────────
describe("listRatePlans", () => {
  it("queries rate_plans with deleted_at IS NULL and triple ordering", async () => {
    nextResolution({ data: [], error: null });
    await listRatePlans("hotel-1");
    expect(from).toHaveBeenCalledWith("rate_plans");
    expect(fromBuilder.eq).toHaveBeenCalledWith("hotel_id", "hotel-1");
    expect(fromBuilder.is).toHaveBeenCalledWith("deleted_at", null);
    // is_default desc → priority desc → name asc
    expect(fromBuilder.order).toHaveBeenCalledWith("is_default", { ascending: false });
    expect(fromBuilder.order).toHaveBeenCalledWith("priority", { ascending: false });
    expect(fromBuilder.order).toHaveBeenCalledWith("name", { ascending: true });
  });

  it("returns empty array when data is null", async () => {
    nextResolution({ data: null, error: null });
    expect(await listRatePlans("hotel-1")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// createRatePlan — clears existing default when new plan is_default=true
// ─────────────────────────────────────────────────────────────────────────
describe("createRatePlan", () => {
  it("clears existing default flag before inserting when is_default=true", async () => {
    // First: clearDefaultFlag → update rate_plans set is_default=false
    nextResolution({ data: null, error: null });
    // Second: insert returns the new row
    fromBuilder.single.mockResolvedValueOnce({
      data: { id: "plan-1", name: "BAR", is_default: true },
      error: null,
    });
    await createRatePlan("hotel-1", {
      name: "BAR",
      plan_code: "BAR",
      description: null,
      meal_code: "EP",
      cancellation_policy: null,
      refundable: true,
      channel_scope: "all",
      priority: 100,
      is_default: true,
      min_advance_days: null,
      max_advance_days: null,
    });
    // Assert update for clearing AND insert for creating both happened.
    expect(fromBuilder.update).toHaveBeenCalledWith({ is_default: false });
    expect(fromBuilder.insert).toHaveBeenCalled();
  });

  it("skips clearing when is_default=false", async () => {
    fromBuilder.single.mockResolvedValueOnce({
      data: { id: "plan-2" },
      error: null,
    });
    await createRatePlan("hotel-1", {
      name: "Corporate",
      plan_code: "CORP",
      description: null,
      meal_code: null,
      cancellation_policy: null,
      refundable: true,
      channel_scope: "corporate",
      priority: 50,
      is_default: false,
      min_advance_days: null,
      max_advance_days: null,
    });
    expect(fromBuilder.update).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// updateRatePlan — optimistic concurrency + 404-vs-conflict branch
// ─────────────────────────────────────────────────────────────────────────
describe("updateRatePlan", () => {
  it("appends expectedUpdatedAt as a WHERE filter when supplied", async () => {
    fromBuilder.maybeSingle.mockResolvedValueOnce({
      data: { id: "plan-7", updated_at: "2026-04-27T10:00:00Z" },
      error: null,
    });
    await updateRatePlan(
      "plan-7",
      "hotel-1",
      { name: "BAR v2" },
      "2026-04-27T09:00:00Z",
    );
    expect(fromBuilder.eq).toHaveBeenCalledWith("updated_at", "2026-04-27T09:00:00Z");
  });

  it("throws not_found when zero-row match AND row was soft-deleted", async () => {
    // First call (update + maybeSingle): zero rows
    fromBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    // Second call (re-read for diagnosis): row has deleted_at set
    fromBuilder.maybeSingle.mockResolvedValueOnce({
      data: { id: "plan-7", deleted_at: "2026-04-27T10:00:00Z" },
      error: null,
    });
    try {
      await updateRatePlan("plan-7", "hotel-1", { name: "x" }, "old-ts");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PricingServiceError);
      expect((e as PricingServiceError).kind).toBe("not_found");
    }
  });

  it("throws conflict when zero-row match AND row still alive (stale token)", async () => {
    fromBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    fromBuilder.maybeSingle.mockResolvedValueOnce({
      data: { id: "plan-7", deleted_at: null },
      error: null,
    });
    try {
      await updateRatePlan("plan-7", "hotel-1", { name: "x" }, "old-ts");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PricingServiceError);
      expect((e as PricingServiceError).kind).toBe("conflict");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// deleteRatePlan — soft delete (UPDATE deleted_at, not DELETE)
// ─────────────────────────────────────────────────────────────────────────
describe("deleteRatePlan", () => {
  it("soft-deletes via update of deleted_at, not a real DELETE", async () => {
    nextResolution({ data: null, error: null });
    await deleteRatePlan("plan-9");
    expect(fromBuilder.update).toHaveBeenCalled();
    expect(fromBuilder.delete).not.toHaveBeenCalled();
    // deleted_at gets a new timestamp
    const updateArg = fromBuilder.update.mock.calls[0][0] as { deleted_at: string };
    expect(updateArg.deleted_at).toEqual(expect.any(String));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// createRatePlanWithPrices — transactional path + rollback
// ─────────────────────────────────────────────────────────────────────────
describe("createRatePlanWithPrices", () => {
  const baseForm = {
    name: "BAR",
    plan_code: "BAR",
    description: null,
    meal_code: null,
    cancellation_policy: null,
    refundable: true,
    channel_scope: "all" as const,
    priority: 100,
    is_default: false,
    min_advance_days: null,
    max_advance_days: null,
  };

  it("returns plan with no prices inserted when prices array is empty", async () => {
    fromBuilder.single.mockResolvedValueOnce({
      data: { id: "plan-10" },
      error: null,
    });
    const out = await createRatePlanWithPrices("hotel-1", baseForm, []);
    expect(out).toEqual({ id: "plan-10" });
    // Insert was called once for the plan but never for prices.
    expect(fromBuilder.insert).toHaveBeenCalledTimes(1);
  });

  it("inserts prices in a single batch after creating the plan", async () => {
    fromBuilder.single.mockResolvedValueOnce({
      data: { id: "plan-11" },
      error: null,
    });
    nextResolution({ data: null, error: null });
    await createRatePlanWithPrices("hotel-1", baseForm, [
      { room_type_id: "rt-1", price: 4000 },
      { room_type_id: "rt-2", price: 6500 },
    ]);
    // Two insert calls total: one for plan, one for prices (batch).
    expect(fromBuilder.insert).toHaveBeenCalledTimes(2);
    const pricesPayload = fromBuilder.insert.mock.calls[1][0] as Array<{
      hotel_id: string;
      rate_plan_id: string;
      room_type_id: string;
      price: number;
      dow_mask: number;
    }>;
    expect(pricesPayload).toHaveLength(2);
    expect(pricesPayload[0]).toMatchObject({
      hotel_id: "hotel-1",
      rate_plan_id: "plan-11",
      room_type_id: "rt-1",
      price: 4000,
      dow_mask: 127,
      priority: 100,
    });
  });

  it("filters out non-positive / non-finite prices before insert", async () => {
    fromBuilder.single.mockResolvedValueOnce({
      data: { id: "plan-12" },
      error: null,
    });
    nextResolution({ data: null, error: null });
    await createRatePlanWithPrices("hotel-1", baseForm, [
      { room_type_id: "rt-1", price: 4000 },
      { room_type_id: "rt-bad-zero", price: 0 },
      { room_type_id: "rt-bad-neg", price: -50 },
      { room_type_id: "rt-bad-nan", price: NaN },
    ]);
    const pricesPayload = fromBuilder.insert.mock.calls[1][0] as Array<unknown>;
    expect(pricesPayload).toHaveLength(1);
  });

  it("rolls back the plan via soft-delete when price insert fails", async () => {
    fromBuilder.single.mockResolvedValueOnce({
      data: { id: "plan-13" },
      error: null,
    });
    // Price insert errors (chainable terminal — use queue)
    nextResolution({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    // Rollback is an update on rate_plans → returns success
    nextResolution({ data: null, error: null });

    await expect(
      createRatePlanWithPrices("hotel-1", baseForm, [
        { room_type_id: "rt-1", price: 4000 },
      ]),
    ).rejects.toBeInstanceOf(PricingServiceError);

    // Verify rollback: update on rate_plans set deleted_at
    const updateArgs = fromBuilder.update.mock.calls.find((args) => {
      const arg = args[0] as { deleted_at?: string } | undefined;
      return arg && typeof arg.deleted_at === "string";
    });
    expect(updateArgs).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// listPlanPrices / upsertPlanPrice / deletePlanPrice
// ─────────────────────────────────────────────────────────────────────────
describe("listPlanPrices", () => {
  it("queries by hotel + plan, ordered by room_type then priority desc", async () => {
    nextResolution({ data: [], error: null });
    await listPlanPrices("hotel-1", "plan-1");
    expect(fromBuilder.eq).toHaveBeenCalledWith("hotel_id", "hotel-1");
    expect(fromBuilder.eq).toHaveBeenCalledWith("rate_plan_id", "plan-1");
    expect(fromBuilder.order).toHaveBeenCalledWith("room_type_id", { ascending: true });
    expect(fromBuilder.order).toHaveBeenCalledWith("priority", { ascending: false });
  });
});

describe("upsertPlanPrice", () => {
  const baseForm = {
    rate_plan_id: "plan-1",
    room_type_id: "rt-1",
    price: 5000,
    valid_from: null,
    valid_to: null,
    dow_mask: 127,
    priority: 100,
    notes: null,
  };

  it("does INSERT path when no id supplied", async () => {
    fromBuilder.single.mockResolvedValueOnce({
      data: { id: "price-1", price: 5000 },
      error: null,
    });
    await upsertPlanPrice("hotel-1", baseForm);
    expect(fromBuilder.insert).toHaveBeenCalled();
    expect(fromBuilder.update).not.toHaveBeenCalled();
  });

  it("does UPDATE path when id supplied", async () => {
    fromBuilder.single.mockResolvedValueOnce({
      data: { id: "price-99", price: 6000 },
      error: null,
    });
    await upsertPlanPrice("hotel-1", { ...baseForm, id: "price-99" });
    expect(fromBuilder.update).toHaveBeenCalled();
    expect(fromBuilder.eq).toHaveBeenCalledWith("id", "price-99");
  });
});

describe("deletePlanPrice", () => {
  it("issues a real DELETE filtered by id", async () => {
    nextResolution({ data: null, error: null });
    await deletePlanPrice("price-x");
    expect(fromBuilder.delete).toHaveBeenCalled();
    expect(fromBuilder.eq).toHaveBeenCalledWith("id", "price-x");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Restrictions CRUD
// ─────────────────────────────────────────────────────────────────────────
describe("listRestrictions", () => {
  it("filters by date range gte..lte", async () => {
    nextResolution({ data: [], error: null });
    await listRestrictions("hotel-1", "2026-04-01", "2026-04-30");
    expect(fromBuilder.gte).toHaveBeenCalledWith("date", "2026-04-01");
    expect(fromBuilder.lte).toHaveBeenCalledWith("date", "2026-04-30");
  });
});

describe("upsertRestriction", () => {
  it("UPDATE path when id supplied", async () => {
    fromBuilder.single.mockResolvedValueOnce({
      data: { id: "r-1" },
      error: null,
    });
    await upsertRestriction("hotel-1", {
      id: "r-1",
      date: "2026-05-01",
      stop_sell: true,
    });
    expect(fromBuilder.update).toHaveBeenCalled();
  });

  it("INSERT path when id missing", async () => {
    fromBuilder.single.mockResolvedValueOnce({
      data: { id: "r-new" },
      error: null,
    });
    await upsertRestriction("hotel-1", { date: "2026-05-01", min_los: 2 });
    expect(fromBuilder.insert).toHaveBeenCalled();
    expect(fromBuilder.update).not.toHaveBeenCalled();
  });
});

describe("deleteRestriction", () => {
  it("real DELETE by id", async () => {
    nextResolution({ data: null, error: null });
    await deleteRestriction("r-99");
    expect(fromBuilder.delete).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// canGrantDiscount — fail-closed on errors
// ─────────────────────────────────────────────────────────────────────────
describe("canGrantDiscount", () => {
  it("returns true when RPC returns true", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await canGrantDiscount("hotel-1")).toBe(true);
    expect(rpc).toHaveBeenCalledWith("vaiyu_is_hotel_finance_manager", {
      p_hotel_id: "hotel-1",
    });
  });

  it("returns false when RPC returns false", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await canGrantDiscount("hotel-1")).toBe(false);
  });

  it("FAILS CLOSED when RPC errors (security default)", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST116", message: "network error" },
    });
    expect(await canGrantDiscount("hotel-1")).toBe(false);
  });

  it("returns false when hotelId is empty", async () => {
    expect(await canGrantDiscount("")).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// isClosedToDeparture — soft-fail on errors
// ─────────────────────────────────────────────────────────────────────────
describe("isClosedToDeparture", () => {
  it("returns true when RPC says CTD", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await isClosedToDeparture("hotel-1", "rt-1", "2026-05-01")).toBe(true);
    expect(rpc).toHaveBeenCalledWith("is_closed_to_departure", {
      p_hotel_id: "hotel-1",
      p_room_type_id: "rt-1",
      p_date: "2026-05-01",
    });
  });

  it("returns false when RPC errors (don't accidentally block checkouts)", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "something broke" },
    });
    expect(await isClosedToDeparture("hotel-1", null, "2026-05-01")).toBe(false);
  });

  it("returns false on empty inputs", async () => {
    expect(await isClosedToDeparture("", "rt-1", "2026-05-01")).toBe(false);
    expect(await isClosedToDeparture("hotel-1", "rt-1", "")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// getMonthlyDiscountSummary — aggregation logic
// ─────────────────────────────────────────────────────────────────────────
describe("getMonthlyDiscountSummary", () => {
  it("aggregates total + per-reason breakdown sorted by amount desc", async () => {
    nextResolution({
      data: [
        { reason_code: "manager_discretion", total_discount: 500 },
        { reason_code: "manager_discretion", total_discount: 300 },
        { reason_code: "loyalty", total_discount: 1500 },
        { reason_code: "service_recovery", total_discount: 200 },
      ],
      error: null,
    });
    const out = await getMonthlyDiscountSummary("hotel-1", "2026-04");

    expect(out.total_amount).toBe(2500);
    expect(out.count).toBe(4);
    // First entry is the highest-amount reason (loyalty: 1500)
    expect(out.by_reason[0]).toEqual({
      reason_code: "loyalty",
      amount: 1500,
      count: 1,
    });
    // manager_discretion appears second (500+300=800)
    expect(out.by_reason[1]).toEqual({
      reason_code: "manager_discretion",
      amount: 800,
      count: 2,
    });
  });

  it("returns zeros when no rows in the month", async () => {
    nextResolution({ data: [], error: null });
    const out = await getMonthlyDiscountSummary("hotel-1", "2026-04");
    expect(out).toEqual({ total_amount: 0, count: 0, by_reason: [] });
  });

  it("computes correct date bounds for the month", async () => {
    nextResolution({ data: [], error: null });
    await getMonthlyDiscountSummary("hotel-1", "2026-04");
    // Start: 2026-04-01T00:00:00Z; End (exclusive): 2026-05-01T00:00:00Z
    expect(fromBuilder.gte).toHaveBeenCalledWith("created_at", "2026-04-01T00:00:00Z");
    expect(fromBuilder.lt).toHaveBeenCalledWith("created_at", "2026-05-01T00:00:00.000Z");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// listRestrictionsForStay — the most logic-heavy helper
// ─────────────────────────────────────────────────────────────────────────
describe("listRestrictionsForStay", () => {
  const checkin = "2026-05-01";
  const checkout = "2026-05-04"; // 3-night stay

  it("returns empty record when allRoomTypeIds is empty", async () => {
    const out = await listRestrictionsForStay("hotel-1", checkin, checkout, []);
    expect(out).toEqual({});
    expect(fromBuilder.lt).not.toHaveBeenCalled();
  });

  it("seeds every requested room type even when DB returns no restrictions", async () => {
    nextResolution({ data: [], error: null });
    const out = await listRestrictionsForStay("hotel-1", checkin, checkout, [
      "rt-deluxe",
      "rt-suite",
    ]);
    expect(Object.keys(out)).toHaveLength(2);
    expect(out["rt-deluxe"]).toEqual({
      room_type_id: "rt-deluxe",
      any_stop_sell: false,
      any_cta: false,
      max_min_los: null,
    });
  });

  it("aggregates stop_sell across all nights (any night triggers it)", async () => {
    nextResolution({
      data: [
        {
          room_type_id: "rt-deluxe",
          date: "2026-05-02", // mid-stay night
          min_los: null,
          closed_to_arrival: false,
          closed_to_departure: false,
          stop_sell: true,
        },
      ],
      error: null,
    });
    const out = await listRestrictionsForStay("hotel-1", checkin, checkout, [
      "rt-deluxe",
    ]);
    expect(out["rt-deluxe"].any_stop_sell).toBe(true);
  });

  it("only counts CTA on the check-in date (not mid-stay)", async () => {
    nextResolution({
      data: [
        {
          room_type_id: "rt-deluxe",
          date: "2026-05-02", // mid-stay — CTA shouldn't matter here
          min_los: null,
          closed_to_arrival: true,
          closed_to_departure: false,
          stop_sell: false,
        },
      ],
      error: null,
    });
    const out = await listRestrictionsForStay("hotel-1", checkin, checkout, [
      "rt-deluxe",
    ]);
    expect(out["rt-deluxe"].any_cta).toBe(false);
  });

  it("counts CTA on the check-in date itself", async () => {
    nextResolution({
      data: [
        {
          room_type_id: "rt-deluxe",
          date: checkin,
          min_los: null,
          closed_to_arrival: true,
          closed_to_departure: false,
          stop_sell: false,
        },
      ],
      error: null,
    });
    const out = await listRestrictionsForStay("hotel-1", checkin, checkout, [
      "rt-deluxe",
    ]);
    expect(out["rt-deluxe"].any_cta).toBe(true);
  });

  it("only honours min_los on the check-in date and tracks the largest value", async () => {
    nextResolution({
      data: [
        // Mid-stay min_los is ignored
        {
          room_type_id: "rt-deluxe",
          date: "2026-05-02",
          min_los: 99,
          closed_to_arrival: false,
          closed_to_departure: false,
          stop_sell: false,
        },
        // Check-in date min_los counts
        {
          room_type_id: "rt-deluxe",
          date: checkin,
          min_los: 3,
          closed_to_arrival: false,
          closed_to_departure: false,
          stop_sell: false,
        },
      ],
      error: null,
    });
    const out = await listRestrictionsForStay("hotel-1", checkin, checkout, [
      "rt-deluxe",
    ]);
    expect(out["rt-deluxe"].max_min_los).toBe(3);
  });

  it("propagates a NULL room_type_id restriction (property-wide) to ALL room types", async () => {
    nextResolution({
      data: [
        {
          room_type_id: null,
          date: checkin,
          min_los: null,
          closed_to_arrival: false,
          closed_to_departure: false,
          stop_sell: true,
        },
      ],
      error: null,
    });
    const out = await listRestrictionsForStay("hotel-1", checkin, checkout, [
      "rt-deluxe",
      "rt-suite",
      "rt-studio",
    ]);
    expect(out["rt-deluxe"].any_stop_sell).toBe(true);
    expect(out["rt-suite"].any_stop_sell).toBe(true);
    expect(out["rt-studio"].any_stop_sell).toBe(true);
  });

  it("ignores restrictions for room types not in the allRoomTypeIds list", async () => {
    nextResolution({
      data: [
        {
          room_type_id: "rt-irrelevant",
          date: checkin,
          min_los: null,
          closed_to_arrival: false,
          closed_to_departure: false,
          stop_sell: true,
        },
      ],
      error: null,
    });
    const out = await listRestrictionsForStay("hotel-1", checkin, checkout, [
      "rt-deluxe",
    ]);
    // rt-irrelevant should not appear in output, rt-deluxe should be unaffected
    expect(Object.keys(out)).toEqual(["rt-deluxe"]);
    expect(out["rt-deluxe"].any_stop_sell).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// getEffectivePriceForDate — RPC + null fallback
// ─────────────────────────────────────────────────────────────────────────
describe("getEffectivePriceForDate", () => {
  it("calls RPC and returns first row", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        {
          base_price: 4000,
          effective_price: 4400,
          is_overridden: true,
          rule_id: "rule-1",
          applied_at: "2026-04-27T10:00:00Z",
          override_scope: "room_type",
          rate_plan_id: "plan-1",
          rate_plan_name: "BAR",
        },
      ],
      error: null,
    });
    const out = await getEffectivePriceForDate("hotel-1", "rt-1", "2026-05-01");
    expect(out.effective_price).toBe(4400);
    expect(out.is_overridden).toBe(true);
    expect(rpc).toHaveBeenCalledWith("get_effective_room_price", {
      p_hotel_id: "hotel-1",
      p_room_type_id: "rt-1",
      p_date: "2026-05-01",
    });
  });

  it("returns null-shaped record when RPC returns empty array", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    const out = await getEffectivePriceForDate("hotel-1", "rt-1", "2026-05-01");
    expect(out.base_price).toBeNull();
    expect(out.effective_price).toBeNull();
    expect(out.is_overridden).toBe(false);
  });
});
