// web/src/services/stayExtensionService.test.ts
// Unit tests for the stay-extension service layer. Mocks the supabase
// client so we can verify each helper calls the correct RPC with the
// correct arguments and wraps errors into PricingServiceError.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock the supabase client BEFORE importing the service ──
// The service imports `../lib/supabase` which is the singleton client.
// We replace its methods per test so we can assert call shape.
const rpc = vi.fn();
const fromSelect = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
};
const from = vi.fn((_table: string) => fromSelect);

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (name: string, params?: unknown) => rpc(name, params),
    from: (table: string) => from(table),
  },
}));

import {
  approveStayExtension,
  cancelStayExtension,
  listExtensionsForStay,
  listPendingExtensions,
  rejectStayExtension,
  requestStayExtension,
} from "./stayExtensionService";
import { PricingServiceError } from "./pricingService";

beforeEach(() => {
  rpc.mockReset();
  from.mockClear();
  fromSelect.select.mockClear();
  fromSelect.eq.mockClear();
  fromSelect.order.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────
// requestStayExtension
// ─────────────────────────────────────────────────────────────────────────
describe("requestStayExtension", () => {
  it("calls request_stay_extension RPC with mapped params", async () => {
    rpc.mockResolvedValueOnce({ data: "req-id-123", error: null });
    const id = await requestStayExtension({
      stayId: "stay-1",
      requestedCheckoutDate: "2026-05-01",
      guestNote: "Need one more night",
    });
    expect(id).toBe("req-id-123");
    expect(rpc).toHaveBeenCalledWith("request_stay_extension", {
      p_stay_id: "stay-1",
      p_requested_checkout_date: "2026-05-01",
      p_guest_note: "Need one more night",
    });
  });

  it("passes null when guestNote is omitted", async () => {
    rpc.mockResolvedValueOnce({ data: "req-2", error: null });
    await requestStayExtension({
      stayId: "stay-2",
      requestedCheckoutDate: "2026-05-02",
    });
    expect(rpc).toHaveBeenCalledWith(
      "request_stay_extension",
      expect.objectContaining({ p_guest_note: null }),
    );
  });

  it("wraps RPC errors as PricingServiceError", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "permission denied" },
    });
    await expect(
      requestStayExtension({ stayId: "x", requestedCheckoutDate: "2026-05-03" }),
    ).rejects.toBeInstanceOf(PricingServiceError);
  });

  it("rejects with permission_denied kind on 42501", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "RLS denied" },
    });
    try {
      await requestStayExtension({ stayId: "x", requestedCheckoutDate: "2026-05-03" });
    } catch (e) {
      expect(e).toBeInstanceOf(PricingServiceError);
      expect((e as PricingServiceError).kind).toBe("permission_denied");
    }
  });

  it("throws unknown error when RPC returns non-string data", async () => {
    rpc.mockResolvedValueOnce({ data: { id: "nope" }, error: null });
    await expect(
      requestStayExtension({ stayId: "x", requestedCheckoutDate: "2026-05-03" }),
    ).rejects.toBeInstanceOf(PricingServiceError);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// approveStayExtension
// ─────────────────────────────────────────────────────────────────────────
describe("approveStayExtension", () => {
  it("forwards additionalAmount and staffNote", async () => {
    rpc.mockResolvedValueOnce({ data: "stay-789", error: null });
    await approveStayExtension({
      requestId: "req-7",
      additionalAmount: 4500,
      staffNote: "Approved by GM",
    });
    expect(rpc).toHaveBeenCalledWith("approve_stay_extension", {
      p_request_id: "req-7",
      p_additional_amount: 4500,
      p_staff_note: "Approved by GM",
    });
  });

  it("passes null amount when waiving the charge", async () => {
    rpc.mockResolvedValueOnce({ data: "stay-1", error: null });
    await approveStayExtension({ requestId: "req-1" });
    expect(rpc).toHaveBeenCalledWith(
      "approve_stay_extension",
      expect.objectContaining({ p_additional_amount: null, p_staff_note: null }),
    );
  });

  it("treats explicit null amount as waiver (preserves null)", async () => {
    rpc.mockResolvedValueOnce({ data: "stay-1", error: null });
    await approveStayExtension({ requestId: "req-1", additionalAmount: null });
    expect(rpc).toHaveBeenCalledWith(
      "approve_stay_extension",
      expect.objectContaining({ p_additional_amount: null }),
    );
  });

  it("wraps inventory-conflict (server raises) as PricingServiceError", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "P0001",
        message: "Cannot extend: room is reserved for Booking ABC starting 2026-05-02",
      },
    });
    await expect(
      approveStayExtension({ requestId: "req-x" }),
    ).rejects.toBeInstanceOf(PricingServiceError);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// rejectStayExtension
// ─────────────────────────────────────────────────────────────────────────
describe("rejectStayExtension", () => {
  it("calls reject RPC with note", async () => {
    rpc.mockResolvedValueOnce({ data: "req-9", error: null });
    await rejectStayExtension({ requestId: "req-9", staffNote: "Hotel full" });
    expect(rpc).toHaveBeenCalledWith("reject_stay_extension", {
      p_request_id: "req-9",
      p_staff_note: "Hotel full",
    });
  });

  it("passes null note when omitted", async () => {
    rpc.mockResolvedValueOnce({ data: "req-9", error: null });
    await rejectStayExtension({ requestId: "req-9" });
    expect(rpc).toHaveBeenCalledWith(
      "reject_stay_extension",
      expect.objectContaining({ p_staff_note: null }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// cancelStayExtension
// ─────────────────────────────────────────────────────────────────────────
describe("cancelStayExtension", () => {
  it("forwards request id only", async () => {
    rpc.mockResolvedValueOnce({ data: "req-c", error: null });
    const out = await cancelStayExtension("req-c");
    expect(out).toBe("req-c");
    expect(rpc).toHaveBeenCalledWith("cancel_stay_extension", {
      p_request_id: "req-c",
    });
  });

  it("rejects when caller has no permission", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "P0001",
        message: "Only the guest or hotel staff can cancel this request",
      },
    });
    await expect(cancelStayExtension("req-c")).rejects.toBeInstanceOf(
      PricingServiceError,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// listPendingExtensions / listExtensionsForStay
// ─────────────────────────────────────────────────────────────────────────
describe("listPendingExtensions", () => {
  it("queries by hotel_id + status='pending', orders by requested_at asc", async () => {
    fromSelect.order.mockResolvedValueOnce({ data: [], error: null });
    await listPendingExtensions("hotel-1");
    expect(from).toHaveBeenCalledWith("stay_extension_requests");
    expect(fromSelect.eq).toHaveBeenCalledWith("hotel_id", "hotel-1");
    expect(fromSelect.eq).toHaveBeenCalledWith("status", "pending");
    expect(fromSelect.order).toHaveBeenCalledWith("requested_at", { ascending: true });
  });

  it("returns empty array when data is null", async () => {
    fromSelect.order.mockResolvedValueOnce({ data: null, error: null });
    const out = await listPendingExtensions("hotel-1");
    expect(out).toEqual([]);
  });
});

describe("listExtensionsForStay", () => {
  it("queries by stay_id, orders by requested_at desc (newest first)", async () => {
    fromSelect.order.mockResolvedValueOnce({ data: [], error: null });
    await listExtensionsForStay("stay-42");
    expect(fromSelect.eq).toHaveBeenCalledWith("stay_id", "stay-42");
    expect(fromSelect.order).toHaveBeenCalledWith("requested_at", { ascending: false });
  });
});
