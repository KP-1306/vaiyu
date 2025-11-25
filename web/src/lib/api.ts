// web/src/lib/api.ts

// Base URL (set on Netlify as VITE_API_URL, e.g. https://your-api.example.com)
export const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
export const API_URL = API; // back-compat

// Detect if we're pointing directly at Supabase Edge Functions
export const IS_SUPABASE_FUNCTIONS =
  API.includes(".supabase.co/functions") || API.includes("/functions/v1");

/** When API is unreachable and demo fallbacks are used, we flip this on. */
export let DEMO_MODE = false;
export const isDemo = () => DEMO_MODE;

/* ============================================================================
   Optional Supabase client (for direct reads/writes with RLS)
   - Uses existing Supabase Auth session in the browser (magic link).
   - If env isn’t present or any call fails, we gracefully fall back to HTTP API.
============================================================================ */
type MaybeSupa = {
  from: ReturnType<typeof import("@supabase/supabase-js").createClient>["from"];
} | null;

let _supa: MaybeSupa = null;
function supa(): MaybeSupa {
  // lazy init to avoid import cost if unused
  try {
    const url = (import.meta as any).env?.VITE_SUPABASE_URL as
      | string
      | undefined;
    const anon = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as
      | string
      | undefined;
    if (!url || !anon) return null;
    if (_supa) return _supa;
    // dynamic import so this file still works without supabase-js at build time
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createClient } = require("@supabase/supabase-js");
    _supa = createClient(url, anon) as any;
    return _supa;
  } catch {
    return null;
  }
}

/* ============================================================================
   Types (lightweight)
============================================================================ */
export type Stay = {
  code: string;
  status: "upcoming" | "active" | "completed";
  hotel_slug?: string;
  hotel_name?: string;
  check_in?: string;
  check_out?: string;
};

export type Service = {
  key: string;
  label_en: string;
  sla_minutes: number;
  /** new, backward-compatible fields for editor/UI */
  active?: boolean;
  hotel_id?: string | null;
};

export type ReferralIdentifier = {
  /** exactly one of these should be provided */
  accountId?: string;
  phone?: string;
  email?: string;
};

export type CreditBalance = {
  property: string; // property slug (e.g., "sunrise")
  balance: number; // currency minor units or plain number
  currency?: string; // e.g., "INR"
  expiresAt?: string | null;
};

type Json =
  | Record<string, unknown>
  | Array<unknown>
  | string
  | number
  | boolean
  | null;

/** ---- NEW: Owner Applications (admin review) ---- */
export type OwnerApp = {
  id: string;
  property_name: string;
  property_type: string;
  city: string;
  country: string;
  map_link?: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  room_count?: number | null;
  links: string[] | null;

  status: "pending" | "approved" | "rejected";
  reviewed_at?: string | null;
  reviewer_id?: string | null;
  review_notes?: string | null;
  rejected_reason?: string | null;

  created_at?: string | null;
  cover_url?: string | null;
};

/* ============================================================================
   HTTP helpers - frontend to call /hotel-orders instead of /orders
============================================================================ */

// web/src/lib/api.ts

import { API_URL } from "./api-base-or-existing-file"; // keep your existing import style

export async function fetchHotelOrders(params: {
  hotelId: string;
  status?: "open" | "closed";
  limit?: number;
  since?: string; // ISO timestamp
}) {
  const search = new URLSearchParams();
  search.set("hotelId", params.hotelId);
  if (params.status) search.set("status", params.status);
  if (params.limit != null) search.set("limit", String(params.limit));
  if (params.since) search.set("since", params.since);

  const res = await fetch(
    `${API_URL}/functions/v1/hotel-orders?${search.toString()}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch hotel orders: ${res.status}`);
  }

  return (await res.json()) as {
    ok: boolean;
    orders: Array<{
      id: string;
      hotel_id: string;
      booking_code: string | null;
      room: string | null;
      item_key: string;
      qty: number;
      price: number;
      status: string;
      created_at: string;
      closed_at: string | null;
    }>;
  };
}


/* ============================================================================
   HTTP helpers
============================================================================ */
function withTimeout<T>(p: Promise<T>, ms = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Network timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

function buildHeaders(opts: RequestInit): HeadersInit {
  const h: Record<string, string> =
    { ...(opts.headers as Record<string, string> | undefined) } || {};
  const hasBody = typeof opts.body !== "undefined";
  if (
    hasBody &&
    !Object.keys(h).some((k) => k.toLowerCase() === "content-type")
  ) {
    h["Content-Type"] = "application/json";
  }
  return h;
}

async function req<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  try {
    const r = await withTimeout(
      fetch(`${API}${path}`, {
        ...opts,
        headers: buildHeaders(opts),
      }),
      12_000
    );

    const ct = r.headers.get("content-type") || "";
    const isJson = ct.includes("application/json");
    const payload = isJson ? await r.json() : await r.text();

    if (!r.ok) {
      const msg =
        (isJson && (payload as any)?.error) ||
        (typeof payload === "string" && payload.trim()) ||
        `Request failed (${r.status})`;
      throw new Error(msg);
    }
    return payload as T;
  } catch (e) {
    const fallback = demoFallback<T>(path, opts);
    if (fallback !== undefined) {
      DEMO_MODE = true;
      return fallback;
    }
    throw e;
  }
}

/* ============================================================================
   DEMO DATA + FALLBACKS (used when API is offline)
============================================================================ */
const demoHotel = {
  slug: "sunrise",
  name: "Sunrise Resort",
  description: "Hill-view stay powered by VAiyu",
  address: "Mall Road, Nainital, Uttarakhand",
  amenities: ["WiFi", "Parking", "Breakfast", "Pet Friendly"],
  phone: "+91-99999-99999",
  email: "hello@sunrise.example",
  theme: { brand: "#145AF2", mode: "light" as const },
};

const demoServices: Service[] = [
  { key: "towel", label_en: "Towel", sla_minutes: 25, active: true },
  {
    key: "room_cleaning",
    label_en: "Room Cleaning",
    sla_minutes: 30,
    active: true,
  },
  { key: "water_bottle", label_en: "Water Bottles", sla_minutes: 20, active: true },
  { key: "extra_pillow", label_en: "Extra Pillow", sla_minutes: 20, active: true },
];

const demoMenu = [
  { item_key: "veg_sandwich", name: "Veg Sandwich", base_price: 120 },
  { item_key: "masala_tea", name: "Masala Tea", base_price: 40 },
];

const demoReport = {
  hotel: { slug: "sunrise", name: "Sunrise Resort" },
  period: "all-time (demo)",
  kpis: { tickets: 7, orders: 4, onTime: 9, late: 2, avgMins: 18 },
  hints: ["Investigate 2 SLA breach(es); consider buffer or staffing in peak hours."],
};

const demoOwnerApps: OwnerApp[] = [
  {
    id: "oa_demo_1",
    property_name: "Hotel Kafal Inn",
    property_type: "Hotel",
    city: "Haldwani",
    country: "India",
    map_link: "https://maps.google.com/...",
    contact_name: "Kapil Bisht",
    contact_email: "owner@example.com",
    contact_phone: "+91-9999999999",
    room_count: 24,
    links: ["https://instagram.com/demo"],
    status: "pending",
    created_at: new Date().toISOString(),
  },
];

function safeJson(body: any): any {
  try {
    if (!body) return undefined;
    return typeof body === "string" ? JSON.parse(body) : body;
  } catch {
    return undefined;
  }
}

function demoId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function demoFallback<T>(path: string, opts: RequestInit): T | undefined {
  const method = String(opts.method || "GET").toUpperCase();
  const url = new URL(`${API}${path}`);
  let p = url.pathname.replace(/\/+$/, "");

  // Normalise known prefixes so demo fallbacks work with Supabase
  // (/functions/v1/…) and Netlify (/api/…)
  p = p.replace(/^\/functions\/v\d+\//, "/");
  p = p.replace(/^\/api\//, "/");

  // ---- Owner apps demo ----
  if (p.startsWith("/owner/apps") && method === "GET") {
    const status =
      (url.searchParams.get("status") as OwnerApp["status"]) || "pending";
    const items = demoOwnerApps.filter((a) => a.status === status);
    return { items } as unknown as T;
  }
  if (p.startsWith("/owner/apps/") && method === "PATCH") {
    const id = p.split("/").pop()!;
    const body = safeJson(opts.body) || {};
    const i = demoOwnerApps.findIndex((a) => a.id === id);
    if (i >= 0) {
      demoOwnerApps[i] = {
        ...demoOwnerApps[i],
        status: body.action === "approve" ? "approved" : "rejected",
        reviewed_at: new Date().toISOString(),
        review_notes: body.review_notes ?? null,
        rejected_reason: body.rejected_reason ?? null,
      };
    }
    return { ok: true } as unknown as T;
  }

  // ---- Existing demo fallbacks ----
  if (p.startsWith("/hotel/")) return demoHotel as unknown as T;

  // services
  if (
    (p === "/catalog/services" || p === "/catalog-services") &&
    method === "GET"
  ) {
    return { items: demoServices } as unknown as T;
  }
  if (
    (p === "/catalog/services" || p === "/catalog-services") &&
    ["POST", "PUT", "PATCH"].includes(method)
  ) {
    return { ok: true } as unknown as T;
  }

  // menu – support all historical paths for safety
  if (
    p === "/menu/items" ||
    p === "/catalog-menu" ||
    p === "/catalog_menu2"
  ) {
    return { items: demoMenu } as unknown as T;
  }

  if (p.startsWith("/experience/report"))
    return demoReport as unknown as T;

  if (p === "/reviews/pending" || p === "/reviews-pending")
    return { items: [] } as unknown as T;

  // Tickets: GET -> list; POST -> create returns id
  if (p === "/tickets" && method === "GET") {
    return { items: [] } as unknown as T;
  }
  if (p === "/tickets" && method === "POST") {
    const body = safeJson(opts.body);
    return {
      id: demoId("tkt"),
      demo: true,
      data: body ?? null,
    } as unknown as T;
  }

  // Orders: GET -> list; POST -> create returns id
  if (p === "/orders" && method === "GET") {
    return { items: [] } as unknown as T;
  }
  if (p === "/orders" && method === "POST") {
    const body = safeJson(opts.body);
    return {
      id: demoId("ord"),
      demo: true,
      data: body ?? null,
    } as unknown as T;
  }

  // Self-claim
  if (p === "/claim/init")
    return {
      ok: true,
      method: "otp",
      sent: true,
      demo: true,
      otp_hint: "123456",
    } as unknown as T;

  if (p === "/claim/verify") {
    return {
      ok: true,
      token: "demo-stay-token",
      booking: {
        code: "ABC123",
        guest_name: "Test Guest",
        hotel_slug: "sunrise",
      },
    } as unknown as T;
  }

  // Guest "my stays"
  if (p === "/me/stays") {
    const stays: Stay[] = [
      {
        code: "ABC123",
        status: "upcoming",
        hotel_slug: "sunrise",
        hotel_name: "Sunrise Resort",
        check_in: new Date(Date.now() + 2 * 86400000).toISOString(),
        check_out: new Date(Date.now() + 5 * 86400000).toISOString(),
      },
      {
        code: "LIVE001",
        status: "active",
        hotel_slug: "sunrise",
        hotel_name: "Sunrise Resort",
        check_in: new Date(Date.now() - 1 * 86400000).toISOString(),
        check_out: new Date(Date.now() + 1 * 86400000).toISOString(),
      },
      {
        code: "DONE789",
        status: "completed",
        hotel_slug: "sunrise",
        hotel_name: "Sunrise Resort",
        check_in: new Date(Date.now() - 14 * 86400000).toISOString(),
        check_out: new Date(Date.now() - 10 * 86400000).toISOString(),
      },
    ];
    return { stays, items: stays } as unknown as T;
  }

  // Referrals & Credits
  if (p === "/referrals/init") {
    const body = safeJson(opts.body);
    const property = body?.property ?? "sunrise";
    return {
      ok: true,
      code: "SUN-9X7Q",
      shareUrl: `https://www.vaiyu.co.in/hotel/${property}?ref=SUN-9X7Q`,
      demo: true,
    } as unknown as T;
  }
  if (p === "/referrals/apply") {
    return { ok: true, status: "pending" } as unknown as T;
  }
  if (p === "/credits/mine") {
    const items: CreditBalance[] = [
      {
        property: "sunrise",
        balance: 750,
        currency: "INR",
        expiresAt: new Date(Date.now() + 15552000000).toISOString(),
      },
    ];
    return { items, total: 750 } as unknown as T;
  }
  if (p === "/credits/redeem") {
    const body = safeJson(opts.body);
    const newBalance = Math.max(0, 750 - (Number(body?.amount) || 0));
    return { ok: true, newBalance } as unknown as T;
  }

  return undefined;
}

/* ============================================================================
   --- Grid (VPP) ---
============================================================================ */
export type GridMode = "manual" | "assist" | "auto";
export type GridSettings = {
  mode: GridMode;
  peak_hours?: string[];
  safety: {
    min_off_minutes?: number;
    max_off_minutes?: number;
    temperature_floor?: number;
  };
};
export type Device = {
  id: string;
  name: string;
  group?: string;
  priority: 1 | 2 | 3;
  control: string;
  on?: boolean;
  power_kw?: number;
  min_off?: number;
  max_off?: number;
};
export type Playbook = {
  id: string;
  name: string;
  steps: Array<{
    device_id: string;
    do: "shed" | "nudge";
    duration_min?: number;
    restore_after?: boolean;
  }>;
};
export type GridEvent = {
  id: string;
  start_at: string;
  end_at?: string;
  mode: GridMode;
  target_kw: number;
  reduced_kw?: number;
  actions: Array<{
    ts: string;
    device_id: string;
    action: "shed" | "restore" | "nudge";
    by: "system" | "staff" | "owner";
    note?: string;
  }>;
};

export async function gridGetDevices() {
  return req<Device[]>("/grid/devices");
}
export async function gridSaveDevices(items: Device[] | Device) {
  return req<{ ok: boolean; items: Device[] }>("/grid/devices", {
    method: "POST",
    body: JSON.stringify(items),
  });
}
export async function gridGetPlaybooks() {
  return req<Playbook[]>("/grid/playbooks");
}
export async function gridSavePlaybooks(pb: Playbook[] | Playbook) {
  return req<{ ok: boolean; items: Playbook[] }>("/grid/playbooks", {
    method: "POST",
    body: JSON.stringify(pb),
  });
}
export async function gridStartEvent(target_kw: number, playbook_id?: string) {
  return req<{ event: GridEvent }>("/grid/events/start", {
    method: "POST",
    body: JSON.stringify({ target_kw, playbook_id }),
  });
}
export async function gridStepEvent(
  id: string,
  device_id: string,
  action: "shed" | "restore" | "nudge",
  note?: string
) {
  return req<{ event: GridEvent }>(
    `/grid/events/${encodeURIComponent(id)}/step`,
    {
      method: "POST",
      body: JSON.stringify({ device_id, action, note }),
    }
  );
}
export async function gridStopEvent(id: string) {
  return req<{ event: GridEvent }>(
    `/grid/events/${encodeURIComponent(id)}/stop`,
    { method: "POST" }
  );
}
export async function gridListEvents() {
  return req<{ items: GridEvent[] }>("/grid/events");
}
export async function gridDeviceShed(id: string) {
  return req(`/grid/device/${encodeURIComponent(id)}/shed`, {
    method: "POST",
  });
}
export async function gridDeviceRestore(id: string) {
  return req(`/grid/device/${encodeURIComponent(id)}/restore`, {
    method: "POST",
  });
}
export async function gridDeviceNudge(id: string) {
  return req(`/grid/device/${encodeURIComponent(id)}/nudge`, {
    method: "POST",
  });
}

/* ============================================================================
   Self-claim (guest attaches an existing booking)
============================================================================ */
export async function claimInit(code: string, contact: string) {
  return req(`/claim/init`, {
    method: "POST",
    body: JSON.stringify({ code, phone: contact }),
  });
}
export async function claimVerify(code: string, otp: string) {
  return req(`/claim/verify`, {
    method: "POST",
    body: JSON.stringify({ code, otp }),
  });
}
export async function myStays(
  token: string
): Promise<{ stays: Stay[]; items: Stay[] }> {
  const res = await req<any>("/me/stays", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const stays: Stay[] = res?.stays ?? res?.items ?? [];
  return { stays, items: stays };
}

/* ============================================================================
   Owner: Services admin helpers
   - First try Supabase (preferred), then fall back to your existing API.
   - If the argument looks like a UUID => treat as hotel_id (Supabase table).
   - If it looks like a slug => use HTTP API:
       • Supabase Edge:  /catalog-services?hotelSlug=...
       • Node backend:   /catalog/services?hotelSlug=...
============================================================================ */
function looksLikeUuid(value: string | undefined | null): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

export async function getServices(hotelKey?: string) {
  const s = supa();
  const isId = looksLikeUuid(hotelKey);

  // Use Supabase table when:
  // - client is available AND
  // - we either have no filter OR the filter looks like a hotel_id
  if (s && (!hotelKey || isId)) {
    try {
      let query = s
        .from("services")
        .select("hotel_id,key,label_en,sla_minutes,active")
        .order("key", { ascending: true });
      if (hotelKey && isId) {
        // filter by hotel_id (owner/staff views)
        // @ts-ignore
        query = query.eq("hotel_id", hotelKey);
      }
      // @ts-ignore
      const { data, error } = await query;
      if (error) throw error;
      return { items: (data || []) as Service[] };
    } catch {
      // fall through to HTTP API
    }
  }

  // HTTP path: used when:
  // - Supabase client is not available, OR
  // - hotelKey looks like a slug (non-UUID), so we treat it as hotelSlug
  let path = IS_SUPABASE_FUNCTIONS ? "/catalog-services" : "/catalog/services";
  if (hotelKey && !isId) {
    const sep = path.includes("?") ? "&" : "?";
    path += `${sep}hotelSlug=${encodeURIComponent(hotelKey)}`;
  }
  return req(path);
}

export async function saveServices(
  items: Service[],
  fallbackHotelId?: string | null
) {
  const s = supa();
  if (s) {
    try {
      const payload = (items || []).map((r) => ({
        hotel_id: r.hotel_id ?? fallbackHotelId ?? null,
        key: String(r.key || "").trim(),
        label_en: String(r.label_en || "").trim(),
        sla_minutes: Number(r.sla_minutes) || 0,
        active: r.active ?? true,
      }));
      // @ts-ignore
      const { error } = await s
        .from("services")
        .upsert(payload, { onConflict: "hotel_id,key" });
      if (error) throw error;
      return { ok: true };
    } catch {
      // fall through to HTTP API
    }
  }
  return req(`/catalog/services`, {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

/** Generic helpers some owner pages use. */
export async function apiUpsert(path: string, payload: unknown) {
  return req(path, { method: "POST", body: JSON.stringify(payload) });
}
export async function apiDelete(path: string) {
  return req(path, { method: "DELETE" });
}

/** Back-compat aliases used by OwnerServices.tsx and others. */
export const upsert = apiUpsert;
export const upsertService = apiUpsert;
export const deleteService = apiDelete;

/* ============================================================================
   Referrals & Credits (property-scoped)
============================================================================ */
export async function referralInit(
  property: string,
  token?: string,
  channel = "guest_dashboard"
) {
  return req(`/referrals/init`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: JSON.stringify({ property, channel }),
  });
}

export async function referralApply(
  bookingCode: string,
  referrer: ReferralIdentifier
) {
  const body: any = { bookingCode };
  const keys = ["accountId", "phone", "email"] as const;
  for (const k of keys) {
    if ((referrer as any)[k]) body.referrer = { [k]: (referrer as any)[k] };
  }
  return req(`/referrals/apply`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function myCredits(
  token: string
): Promise<{ items: CreditBalance[]; total?: number }> {
  return req(`/credits/mine`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}
export async function redeemCredits(
  token: string,
  property: string,
  amount: number,
  context?: any
) {
  return req(`/credits/redeem`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ property, amount, context }),
  });
}

/* ============================================================================
   Hotel
============================================================================ */
export async function getHotel(slug: string) {
  return req(`/hotel/${encodeURIComponent(slug)}`);
}
export async function upsertHotel(payload: Json) {
  return req(`/hotel/upsert`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/* ============================================================================
   Consent
============================================================================ */
export async function setBookingConsent(code: string, reviews: boolean) {
  return req(`/booking/${encodeURIComponent(code)}/consent`, {
    method: "POST",
    body: JSON.stringify({ reviews }),
  });
}

/* ============================================================================
   Catalog
   - getMenu detects Supabase Functions vs other backends.
   - Supabase Functions: Edge Function `catalog_menu2`
   - Old/local backend:  `/menu/items`
============================================================================ */

export async function getMenu(hotelSlug?: string) {
  let path = IS_SUPABASE_FUNCTIONS ? "/catalog_menu2" : "/menu/items";

  if (hotelSlug) {
    const sep = path.includes("?") ? "&" : "?";
    path += `${sep}hotelSlug=${encodeURIComponent(hotelSlug)}`;
  }

  return req(path);
}

/* ============================================================================
   Tickets
============================================================================ */
export async function createTicket(
  data: Json
): Promise<{ id: string } & Record<string, any>> {
  const res = await req<any>(`/tickets`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  const id = res?.id ?? res?.ticketId ?? res?.data?.id ?? null;
  if (!id) {
    return {
      id: demoId("tkt"),
      demo: true,
      ...(typeof res === "object" ? res : {}),
    };
  }
  return { id: String(id), ...(typeof res === "object" ? res : {}) };
}

/**
 * List tickets.
 * - If hotelId is provided, we append ?hotelId=… (used by Desk/front-desk views).
 * - If omitted, behaviour stays exactly as before (`GET /tickets`).
 */
export async function listTickets(hotelId?: string) {
  const suffix = hotelId ? `?hotelId=${encodeURIComponent(hotelId)}` : "";
  return req(`/tickets${suffix}`);
}

export async function getTicket(id: string) {
  return req(`/tickets/${encodeURIComponent(id)}`);
}
export async function updateTicket(id: string, patch: Json) {
  return req(`/tickets/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/* ============================================================================
   Orders
============================================================================ */
export async function createOrder(
  data: Json
): Promise<{ id: string } & Record<string, any>> {
  const res = await req<any>(`/orders`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  const id = res?.id ?? res?.orderId ?? res?.data?.id ?? null;
  if (!id) {
    return {
      id: demoId("ord"),
      demo: true,
      ...(typeof res === "object" ? res : {}),
    };
  }
  return { id: String(id), ...(typeof res === "object" ? res : {}) };
}

/**
 * List orders.
 * - If hotelId is provided, we append ?hotelId=… (used by Desk/front-desk views).
 * - If omitted, behaviour stays exactly as before (`GET /orders`).
 */
export async function listOrders(hotelId?: string) {
  const suffix = hotelId ? `?hotelId=${encodeURIComponent(hotelId)}` : "";
  return req(`/orders${suffix}`);
}

export async function updateOrder(id: string, patch: Json) {
  return req(`/orders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/* ============================================================================
   Folio / Flows
============================================================================ */
export async function getFolio() {
  return req(`/folio`);
}
export async function precheck(data: Json) {
  return req(`/precheck`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
export async function regcard(data: Json) {
  return req(`/regcard`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
export async function checkout(data: {
  bookingCode?: string;
  autopost?: boolean;
}) {
  return req(`/checkout`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/* ============================================================================
   Reviews
============================================================================ */
export async function listReviews(slug: string) {
  return req(`/reviews/${encodeURIComponent(slug)}`);
}
export async function listPendingReviews() {
  return req(`/reviews/pending`);
}
export async function postManualReview(data: {
  bookingCode: string;
  rating: number;
  title?: string;
  body?: string;
}) {
  return req(`/reviews`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
export async function reviewDraft(bookingCode: string) {
  return req(`/reviews/draft/${encodeURIComponent(bookingCode)}`);
}
export async function postAutoReviewPreview(bookingCode: string) {
  return req(`/reviews/auto`, {
    method: "POST",
    body: JSON.stringify({ bookingCode }),
  });
}
export async function postAutoReviewCommit(bookingCode: string) {
  return req(`/reviews/auto`, {
    method: "POST",
    body: JSON.stringify({ bookingCode, commit: true }),
  });
}
export async function approveReview(id: string, bookingCode?: string) {
  return req(`/reviews/approve`, {
    method: "POST",
    body: JSON.stringify({ id, bookingCode }),
  });
}
export async function rejectReview(id: string, bookingCode?: string) {
  return req(`/reviews/reject`, {
    method: "POST",
    body: JSON.stringify({ id, bookingCode }),
  });
}

/* ============================================================================
   Experience (reports)
============================================================================ */
export async function getExperienceSummary(bookingCode: string) {
  return req(`/experience/summary/${encodeURIComponent(bookingCode)}`);
}
export async function getExperienceReport(slug: string) {
  return req(`/experience/report/${encodeURIComponent(slug)}`);
}

/* ============================================================================
   Quick Check-in
============================================================================ */
export async function quickCheckin(data: { code: string; phone: string }) {
  return req(`/checkin`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/* ============================================================================
   NEW: Owner Applications – list + approve/reject
   - Edge functions expected:
     GET    /owner/apps?status=pending|approved|rejected
     PATCH  /owner/apps/:id  { action: 'approve'|'reject', review_notes?, rejected_reason? }
============================================================================ */
export async function fetchOwnerApps(
  status: OwnerApp["status"] = "pending",
  token?: string
): Promise<{ items: OwnerApp[] }> {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const q = `?status=${encodeURIComponent(status)}`;
  return req<{ items: OwnerApp[] }>(`/owner/apps${q}`, { headers });
}

export async function reviewOwnerApp(
  id: string,
  action: "approve" | "reject",
  opts?: { review_notes?: string; rejected_reason?: string },
  token?: string
) {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  return req<{ ok: boolean }>(`/owner/apps/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ action, ...opts }),
  });
}

// Convenience wrappers (to match existing imports in OwnerApplications.tsx)
export async function approveOwnerApp(
  id: string,
  notes?: string,
  token?: string
) {
  return reviewOwnerApp(id, "approve", { review_notes: notes }, token);
}
export async function rejectOwnerApp(
  id: string,
  reason: string,
  notes?: string,
  token?: string
) {
  return reviewOwnerApp(
    id,
    "reject",
    { rejected_reason: reason, review_notes: notes },
    token
  );
}

/* ============================================================================
   Grouped export + Back-compat
============================================================================ */
export const api = {
  API,
  API_URL,
  req,
  isDemo,

  // self-claim + session
  claimInit,
  claimVerify,
  myStays,

  // referrals & credits
  referralInit,
  referralApply,
  myCredits,
  redeemCredits,

  // hotel
  getHotel,
  upsertHotel,

  // consent
  setBookingConsent,

  // catalog
  getServices,
  getMenu,
  services: (..._args: any[]) => getServices(), // back-compat alias (ignores args as before)
  menu: (..._args: any[]) => getMenu(), // back-compat alias (ignores args as before)
  saveServices,
  apiUpsert,
  apiDelete,
  upsert,
  upsertService,
  deleteService,

  // tickets
  createTicket,
  listTickets,
  getTicket,
  updateTicket,

  // orders
  createOrder,
  listOrders,
  updateOrder,

  // folio/flows
  getFolio,
  precheck,
  regcard,
  checkout,

  // reviews
  listReviews,
  listPendingReviews,
  postManualReview,
  reviewDraft,
  postAutoReviewPreview,
  postAutoReviewCommit,
  approveReview,
  rejectReview,

  // experience
  getExperienceSummary,
  getExperienceReport,

  // check-in
  quickCheckin,

  // owner apps (admin)
  fetchOwnerApps,
  reviewOwnerApp,
  approveOwnerApp,
  rejectOwnerApp,
};
