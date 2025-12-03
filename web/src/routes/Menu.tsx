// web/src/routes/Menu.tsx

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import {
  getServices,
  getMenu,
  createTicket,
  createOrder,
  isDemo,
} from "../lib/api";
import { dbg, dbgError } from "../lib/debug";

type Service = { key: string; label_en: string; sla_minutes: number };
type FoodItem = { item_key: string; name: string; base_price: number };

export default function Menu() {
  // booking code from route: /stay/:code/menu  (fallback to DEMO)
  const { code = "DEMO" } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // --- tab from query (?tab=services|food), default = services ---
  const initialTabParam = (searchParams.get("tab") || "").toLowerCase();
  const initialTab: "food" | "services" =
    initialTabParam === "food" ? "food" : "services";
  const [tab, setTab] = useState<"food" | "services">(initialTab);

  // Keep tab in sync if URL query changes (e.g. user clicks different card)
  useEffect(() => {
    const q = (searchParams.get("tab") || "").toLowerCase();
    const next: "food" | "services" = q === "food" ? "food" : "services";
    setTab(next);
  }, [searchParams]);

  // hotel identifier from query (generic key: id OR slug)
  // - ?hotelId=<uuid>            (preferred from StayQuickLinks)
  // - ?hotelSlug=TENANT1         (older pattern)
  // - ?hotel=TENANT1|<uuid>      (scan / WhatsApp - may be slug or id)
  const hotelKeyFromQuery =
    searchParams.get("hotelId") ||
    searchParams.get("hotelSlug") ||
    searchParams.get("hotel") ||
    undefined;

  const [services, setServices] = useState<Service[]>([]);
  const [food, setFood] = useState<FoodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Room picker + toast + busy indicator
  const roomKey = useMemo(() => `room:${code}`, [code]);
  const [room, setRoom] = useState<string>(
    () =>
      (typeof window !== "undefined" ? localStorage.getItem(roomKey) : null) ||
      "201"
  );
  const [toast, setToast] = useState<string>("");
  const [busy, setBusy] = useState<string>(""); // keeps the id of item being actioned

  // Tracks what the guest has added in this page (session only)
  const [sessionOrderCounts, setSessionOrderCounts] = useState<
    Record<string, number>
  >({});

  // Load services + menu whenever the hotel key changes
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setErr(null);

    (async () => {
      try {
        const [svc, menu] = await Promise.all([
          getServices(hotelKeyFromQuery),
          getMenu(hotelKeyFromQuery),
        ]);

        if (!mounted) return;

        const svcItems = normalizeServices(svc);
        const foodItems = normalizeMenu(menu);

        setServices(svcItems);
        setFood(foodItems);
      } catch (e: any) {
        if (!mounted) return;
        console.error("[Menu] load error", e);
        setErr(e?.message || "Failed to load menu");
        setServices([]);
        setFood([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [hotelKeyFromQuery]);

  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem(roomKey, room);
      }
    } catch {
      // ignore localStorage errors
    }
  }, [room, roomKey]);

  function showToast(msg: string) {
    setToast(msg);
    if (typeof window === "undefined") return;
    window.setTimeout(() => setToast(""), 1500);
  }

  // ---- Helpers that accept multiple API response shapes ----
  function extractTicketId(res: any): string | undefined {
    return (
      res?.ticket?.id ??
      res?.id ??
      res?.data?.id ??
      res?.ticket_id ??
      res?.ticketId ??
      undefined
    );
  }

  function looksLikeUuid(value: string | undefined | null): boolean {
    if (!value) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    );
  }

  // ---------- SERVICES → TICKETS (with tracker redirect) ----------
  async function requestService(service: Service) {
    const service_key = service.key;
    const busyKey = `svc:${service_key}`;
    setBusy(busyKey);

    dbg("Menu.requestService.start", {
      service_key,
      room,
      bookingCode: code,
      hotelKeyFromQuery,
    });

    try {
      // Decide whether the hotel key is an ID or a slug.
      let hotelId: string | undefined;
      let hotelSlug: string | undefined;

      if (hotelKeyFromQuery) {
        if (looksLikeUuid(hotelKeyFromQuery)) {
          hotelId = hotelKeyFromQuery;
        } else {
          hotelSlug = hotelKeyFromQuery;
        }
      }

      // Build a backward-compatible payload that works with:
      // - Supabase Edge Function /tickets (hotelId | hotelSlug, serviceKey, bookingCode, room, source, priority)
      // - Older Node/demo backends (booking, booking_code, service_key, key, label)
      const payload: any = {
        // Service identity (accept multiple shapes)
        serviceKey: service_key,
        service_key,
        key: service_key,

        // Human label for title (fallback to generic)
        title: service.label_en || "Ticket",
        label: service.label_en,
        label_en: service.label_en,

        // Guest context
        room,
        bookingCode: code,
        booking_code: code,
        booking: code,

        // Meta
        source: "guest", // valid value for ticket_source enum
        priority: "normal",
        tenant: "guest",
      };

      if (hotelId) {
        payload.hotelId = hotelId;
      }
      if (hotelSlug) {
        payload.hotelSlug = hotelSlug;
      }

      dbg("Menu.requestService.payload", payload);

      const res: any = await createTicket(payload);

      dbg("Menu.requestService.response", res);

      const id = extractTicketId(res);

      if (id) {
        const url = `/requestTracker/${encodeURIComponent(id)}`;
        dbg("Menu.requestService.navigate", { id, url });

        // ✅ Client-side navigation – avoids Netlify 404
        navigate(url);
        return;
      }

      // If no ID but OK flag, just confirm
      if (res?.ok) {
        dbg("Menu.requestService.noIdButOk", res);
        showToast("Request placed");
        return;
      }

      throw new Error("Could not create request");
    } catch (e: any) {
      dbgError("Menu.requestService.error", e);
      console.error("[Menu] requestService error", e);
      alert(e?.message || "Could not create request");
    } finally {
      setBusy((current) => (current === busyKey ? "" : current));
    }
  }

  // ---------- FOOD → ORDERS (unchanged behaviour) ----------
  async function addFood(item_key: string, displayName?: string) {
    const busyKey = `food:${item_key}`;
    setBusy(busyKey);
    try {
      const res: any = await createOrder({
        item_key,
        qty: 1,
        booking: code,
        source: "guest_menu",
      });

      // Keep old behaviour: success unless explicitly ok === false
      if (res?.ok === false) {
        throw new Error("Could not add item");
      }

      // Toast with item name
      showToast(`${displayName || "Item"} added to order`);

      // Update in-page summary
      setSessionOrderCounts((prev) => ({
        ...prev,
        [item_key]: (prev[item_key] || 0) + 1,
      }));
    } catch (e: any) {
      console.error("[Menu] addFood error", e);
      alert(e?.message || "Could not add item");
    } finally {
      setBusy((current) => (current === busyKey ? "" : current));
    }
  }

  return (
    <main className="max-w-xl mx-auto p-4">
      {/* Heading + context */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">Guest menu</h1>
          {isDemo() && (
            <span className="px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-800">
              Demo data
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500">
          Booking: <b>{code}</b>
        </div>
      </div>

      {/* Tabs + Room selector */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          <button
            onClick={() => setTab("services")}
            className={`px-3 py-2 rounded ${
              tab === "services" ? "bg-sky-500 text-white" : "bg-white shadow"
            }`}
          >
            Services
          </button>
          <button
            onClick={() => setTab("food")}
            className={`px-3 py-2 rounded ${
              tab === "food" ? "bg-sky-500 text-white" : "bg-white shadow"
            }`}
          >
            Food
          </button>
        </div>

        <label className="text-sm text-gray-600">
          Room{" "}
          <select
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            className="border rounded px-2 py-1"
          >
            {["201", "202", "203", "204", "205"].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Loading / error / empty states */}
      {loading && <div className="text-gray-500">Loading…</div>}
      {err && !loading && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-800 mb-3">
          {err}
        </div>
      )}

      {!loading && !err && tab === "services" && (
        <>
          {services.length ? (
            <ul className="space-y-3">
              {services.map((it) => {
                const busyKey = `svc:${it.key}`;
                return (
                  <li
                    key={it.key}
                    className="p-3 bg-white rounded shadow flex justify-between items-center"
                  >
                    <div>
                      <div className="font-medium">{it.label_en}</div>
                      <div className="text-xs text-gray-500">
                        {it.sla_minutes} min SLA
                      </div>
                    </div>
                    <button
                      onClick={() => requestService(it)}
                      disabled={busy === busyKey}
                      className={`px-3 py-2 rounded text-white ${
                        busy === busyKey
                          ? "bg-sky-300"
                          : "bg-sky-600 hover:bg-sky-700"
                      }`}
                    >
                      {busy === busyKey ? "Requesting…" : "Request"}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="text-gray-500">
              No services available right now.
            </div>
          )}
        </>
      )}

      {!loading && !err && tab === "food" && (
        <>
          {food.length ? (
            <>
              <ul className="space-y-3">
                {food.map((it) => {
                  const busyKey = `food:${it.item_key}`;
                  const addedCount = sessionOrderCounts[it.item_key] || 0;
                  return (
                    <li
                      key={it.item_key}
                      className="p-3 bg-white rounded shadow flex justify-between items-center"
                    >
                      <div>
                        <div className="font-medium">{it.name}</div>
                        <div className="text-xs text-gray-500">
                          ₹{it.base_price}
                        </div>
                        {addedCount > 0 && (
                          <div className="text-[11px] text-green-600 mt-0.5">
                            Added ×{addedCount} in this session
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => addFood(it.item_key, it.name)}
                        disabled={busy === busyKey}
                        className={`px-3 py-2 rounded text-white ${
                          busy === busyKey
                            ? "bg-sky-300"
                            : "bg-sky-600 hover:bg-sky-700"
                        }`}
                      >
                        {busy === busyKey
                          ? "Adding…"
                          : addedCount > 0
                          ? `Add more (${addedCount})`
                          : "Add"}
                      </button>
                    </li>
                  );
                })}
              </ul>

              {Object.keys(sessionOrderCounts).length > 0 && (
                <div className="mt-4 rounded-md border bg-gray-50 p-3 text-xs text-gray-700">
                  <div className="font-medium mb-1">
                    Your recent selections (this page)
                  </div>
                  <ul className="list-disc pl-4 space-y-1">
                    {food
                      .filter((it) => sessionOrderCounts[it.item_key])
                      .map((it) => (
                        <li key={it.item_key}>
                          {it.name} × {sessionOrderCounts[it.item_key]}
                        </li>
                      ))}
                  </ul>
                  <p className="mt-1 text-[11px] text-gray-500">
                    The hotel team will confirm your order and add it to your
                    bill.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="text-gray-500">
              Food menu is unavailable at the moment.
            </div>
          )}
        </>
      )}

      {/* Tiny toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-black/80 text-white px-3 py-1 rounded">
          {toast}
        </div>
      )}
    </main>
  );
}

/**
 * Normalize services API responses so this component works with:
 * - { items: Service[] }
 * - { services: Service[] }
 * - { data: { items: Service[] } }
 * - Service[]
 */
function normalizeServices(raw: any): Service[] {
  if (!raw) return [];
  const items =
    (Array.isArray(raw?.items) && raw.items) ||
    (Array.isArray(raw?.services) && raw.services) ||
    (Array.isArray(raw?.data?.items) && raw.data.items) ||
    (Array.isArray(raw) && raw) ||
    [];
  return items as Service[];
}

/**
 * Normalize menu API responses so this component works with:
 * - { items: FoodItem[] }
 * - { menu: FoodItem[] }
 * - { data: { items: FoodItem[] } }
 * - FoodItem[]
 */
function normalizeMenu(raw: any): FoodItem[] {
  if (!raw) return [];
  const items =
    (Array.isArray(raw?.items) && raw.items) ||
    (Array.isArray(raw?.menu) && raw.menu) ||
    (Array.isArray(raw?.data?.items) && raw.data.items) ||
    (Array.isArray(raw) && raw) ||
    [];
  return items as FoodItem[];
}
