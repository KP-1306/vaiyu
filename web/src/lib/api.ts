// web/src/lib/api.ts

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Base URL (set on Netlify as VITE_API_URL, e.g. https://your-api.example.com)
// NOTE: can be absolute (recommended) OR relative (e.g., "/api").
// We handle both safely.
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

type MaybeSupa = SupabaseClient | null;

let _supa: MaybeSupa = null;
export function supa(): MaybeSupa {
  try {
    const url = (import.meta as any).env?.VITE_SUPABASE_URL as
      | string
      | undefined;
    const anon = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as
      | string
      | undefined;

    if (!url || !anon) return null;
    if (_supa) return _supa;

    _supa = createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });

    return _supa;
  } catch {
    return null;
  }
}

/**
 * Build Authorization header from either:
 *  - explicit token (if provided), or
 *  - current Supabase session (via supa().auth.getSession()).
 * Returns `{}` when no token is available so callers can safely spread it.
 */
async function getAuthHeaders(
  explicitToken?: string
): Promise<Record<string, string>> {
  const t = (explicitToken ?? "").trim();
  if (t) {
    return { Authorization: `Bearer ${t}` };
  }

  const client = supa();
  if (!client?.auth?.getSession) return {};

  try {
    const { data } = await client.auth.getSession();
    const token = data?.session?.access_token;
    if (token) {
      return { Authorization: `Bearer ${token}` };
    }
  } catch {
    // swallow, we just return empty headers below
  }
  return {};
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
  department_id?: string | null;
  department_name?: string | null;
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

// Unified Guest Profile response (Owner view)
export type GuestProfilePayload = {
  ok: boolean;
  guest: any | null;
  stays: any[];
  tickets: any[];
  orders: any[];
  reviews: any[];
  credits?: any[];
};

/** ---- NEW: Central Guest Identity type ---- */
export type GuestIdentity = {
  id?: string;
  account_id?: string;
  full_name?: string | null;
  primary_phone?: string | null;
  primary_email?: string | null;
  id_type?: string | null;
  id_number?: string | null;
  country?: string | null;
  city?: string | null;
  updated_at?: string | null;
  // allow forward-compatible extra fields
  [key: string]: any;
};

/** ---- NEW: AI Ops Co-pilot types ---- */
export type OpsHeatmapPoint = {
  hotel_id: string;
  zone: string;
  hour_bucket: string; // ISO timestamp string
  total_tickets: number;
  resolved_tickets: number;
  breached_tickets: number;
};

export type StaffingPlanRow = {
  department: string;
  recommended_count: number;
  min_count: number;
  max_count: number;
  reason: string;
};

/** ---- NEW: Grid / Energy Coach types ---- */
export type GridDeviceEnergyDaily = {
  device_id: string;
  hotel_id: string;
  zone: string | null;
  device_type: string | null;
  day: string; // YYYY-MM-DD (date::text)
  energy_kwh: number;
  hours_covered: number;
  avg_kw: number | null;
  first_sample_at: string | null;
  last_sample_at: string | null;
};

export type GridZoneEnergyDaily = {
  hotel_id: string;
  zone: string;
  day: string; // YYYY-MM-DD
  energy_kwh: number;
  hours_covered: number;
};

export type GridSilentKiller = {
  device_id: string;
  hotel_id: string;
  zone: string | null;
  device_type: string | null;
  day: string; // YYYY-MM-DD
  total_kwh: number;
  night_kwh: number | null;
  peak_kwh: number | null;
  waste_score: number;
  rank_within_hotel: number;
};

/** ---- NEW: Workforce / Labour Beta types ---- */
export type WorkforceProfile = {
  id?: string;
  user_id?: string;
  full_name?: string | null;
  headline?: string | null;
  bio?: string | null;
  skills?: string[] | null;
  languages?: string[] | null;
  experience_years?: number | null;
  location_city?: string | null;
  location_state?: string | null;
  location_country?: string | null;
  preferred_property_types?: string[] | null;
  willing_relocate?: boolean | null;
  status?: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: any;
};

export type WorkforceJob = {
  id?: string;
  property_type?: string | null;
  property_id?: string | null;
  title?: string | null;
  role_key?: string | null;
  job_type?: "full_time" | "part_time" | "contract" | string;
  contract_days?: number | null;
  min_salary?: number | null;
  max_salary?: number | null;
  currency?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  status?: "draft" | "open" | "closed" | "deleted" | string;
  notes?: string | null;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: any;
};

export type WorkforceJobApplication = {
  id?: string;
  job_id?: string;
  applicant_user_id?: string;
  workforce_profile_id?: string;
  status?: "applied" | "shortlisted" | "rejected" | "hired" | string;
  message?: string | null;
  expected_salary?: number | null;
  created_at?: string;
  job?: WorkforceJob;
  [key: string]: any;
};

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
    { ...(opts.headers as Record<string, string>) };

  const hasBody = typeof opts.body !== "undefined";
  const isFormData =
    typeof FormData !== "undefined" && opts.body instanceof FormData;

  if (
    hasBody &&
    !isFormData &&
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
  {
    key: "water_bottle",
    label_en: "Water Bottles",
    sla_minutes: 20,
    active: true,
  },
  {
    key: "extra_pillow",
    label_en: "Extra Pillow",
    sla_minutes: 20,
    active: true,
  },
];

const demoMenu = [
  { item_key: "veg_sandwich", name: "Veg Sandwich", base_price: 120 },
  { item_key: "masala_tea", name: "Masala Tea", base_price: 40 },
];

const demoReport = {
  hotel: { slug: "sunrise", name: "Sunrise Resort" },
  period: "all-time (demo)",
  kpis: { tickets: 7, orders: 4, onTime: 9, late: 2, avgMins: 18 },
  hints: [
    "Investigate 2 SLA breach(es); consider buffer or staffing in peak hours.",
  ],
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

/**
 * Safe URL builder for demoFallback.
 * Handles absolute API bases and relative ones like "/api".
 */
function buildDemoUrl(path: string): URL {
  try {
    return new URL(`${API}${path}`);
  } catch {
    const base =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "http://localhost";
    const prefix = API.startsWith("http")
      ? API
      : API.startsWith("/")
        ? API
        : `/${API}`;
    return new URL(`${prefix}${path}`, base);
  }
}

function demoFallback<T>(path: string, opts: RequestInit): T | undefined {
  const method = String(opts.method || "GET").toUpperCase();
  const url = buildDemoUrl(path);
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

  // ---- NEW: AI Ops Co-pilot demo fallbacks ----
  if (p === "/ops-heatmap" && method === "GET") {
    const demo: OpsHeatmapPoint[] = [];
    return demo as unknown as T;
  }

  if (p === "/staffing-plan" && method === "GET") {
    const demo: StaffingPlanRow[] = [];
    return demo as unknown as T;
  }

  // ---- NEW: Grid / Energy Coach demo fallbacks ----
  if (p === "/grid/energy/device-daily" && method === "GET") {
    const demo: GridDeviceEnergyDaily[] = [];
    return demo as unknown as T;
  }
  if (p === "/grid/energy/zone-daily" && method === "GET") {
    const demo: GridZoneEnergyDaily[] = [];
    return demo as unknown as T;
  }
  if (p === "/grid/energy/silent-killers" && method === "GET") {
    const demo: GridSilentKiller[] = [];
    return demo as unknown as T;
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
  if (p === "/menu/items" || p === "/catalog-menu" || p === "/catalog_menu2") {
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

  // NEW: hotel-orders demo (Supabase Edge function path)
  if (p === "/hotel-orders" && method === "GET") {
    return { items: [] } as unknown as T;
  }

  // NEW: guest-profile demo
  if (p === "/guest-profile" && method === "GET") {
    const demo: GuestProfilePayload = {
      ok: true,
      guest: {
        id: "guest_demo_1",
        display_name: "Demo Guest",
        primary_phone: "+91-90000-00000",
        primary_email: "guest@example.com",
        city: "Nainital",
        country: "India",
        preferences: {
          veg_only: true,
          pillow_type: "Soft",
        },
      },
      stays: [],
      tickets: [],
      orders: [],
      reviews: [],
      credits: [],
    };
    return demo as unknown as T;
  }

  // NEW: guest-identity demo
  if (p === "/guest-identity" && method === "GET") {
    const identity: GuestIdentity = {
      id: "guest_identity_demo_1",
      full_name: "Demo Guest",
      primary_phone: "+91-90000-00000",
      primary_email: "guest@example.com",
      id_type: "Aadhaar",
      id_number: "XXXX-XXXX-1234",
      city: "Nainital",
      country: "India",
    };
    return { ok: true, identity } as unknown as T;
  }
  if (p === "/guest-identity-upsert" && method === "POST") {
    const identity = safeJson(opts.body) || {};
    return { ok: true, identity } as unknown as T;
  }

  // Self-claim init (support both /claim/init and /claim-init)
  if ((p === "/claim/init" || p === "/claim-init") && method === "POST") {
    return {
      ok: true,
      method: "otp",
      sent: true,
      demo: true,
      otp_hint: "123456",
    } as unknown as T;
  }

  // Self-claim verify (support both /claim/verify and /claim-verify)
  if ((p === "/claim/verify" || p === "/claim-verify") && method === "POST") {
    const payload = safeJson(opts.body) || {};

    // Accept various possible field names from the client
    const rawCode =
      payload.code ??
      payload.booking_code ??
      payload.bookingCode ??
      payload.booking_id ??
      null;

    const bookingCode = rawCode
      ? String(rawCode).trim().toUpperCase()
      : "ABC123";

    return {
      ok: true,
      token: "demo-stay-token",
      booking: {
        code: bookingCode,
        guest_name: "Demo Guest",
        hotel_slug: demoHotel.slug,
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
    const reqAmount = Math.max(0, Number(body?.amount) || 0);
    const current = 750;
    const applied = Math.min(current, reqAmount);
    const newBalance = Math.max(0, current - applied);

    return {
      ok: true,
      applied,
      requested: reqAmount,
      newBalance,
      demo: true,
    } as unknown as T;
  }

  // ✅ NEW: Checkout demo fallback
  if (p === "/checkout" && method === "POST") {
    const body = safeJson(opts.body) || {};
    const rawCode =
      body.bookingCode ?? body.booking_code ?? body.code ?? body.stayCode;
    const bookingCode = rawCode
      ? String(rawCode).trim().toUpperCase()
      : "ABC123";

    const property =
      body.property ??
      body.property_slug ??
      body.hotelSlug ??
      body.hotel_slug ??
      demoHotel.slug;

    return {
      ok: true,
      bookingCode,
      property,
      autopost: body.autopost ?? true,
      demo: true,
    } as unknown as T;
  }

  return undefined;
}

/* ============================================================================
   Workforce / Labour Beta – helper APIs
============================================================================ */

export async function getMyWorkforceProfile(
  token?: string
): Promise<WorkforceProfile | null> {
  const headers = await getAuthHeaders(token);
  const res = await req<any>("/workforce-profile", { headers }).catch(
    () => null
  );
  if (!res) return null;

  const profile: WorkforceProfile =
    (res.profile as WorkforceProfile) ??
    (res.data as WorkforceProfile) ??
    (res as WorkforceProfile);

  return profile || null;
}

export async function saveMyWorkforceProfile(
  payload: Partial<WorkforceProfile>,
  token?: string
): Promise<WorkforceProfile> {
  const headers = await getAuthHeaders(token);
  const res = await req<any>("/workforce-profile", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const profile: WorkforceProfile =
    (res.profile as WorkforceProfile) ??
    (res.data as WorkforceProfile) ??
    (res as WorkforceProfile);

  return profile;
}

export type ListOpenJobsFilters = {
  city?: string;
  state?: string;
  role?: string;
  propertyType?: string;
};

export async function listOpenJobs(
  filters?: ListOpenJobsFilters
): Promise<WorkforceJob[]> {
  const search = new URLSearchParams();
  search.set("mode", "open");
  if (filters?.city) search.set("city", filters.city);
  if (filters?.state) search.set("state", filters.state);
  if (filters?.role) search.set("role", filters.role);
  if (filters?.propertyType) search.set("property_type", filters.propertyType);

  const qs = search.toString();
  const res = await req<any>(`/workforce-jobs${qs ? `?${qs}` : ""}`);

  const jobs =
    (res?.jobs as WorkforceJob[]) ??
    (res?.items as WorkforceJob[]) ??
    (Array.isArray(res) ? (res as WorkforceJob[]) : []);

  return Array.isArray(jobs) ? jobs : [];
}

export async function listPropertyJobs(params: {
  propertyId: string;
  token?: string;
}): Promise<WorkforceJob[]> {
  const search = new URLSearchParams();
  search.set("mode", "property");
  search.set("property_id", params.propertyId);
  const qs = search.toString();

  const headers = await getAuthHeaders(params.token);
  const res = await req<any>(`/workforce-jobs?${qs}`, { headers });

  const jobs =
    (res?.jobs as WorkforceJob[]) ??
    (res?.items as WorkforceJob[]) ??
    (Array.isArray(res) ? (res as WorkforceJob[]) : []);

  return Array.isArray(jobs) ? jobs : [];
}

export async function postJob(
  job: Partial<WorkforceJob>,
  token?: string
): Promise<WorkforceJob> {
  const headers = await getAuthHeaders(token);
  const res = await req<any>("/workforce-jobs", {
    method: "POST",
    headers,
    body: JSON.stringify(job),
  });

  const saved: WorkforceJob =
    (res?.job as WorkforceJob) ??
    (res?.data as WorkforceJob) ??
    (res as WorkforceJob);

  return saved;
}

export async function applyToJob(params: {
  jobId: string;
  message?: string;
  expectedSalary?: number;
  token?: string;
}): Promise<WorkforceJobApplication> {
  const headers = await getAuthHeaders(params.token);

  const payload: any = {
    job_id: params.jobId,
  };
  if (typeof params.expectedSalary === "number") {
    payload.expected_salary = params.expectedSalary;
  }
  if (params.message) {
    payload.message = params.message;
  }

  const res = await req<any>("/workforce-applications", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const app: WorkforceJobApplication =
    (res?.application as WorkforceJobApplication) ??
    (res?.data as WorkforceJobApplication) ??
    (res as WorkforceJobApplication);

  return app;
}

export async function listMyApplications(
  token?: string
): Promise<WorkforceJobApplication[]> {
  const headers = await getAuthHeaders(token);
  const res = await req<any>("/workforce-applications?mode=mine", {
    headers,
  });

  const apps =
    (res?.applications as WorkforceJobApplication[]) ??
    (res?.items as WorkforceJobApplication[]) ??
    (Array.isArray(res) ? (res as WorkforceJobApplication[]) : []);

  return Array.isArray(apps) ? apps : [];
}

export async function listJobApplications(params: {
  jobId: string;
  token?: string;
}): Promise<WorkforceJobApplication[]> {
  const search = new URLSearchParams();
  search.set("mode", "job");
  search.set("job_id", params.jobId);
  const qs = search.toString();

  const headers = await getAuthHeaders(params.token);
  const res = await req<any>(`/workforce-applications?${qs}`, {
    headers,
  });

  const apps =
    (res?.applications as WorkforceJobApplication[]) ??
    (res?.items as WorkforceJobApplication[]) ??
    (Array.isArray(res) ? (res as WorkforceJobApplication[]) : []);

  return Array.isArray(apps) ? apps : [];
}

// --- Back-compat aliases for existing imports (WorkforceProfile.tsx) ---
export async function fetchWorkforceProfile(
  token?: string
): Promise<WorkforceProfile | null> {
  return getMyWorkforceProfile(token);
}

export async function upsertWorkforceProfile(
  payload: Partial<WorkforceProfile>,
  token?: string
): Promise<WorkforceProfile> {
  return saveMyWorkforceProfile(payload, token);
}

export async function listWorkforceJobs(
  filters?: ListOpenJobsFilters
): Promise<WorkforceJob[]> {
  return listOpenJobs(filters);
}

export async function applyForWorkforceJob(params: {
  jobId: string;
  message?: string;
  expectedSalary?: number;
  token?: string;
}): Promise<WorkforceJobApplication> {
  return applyToJob(params);
}

export async function listWorkforceApplications(
  token?: string
): Promise<WorkforceJobApplication[]> {
  return listMyApplications(token);
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

/* ============================================================================
   Self-claim
============================================================================ */
export async function claimInit(code: string, contact: string) {
  const path = IS_SUPABASE_FUNCTIONS ? "/claim-init" : "/claim/init";
  return req(path, {
    method: "POST",
    body: JSON.stringify({ code, phone: contact }),
  });
}

export async function claimVerify(code: string, otp: string) {
  const path = IS_SUPABASE_FUNCTIONS ? "/claim-verify" : "/claim/verify";
  return req(path, {
    method: "POST",
    body: JSON.stringify({ code, otp }),
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
   Grid / Energy Coach – analytics helpers
============================================================================ */

export async function gridFetchDeviceEnergyDaily(params: {
  hotelId: string;
  from?: string;
  to?: string;
}): Promise<GridDeviceEnergyDaily[]> {
  const s = supa();
  if (s) {
    try {
      let query: any = s
        .from("grid_device_energy_daily")
        .select(
          "device_id,hotel_id,zone,device_type,day,energy_kwh,hours_covered,avg_kw,first_sample_at,last_sample_at"
        )
        .eq("hotel_id", params.hotelId)
        .order("day", { ascending: true });

      if (params.from) query = query.gte("day", params.from);
      if (params.to) query = query.lte("day", params.to);

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as GridDeviceEnergyDaily[];
    } catch {
      // fall through
    }
  }

  const search = new URLSearchParams();
  search.set("hotelId", params.hotelId);
  if (params.from) search.set("from", params.from);
  if (params.to) search.set("to", params.to);
  const qs = search.toString();
  const path = `/grid/energy/device-daily${qs ? `?${qs}` : ""}`;
  return req<GridDeviceEnergyDaily[]>(path);
}

export async function gridFetchZoneEnergyDaily(params: {
  hotelId: string;
  from?: string;
  to?: string;
}): Promise<GridZoneEnergyDaily[]> {
  const s = supa();
  if (s) {
    try {
      let query: any = s
        .from("grid_zone_energy_daily")
        .select("hotel_id,zone,day,energy_kwh,hours_covered")
        .eq("hotel_id", params.hotelId)
        .order("day", { ascending: true })
        .order("zone", { ascending: true });

      if (params.from) query = query.gte("day", params.from);
      if (params.to) query = query.lte("day", params.to);

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as GridZoneEnergyDaily[];
    } catch {
      // fall through
    }
  }

  const search = new URLSearchParams();
  search.set("hotelId", params.hotelId);
  if (params.from) search.set("from", params.from);
  if (params.to) search.set("to", params.to);
  const qs = search.toString();
  const path = `/grid/energy/zone-daily${qs ? `?${qs}` : ""}`;
  return req<GridZoneEnergyDaily[]>(path);
}

export async function gridFetchSilentKillers(params: {
  hotelId: string;
  day?: string;
}): Promise<GridSilentKiller[]> {
  const s = supa();
  if (s) {
    try {
      let query: any = s
        .from("grid_silent_killers_top5")
        .select(
          "device_id,hotel_id,zone,device_type,day,total_kwh,night_kwh,peak_kwh,waste_score,rank_within_hotel"
        )
        .eq("hotel_id", params.hotelId)
        .order("day", { ascending: false })
        .order("rank_within_hotel", { ascending: true });

      if (params.day) query = query.eq("day", params.day);

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as GridSilentKiller[];
    } catch {
      // fall through
    }
  }

  const search = new URLSearchParams();
  search.set("hotelId", params.hotelId);
  if (params.day) search.set("day", params.day);
  const qs = search.toString();
  const path = `/grid/energy/silent-killers${qs ? `?${qs}` : ""}`;
  return req<GridSilentKiller[]>(path);
}

/* ============================================================================
   Self-claim helper – "my stays"
============================================================================ */

function normalizeStay(raw: any): Stay {
  const codeRaw =
    raw?.code ??
    raw?.bookingCode ??
    raw?.booking_code ??
    raw?.stayCode ??
    raw?.stay_code ??
    raw?.booking ??
    raw?.booking_id ??
    "";
  const code = String(codeRaw || "")
    .trim()
    .toUpperCase();

  const statusRaw =
    raw?.status ?? raw?.state ?? raw?.phase ?? raw?.booking_status ?? "upcoming";
  const status = (String(statusRaw).toLowerCase() as Stay["status"]) || "upcoming";

  const hotelSlug =
    raw?.hotel_slug ??
    raw?.hotelSlug ??
    raw?.property_slug ??
    raw?.propertySlug ??
    raw?.hotel?.slug ??
    raw?.property?.slug ??
    raw?.slug ??
    undefined;

  const hotelName =
    raw?.hotel_name ??
    raw?.hotelName ??
    raw?.property_name ??
    raw?.propertyName ??
    raw?.hotel?.name ??
    raw?.property?.name ??
    undefined;

  const checkIn = raw?.check_in ?? raw?.checkIn ?? raw?.check_in_at ?? raw?.checkInAt;
  const checkOut =
    raw?.check_out ?? raw?.checkOut ?? raw?.check_out_at ?? raw?.checkOutAt;

  return {
    code,
    status: status === "active" || status === "completed" ? status : "upcoming",
    hotel_slug: hotelSlug ? String(hotelSlug) : undefined,
    hotel_name: hotelName ? String(hotelName) : undefined,
    check_in: checkIn ? String(checkIn) : undefined,
    check_out: checkOut ? String(checkOut) : undefined,
  };
}

export async function myStays(
  token?: string
): Promise<{ stays: Stay[]; items: Stay[] }> {
  const headers = await getAuthHeaders(token);
  const res = await req<any>("/me/stays", { headers });

  const raw =
    res?.stays ??
    res?.items ??
    (Array.isArray(res) ? res : []) ??
    [];

  const stays = Array.isArray(raw) ? raw.map(normalizeStay).filter(s => !!s.code) : [];

  return { stays, items: stays };
}

/**
 * Returns a matching stay by booking code from /me/stays.
 * Useful for auto-filling Checkout UI.
 */
export async function getStayByCode(code: string, token?: string): Promise<Stay | null> {
  const safe = String(code || "").trim().toUpperCase();
  if (!safe) return null;
  const { stays } = await myStays(token).catch(() => ({ stays: [] as Stay[] }));
  return stays.find((s) => String(s.code).toUpperCase() === safe) ?? null;
}

/** Convenience helpers (UI-safe, no breaking changes) */
export async function isStayCompleted(code: string, token?: string): Promise<boolean> {
  const stay = await getStayByCode(code, token);
  return stay?.status === "completed";
}
export async function isStayActive(code: string, token?: string): Promise<boolean> {
  const stay = await getStayByCode(code, token);
  return stay?.status === "active";
}

/**
 * Resolve property slug for a booking.
 * In the current VAiyu model, this is typically the same as hotel_slug.
 */
export async function getPropertySlugForBooking(
  code: string,
  token?: string
): Promise<string | null> {
  const stay = await getStayByCode(code, token);
  const slug = stay?.hotel_slug?.trim();
  return slug || null;
}

/* ============================================================================
   Owner: Services admin helpers
============================================================================ */

function looksLikeUuid(value: string | undefined | null): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

/**
 * Normalise "hotel key" passed by legacy UI:
 *  - string hotelId
 *  - string hotelSlug
 *  - { hotelId }
 *  - { hotelSlug }
 *  - { propertyId/propertySlug } (future-friendly)
 */
function normalizeHotelKey(input?: any): string | undefined {
  if (!input) return undefined;

  if (typeof input === "string") {
    const v = input.trim();
    return v || undefined;
  }

  if (typeof input === "object") {
    const v =
      input.hotelId ??
      input.hotel_id ??
      input.hotelSlug ??
      input.hotel_slug ??
      input.propertyId ??
      input.property_id ??
      input.propertySlug ??
      input.property_slug ??
      undefined;

    if (typeof v === "string") {
      const s = v.trim();
      return s || undefined;
    }
  }

  return undefined;
}

export async function getServices(hotelKey?: string | null) {
  const s = supa();
  const key = hotelKey || undefined;
  const isId = key ? looksLikeUuid(key) : false;

  // 1) Try direct Supabase read
  if (s && (!key || isId)) {
    try {
      // Query: Active Services only + JOIN Active Departments only
      let query = s
        .from("services")
        .select(
          "id, hotel_id, key, label, sla_minutes, priority_weight, active, department_id, departments!inner(name, is_active)"
        )
        .eq("active", true)
        .eq("departments.is_active", true);

      if (key && isId) {
        query = query.eq("hotel_id", key);
      }

      const { data, error } = await query.order("priority_weight", {
        ascending: false,
      });

      if (error) throw error;

      // Map the database response to match the Service type (label -> label_en)
      const items = (data || [])
        // JS filtering not strictly needed now but safe to keep
        .filter((row) => row.active !== false)
        .map((row) => ({
          key: row.key,
          label_en: row.label, // Map label to label_en
          sla_minutes: row.sla_minutes || 0,
          active: row.active,
          hotel_id: row.hotel_id,
          department_id: row.department_id,
          // @ts-ignore
          department_name: row.departments?.name || "General",
        }));

      console.log("[getServices] Successfully fetched", items.length, "services");
      return { items };
    } catch (err) {
      console.warn("getServices supabase failed, falling back to HTTP", err);
    }
  }

  // 2) HTTP fallback
  let path = IS_SUPABASE_FUNCTIONS ? "/catalog-services" : "/catalog/services";

  if (key) {
    const sep = path.includes("?") ? "&" : "?";
    if (isId) {
      path += `${sep}hotelId=${encodeURIComponent(key)}`;
    } else {
      path += `${sep}hotelSlug=${encodeURIComponent(key)}`;
    }
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
      // fall through
    }
  }

  const path = IS_SUPABASE_FUNCTIONS ? "/catalog-services" : "/catalog/services";

  return req(path, {
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
  const headers = await getAuthHeaders(token);
  return req(`/referrals/init`, {
    method: "POST",
    headers,
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

/**
 * Made token optional for better UI ergonomics.
 * We still pick up the session token via getAuthHeaders() if available.
 */
export async function myCredits(
  token?: string
): Promise<{ items: CreditBalance[]; total?: number }> {
  const headers = await getAuthHeaders(token);
  return req(`/credits/mine`, { headers });
}

export async function redeemCredits(
  token: string,
  property: string,
  amount: number,
  context?: any
) {
  const headers = await getAuthHeaders(token);
  return req(`/credits/redeem`, {
    method: "POST",
    headers,
    body: JSON.stringify({ property, amount, context }),
  });
}

/**
 * UI helper: clamp amount to available credits.
 * Use this in Checkout input validation.
 */
export function clampRedeemAmount(amount: number, available: number) {
  const a = Math.max(0, Number(amount) || 0);
  const v = Math.max(0, Number(available) || 0);
  return Math.min(a, v);
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
============================================================================ */

export async function getMenu(hotelKey?: string) {
  const s = supa();
  const key = hotelKey || undefined;
  const isId = key ? looksLikeUuid(key) : false;

  // 1) Try direct Supabase read
  if (s && (!key || isId)) {
    try {
      let query = s.from("menu_items").select("*");

      if (key && isId) {
        query = query.eq("hotel_id", key);
      }

      const { data, error } = await query.order("name", { ascending: true });

      if (error) throw error;

      const items = (data || [])
        .filter((row) => row.active !== false)
        .map((row) => ({
          item_key: row.item_key,
          name: row.name,
          base_price: row.base_price || 0,
          category: row.category,
          is_veg: row.is_veg,
          active: row.active,
        }));

      console.log("[getMenu] Successfully fetched", items.length, "menu items");
      return { items };
    } catch (err) {
      console.warn("getMenu supabase failed, falling back to HTTP", err);
    }
  }

  // 2) HTTP fallback
  let path = IS_SUPABASE_FUNCTIONS ? "/catalog_menu2" : "/menu/items";

  if (key) {
    const sep = path.includes("?") ? "&" : "?";
    if (isId) {
      path += `${sep}hotelId=${encodeURIComponent(key)}`;
    } else {
      path += `${sep}hotelSlug=${encodeURIComponent(key)}`;
    }
  }

  return req(path);
}

/* ============================================================================
   Tickets
============================================================================ */

export async function createTicket(
  data: Json
): Promise<{ id: string } & Record<string, any>> {
  const s = supa();

  // Try Supabase RPC first
  if (s) {
    try {
      const payload: any = {
        p_hotel_id: (data as any).hotelId || (data as any).hotel_id || (data as any).propertyId || null,
        p_department_id: (data as any).departmentId || (data as any).department_id || null,
        p_room_id: (data as any).roomId || (data as any).room_id || null,
        p_zone_id: (data as any).zoneId || (data as any).zone_id || null,
        p_title: (data as any).title || 'Service Request',
        p_description: (data as any).details || (data as any).description || null,
        p_created_by_type: (data as any).source || (data as any).created_by_type || 'GUEST',
        p_created_by_id: (data as any).created_by_id || null
      };

      console.log('[createTicket] Invoking RPC:', payload);

      const { data: ticketId, error } = await s.rpc('create_service_request', payload);

      if (error) {
        console.error('[createTicket] RPC error:', error);
        throw error;
      }

      console.log('[createTicket] Ticket created successfully:', ticketId);
      return { id: ticketId as string };
    } catch (err) {
      console.warn("[createTicket] RPC failed, falling back to HTTP", err);
    }
  }

  // Fallback to HTTP API
  const res = await req<any>(`/tickets`, {
    method: "POST",
    body: JSON.stringify(data),
  });

  const ticket =
    (res &&
      typeof res === "object" &&
      "ticket" in res &&
      (res as any).ticket) ||
    null;

  const id =
    ticket?.id ??
    (res as any)?.id ??
    (res as any)?.ticketId ??
    (res as any)?.data?.id ??
    null;

  if (!id) {
    return {
      id: demoId("tkt"),
      demo: true,
      ...(ticket && typeof ticket === "object"
        ? ticket
        : typeof res === "object"
          ? res
          : {}),
    };
  }

  return {
    id: String(id),
    ...(ticket && typeof ticket === "object"
      ? ticket
      : typeof res === "object"
        ? res
        : {}),
  };
}

export async function listTickets(hotelId?: string) {
  const s = supa();

  // Try Supabase direct read first
  if (s) {
    try {
      // We join 'rooms' to get the number, and 'departments' for context.
      // Note: hotel_id was added back to tickets table in a migration for simple filtering.
      let query = s.from("tickets").select(`
        *,
        room:rooms(number),
        department:departments(name, hotel_id)
      `);

      if (hotelId) {
        query = query.eq("hotel_id", hotelId);
      }

      const { data, error } = await query.order("created_at", { ascending: false });

      if (error) {
        console.error('[listTickets] Supabase error:', error);
        throw error;
      }

      // Flatten the room number for back-compat with normalizeTicket
      const items = (data || []).map((t: any) => ({
        ...t,
        room_number: t.room?.number,
        department_name: t.department?.name,
      }));

      console.log('[listTickets] Successfully fetched', items.length, 'tickets');
      return { items };
    } catch (err) {
      console.warn("[listTickets] Supabase failed, falling back to HTTP", err);
    }
  }

  // Fallback to HTTP API
  const suffix = hotelId ? `?hotelId=${encodeURIComponent(hotelId)}` : "";
  return req(`/tickets${suffix}`);
}

export async function getTicket(id: string) {
  const path = IS_SUPABASE_FUNCTIONS
    ? `/tickets/${encodeURIComponent(id)}`
    : `/ticket-get?id=${encodeURIComponent(id)}`;

  const res = await req<any>(path);
  return (res && (res.ticket ?? res)) || res;
}

export async function updateTicket(id: string, patch: Json) {
  return req(`/tickets/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function getSupervisorTaskHeader(ticketId: string) {
  const s = supa();
  if (!s) return null;
  const { data, error } = await s
    .from("v_supervisor_task_header")
    .select("*")
    .eq("ticket_id", ticketId)
    .single();

  if (error) {
    console.error('[getSupervisorTaskHeader] error:', error);
    return null;
  }
  return data;
}

export async function unblockTask(
  ticketId: string,
  unblockReasonCode: string,
  comment?: string
) {
  if (IS_SUPABASE_FUNCTIONS) {
    return req(`/tickets/${encodeURIComponent(ticketId)}/unblock`, {
      method: "POST",
      body: JSON.stringify({ reason_code: unblockReasonCode, comment }),
    });
  }

  // Direct Supabase RPC call
  const s = supa();
  if (!s) throw new Error("No Supabase client");

  const { data, error } = await s.rpc("unblock_task", {
    p_ticket_id: ticketId,
    p_unblock_reason_code: unblockReasonCode,
    p_comment: comment,
  });

  if (error) throw error;
  return data;
}

export async function reassignTask(
  ticketId: string,
  newAssigneeId: string,
  supervisorId: string,
  comment?: string
) {
  if (IS_SUPABASE_FUNCTIONS) {
    return req(`/tickets/${encodeURIComponent(ticketId)}/reassign`, {
      method: "POST",
      body: JSON.stringify({
        new_assignee_id: newAssigneeId,
        supervisor_id: supervisorId,
        comment
      }),
    });
  }

  // Direct Supabase RPC call
  const s = supa();
  if (!s) throw new Error("No Supabase client");

  const { data, error } = await s.rpc("reassign_task", {
    p_ticket_id: ticketId,
    p_new_assignee_id: newAssigneeId,
    p_supervisor_id: supervisorId,
    p_comment: comment,
  });

  if (error) throw error;
  return data;
}

export async function getGuestTickets(stayCode: string) {
  const s = supa();
  if (!s) return [];

  // v_guest_tickets is RLS-protected and automatically filters by auth.uid()
  // No need to filter by stay_id - guest sees all their tickets
  const { data, error } = await s
    .from('v_guest_tickets')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function reopenTicket(
  ticketId: string,
  stayId: string,
  reason?: string
) {
  const s = supa();
  if (!s) throw new Error("No Supabase client");

  const { data, error } = await s.rpc("reopen_ticket", {
    p_ticket_id: ticketId,
    p_stay_id: stayId,
    p_reason: reason,
  });

  if (error) throw error;
  return data;
}

export async function getCancelReasons() {
  const s = supa();
  if (!s) throw new Error("No Supabase client");

  const { data, error } = await s
    .from("cancel_reasons")
    .select("code, label, description, icon")
    .eq("is_active", true)
    .eq("allowed_for_guest", true)
    .order("label");

  if (error) throw error;
  return data || [];
}

export async function cancelTicketByGuest(
  ticketId: string,
  reasonCode: string,
  comment?: string
) {
  const s = supa();
  if (!s) throw new Error("No Supabase client");

  const { data, error } = await s.rpc("cancel_ticket_by_guest", {
    p_ticket_id: ticketId,
    p_reason_code: reasonCode,
    p_comment: comment,
  });

  if (error) throw error;
  return data;
}


export async function addGuestComment(
  ticketId: string,
  comment: string
) {
  const s = supa();
  if (!s) throw new Error("No Supabase client");

  const { data, error } = await s.rpc("add_guest_comment", {
    p_ticket_id: ticketId,
    p_comment: comment,
  });

  if (error) throw error;
  return data;
}

export async function getTicketComments(ticketId: string) {
  const s = supa();
  if (!s) return [];

  // Fetch guest-visible events: comments + curated system messages
  const { data, error } = await s
    .from('ticket_events')
    .select('id, event_type, actor_type, comment, created_at, new_status, previous_status')
    .eq('ticket_id', ticketId)
    .in('event_type', [
      'COMMENT_ADDED',
      'CREATED',
      'STARTED',
      'BLOCKED',
      'UNBLOCKED',
      'COMPLETED',
      'CANCELLED',
      'REOPENED'
    ])
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

// Get all ticket events for staff drawer (includes system events, comments, etc.)
export async function getTicketEvents(ticketId: string) {
  const s = supa();
  if (!s) return [];

  const { data, error } = await s
    .from('ticket_events')
    .select('id, event_type, actor_type, actor_id, comment, created_at, new_status, previous_status, reason_code')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

// Add staff comment to ticket
export async function addStaffComment(ticketId: string, comment: string) {
  const s = supa();
  if (!s) throw new Error('Not authenticated');

  const { data, error } = await s.rpc('add_staff_comment', {
    p_ticket_id: ticketId,
    p_comment: comment
  });

  if (error) throw error;
  return data;
}



export async function getTicketTimeline(ticketId: string) {
  const s = supa();
  if (!s) return [];
  const { data, error } = await s
    .from("v_ticket_timeline")
    .select("*")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error('[getTicketTimeline] error:', error);
    return [];
  }
  return data || [];
}

/* ============================================================================
   AI Ops Co-pilot – Heatmap & Staffing Plan
============================================================================ */

export async function fetchOpsHeatmap(params: {
  hotelId: string;
  from?: string;
  to?: string;
}) {
  const search = new URLSearchParams();
  search.set("hotelId", params.hotelId);
  if (params.from) search.set("from", params.from);
  if (params.to) search.set("to", params.to);
  const qs = search.toString();
  const path = `/ops-heatmap${qs ? `?${qs}` : ""}`;
  return req<OpsHeatmapPoint[]>(path);
}

export async function fetchStaffingPlan(params: {
  hotelId: string;
  date: string;
}) {
  const search = new URLSearchParams();
  search.set("hotelId", params.hotelId);
  search.set("date", params.date);
  const qs = search.toString();
  const path = `/staffing-plan${qs ? `?${qs}` : ""}`;
  return req<StaffingPlanRow[]>(path);
}

/* ============================================================================
   Orders
============================================================================ */

export async function fetchHotelOrders(params: {
  hotelId?: string;
  status?: "open" | "closed";
  limit?: number;
  since?: string;
}) {
  const s = supa();

  // Try Supabase direct read first
  if (s) {
    try {
      let query = s.from("orders").select("*");

      if (params.hotelId) {
        query = query.eq("hotel_id", params.hotelId);
      }

      if (params.status) {
        query = query.eq("status", params.status);
      }

      if (params.since) {
        query = query.gte("created_at", params.since);
      }

      query = query.order("created_at", { ascending: false });

      if (params.limit) {
        query = query.limit(params.limit);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[fetchHotelOrders] Supabase error:', error);
        throw error;
      }

      console.log('[fetchHotelOrders] Successfully fetched', data?.length || 0, 'orders');
      return { items: data || [] };
    } catch (err) {
      console.warn("[fetchHotelOrders] Supabase failed, falling back to HTTP", err);
    }
  }

  // Fallback to HTTP API
  const search = new URLSearchParams();
  if (params.hotelId) search.set("hotelId", params.hotelId);
  if (params.status) search.set("status", params.status);
  if (typeof params.limit === "number") {
    search.set("limit", String(params.limit));
  }
  if (params.since) search.set("since", params.since);

  const qs = search.toString();
  const basePath = IS_SUPABASE_FUNCTIONS ? "/hotel-orders" : "/orders";
  const path = `${basePath}${qs ? `?${qs}` : ""}`;

  const res = await req<any>(path);

  if (res && (Array.isArray(res.items) || Array.isArray(res.orders))) {
    const items = (res.items ?? res.orders) as any[];
    return { ...res, items };
  }
  if (Array.isArray(res)) {
    return { items: res as any[] };
  }
  return res;
}

export async function createOrder(
  data: Json
): Promise<{ id: string } & Record<string, any>> {
  const s = supa();

  // Try Supabase direct insert first
  if (s) {
    try {
      const hotelId = (data as any).hotelId || (data as any).hotel_id || (data as any).propertyId;
      const bookingCode = (data as any).bookingCode || (data as any).booking_code || (data as any).code;
      const items = (data as any).items || [];
      const total = (data as any).total || 0;
      const source = (data as any).source || 'guest';

      // Create one row per item (orders table has item_key column)
      const orderRows = items.map((item: any) => ({
        hotel_id: hotelId,
        booking_code: bookingCode,
        item_key: item.item_key || item.itemKey,
        qty: item.qty || item.quantity || 1,
        price: item.price || 0,
        status: 'open',
      }));

      console.log('[createOrder] Creating order rows via Supabase:', orderRows);

      const { data: orders, error } = await s
        .from("orders")
        .insert(orderRows)
        .select();

      if (error) {
        console.error('[createOrder] Supabase error:', error);
        throw error;
      }

      if (orders && orders.length > 0) {
        console.log('[createOrder] Orders created successfully:', orders.length, 'items');
        // Return the first order ID (they're all part of the same order)
        return {
          id: orders[0].id,
          items: orders,
          total: total,
        };
      }
    } catch (err) {
      console.warn("[createOrder] Supabase failed, falling back to HTTP", err);
    }
  }

  // Fallback to HTTP API
  const res = await req<any>(`/orders`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  const id =
    (res as any)?.id ?? (res as any)?.orderId ?? (res as any)?.data?.id ?? null;
  if (!id) {
    return {
      id: demoId("ord"),
      demo: true,
      ...(typeof res === "object" ? res : {}),
    };
  }
  return { id: String(id), ...(typeof res === "object" ? res : {}) };
}

export async function listOrders(hotelId?: string) {
  return fetchHotelOrders({ hotelId });
}

export async function updateOrder(id: string, patch: Json) {
  return req(`/orders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/* ============================================================================
   Guest Profile (Owner unified view)
============================================================================ */
export async function fetchGuestProfile(params: {
  hotelId?: string;
  guestId?: string;
  bookingCode?: string;
  phone?: string;
  email?: string;
}) {
  const search = new URLSearchParams();
  if (params.hotelId) search.set("hotelId", params.hotelId);
  if (params.guestId) search.set("guestId", params.guestId);
  if (params.bookingCode) search.set("bookingCode", params.bookingCode);
  if (params.phone) search.set("phone", params.phone);
  if (params.email) search.set("email", params.email);

  const qs = search.toString();
  const path = `/guest-profile${qs ? `?${qs}` : ""}`;

  return req<GuestProfilePayload>(path);
}

/* ============================================================================
   Guest Identity
============================================================================ */
export async function fetchGuestIdentity(
  token?: string
): Promise<GuestIdentity | null> {
  const headers = await getAuthHeaders(token);
  const res = await req<any>("/guest-identity", { headers }).catch(() => null);

  if (!res) return null;
  if (res.ok === false) return null;

  const identity =
    (res.identity as GuestIdentity) ??
    (res.guest as GuestIdentity) ??
    (res.data as GuestIdentity) ??
    (res as GuestIdentity);

  return identity || null;
}

export async function upsertGuestIdentity(
  payload: Partial<GuestIdentity>,
  token?: string
): Promise<{ ok: boolean; identity?: GuestIdentity }> {
  const headers = await getAuthHeaders(token);

  const res = await req<any>("/guest-identity-upsert", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const identity =
    (res.identity as GuestIdentity) ??
    (res.data as GuestIdentity) ??
    (res as GuestIdentity);

  return { ok: res?.ok !== false, identity };
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

/**
 * Checkout is used by Guest flow.
 * We now accept multiple legacy keys and normalize them:
 *  - bookingCode
 *  - booking_code
 *  - code
 *  - stayCode
 *
 * We also pass both camelCase + snake_case to backend to avoid contract mismatch.
 */
export async function checkout(data: {
  bookingCode?: string;
  booking_code?: string;
  code?: string;
  stayCode?: string;
  autopost?: boolean;

  // optional context keys:
  property?: string;
  propertySlug?: string;
  property_slug?: string;
  hotelSlug?: string;
  hotel_slug?: string;
}) {
  const rawCode =
    data.bookingCode ??
    (data as any).booking_code ??
    (data as any).code ??
    (data as any).stayCode;

  const bookingCode = rawCode
    ? String(rawCode).trim().toUpperCase()
    : undefined;

  const rawProperty =
    (data as any).property ??
    (data as any).propertySlug ??
    (data as any).property_slug ??
    (data as any).hotelSlug ??
    (data as any).hotel_slug;

  const propertySlug = rawProperty ? String(rawProperty).trim() : undefined;

  const body: any = {
    autopost: data.autopost,
  };

  if (bookingCode) {
    body.bookingCode = bookingCode;
    body.booking_code = bookingCode;
    body.code = bookingCode; // extra safety
  }

  if (propertySlug) {
    body.property = propertySlug;
    body.propertySlug = propertySlug;
    body.property_slug = propertySlug;
    body.hotelSlug = propertySlug;
    body.hotel_slug = propertySlug;
  }

  return req(`/checkout`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function checkoutWithAutoContext(params: {
  code: string;
  token?: string;
  autopost?: boolean;
}) {
  const bookingCode = String(params.code || "").trim().toUpperCase();
  const propertySlug = await getPropertySlugForBooking(bookingCode, params.token);

  return checkout({
    bookingCode,
    propertySlug: propertySlug ?? undefined,
    autopost: params.autopost,
  });
}

export async function checkoutLegacy(data: {
  bookingCode?: string;
  autopost?: boolean;
}) {
  // Back-compat wrapper if any old imports exist in codebase.
  return checkout(data);
}

export async function checkoutFlow(data: {
  bookingCode?: string;
  autopost?: boolean;
}) {
  // Alias for readability in some pages.
  return checkout(data);
}

export async function checkoutGuest(data: {
  bookingCode?: string;
  autopost?: boolean;
}) {
  return checkout(data);
}

export async function endStay(
  bookingCode: string,
  autopost: boolean = true
) {
  return checkout({ bookingCode, autopost });
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
============================================================================ */
export async function fetchOwnerApps(
  status: OwnerApp["status"] = "pending",
  token?: string
): Promise<{ items: OwnerApp[] }> {
  const headers = await getAuthHeaders(token);
  const q = `?status=${encodeURIComponent(status)}`;
  return req<{ items: OwnerApp[] }>(`/owner/apps${q}`, { headers });
}

export async function reviewOwnerApp(
  id: string,
  action: "approve" | "reject",
  opts?: { review_notes?: string; rejected_reason?: string },
  token?: string
) {
  const headers = await getAuthHeaders(token);
  return req<{ ok: boolean }>(`/owner/apps/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ action, ...opts }),
  });
}

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
   Catalog alias exports used historically
   ✅ FIX: forward hotel key instead of dropping args.
============================================================================ */

/**
 * Back-compat argument parser for legacy calls:
 *  - services(hotelId)
 *  - services({ hotelId })
 *  - services({ hotelSlug })
 */
function legacyHotelArg(args: any[]): string | undefined {
  if (!args || !args.length) return undefined;
  const first = args[0];
  return normalizeHotelKey(first);
}

/** ✅ These are used by older UI. We must not ignore args. */
export const services = (...args: any[]) => getServices(legacyHotelArg(args));
export const menu = (...args: any[]) => getMenu(legacyHotelArg(args));

/* ============================================================================
   NEW: Checkout context helper
   - lets UI auto-fill bookingCode + propertySlug + available credits.
   - adds safe status flags for post-checkout UI gating.
============================================================================ */

export type CheckoutContext = {
  bookingCode: string;
  propertySlug: string | null;
  credits: { items: CreditBalance[]; total?: number } | null;
  stay: Stay | null;

  /** Backward-compatible computed flags for UI */
  isUpcoming?: boolean;
  isActive?: boolean;
  isCompleted?: boolean;
};

export async function fetchCheckoutContext(params: {
  code: string;
  token?: string;
}): Promise<CheckoutContext> {
  const bookingCode = String(params.code || "").trim().toUpperCase();

  const stay = await getStayByCode(bookingCode, params.token);
  const propertySlug = stay?.hotel_slug ?? null;

  const credits = await myCredits(params.token).catch(() => null);

  const status = stay?.status;
  const isUpcoming = status === "upcoming";
  const isActive = status === "active";
  const isCompleted = status === "completed";

  return {
    bookingCode,
    propertySlug,
    credits,
    stay,
    isUpcoming,
    isActive,
    isCompleted,
  };
}

/* ============================================================================
   Grouped export + Back-compat
============================================================================ */
export const api = {
  API,
  API_URL,
  IS_SUPABASE_FUNCTIONS,
  req,
  isDemo,

  // self-claim + session
  claimInit,
  claimVerify,
  myStays,
  getStayByCode,
  getPropertySlugForBooking,
  isStayCompleted,
  isStayActive,

  // referrals & credits
  referralInit,
  referralApply,
  myCredits,
  redeemCredits,
  clampRedeemAmount,

  // hotel
  getHotel,
  upsertHotel,

  // consent
  setBookingConsent,

  // catalog
  getServices,
  getMenu,
  services,
  menu,
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

  // AI Ops Co-pilot
  fetchOpsHeatmap,
  fetchStaffingPlan,

  // orders
  createOrder,
  listOrders,
  updateOrder,
  fetchHotelOrders,

  // guest profile + identity
  fetchGuestProfile,
  fetchGuestIdentity,
  upsertGuestIdentity,

  // folio/flows
  getFolio,
  precheck,
  regcard,
  checkout,
  checkoutWithAutoContext,
  endStay,

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

  // grid (VPP)
  gridGetDevices,
  gridSaveDevices,
  gridGetPlaybooks,
  gridSavePlaybooks,
  gridStartEvent,
  gridStepEvent,
  gridStopEvent,
  gridListEvents,
  gridDeviceShed,
  gridDeviceRestore,
  gridDeviceNudge,

  // grid energy analytics
  gridFetchDeviceEnergyDaily,
  gridFetchZoneEnergyDaily,
  gridFetchSilentKillers,

  // owner apps (admin)
  fetchOwnerApps,
  reviewOwnerApp,
  approveOwnerApp,
  rejectOwnerApp,

  // workforce / labour beta
  getMyWorkforceProfile,
  saveMyWorkforceProfile,
  listOpenJobs,
  listPropertyJobs,
  postJob,
  applyToJob,
  listMyApplications,
  listJobApplications,

  // checkout context
  fetchCheckoutContext,
};

// ---------------- Owner – Occupancy & Revenue ----------------

export type OwnerOccupancySnapshot = {
  roomsTotal: number | null;
  occupiedRooms: number;
  occupancyPercent: number;
};

export type OwnerOccupancyPoint = {
  day: string;
  occupancyPercent: number;
};

export type OwnerOccupancyResponse = {
  hotelSlug: string;
  snapshot: OwnerOccupancySnapshot;
  history: OwnerOccupancyPoint[];
};

export type OwnerRevenuePoint = {
  day: string;
  totalRevenue: number;
  roomRevenue: number;
  fnbRevenue: number;
};

export type OwnerRevenueSummary = {
  totalRevenue: number;
  roomRevenue: number;
  fnbRevenue: number;
  avgDailyRevenue: number;
};

export type OwnerRevenueResponse = {
  hotelSlug: string;
  range: string;
  summary: OwnerRevenueSummary;
  series: OwnerRevenuePoint[];
};

export async function fetchOwnerOccupancy(
  slug: string
): Promise<OwnerOccupancyResponse> {
  const params = new URLSearchParams({
    metric: "occupancy",
    slug,
  });

  const res = await fetch(
    `${API_URL}/owner/${encodeURIComponent(
      slug
    )}/occupancy?${params.toString()}`,
    {
      credentials: "include",
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to load occupancy for ${slug}`);
  }

  return res.json();
}

export async function fetchOwnerRevenue(
  slug: string,
  range: string = "30d"
): Promise<OwnerRevenueResponse> {
  const params = new URLSearchParams({
    metric: "revenue",
    slug,
    range,
  });

  const res = await fetch(
    `${API_URL}/owner/${encodeURIComponent(slug)}/revenue?${params.toString()}`,
    {
      credentials: "include",
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to load revenue for ${slug}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Rooms API
// ---------------------------------------------------------------------------

export type Room = {
  id: string;
  hotel_id: string;
  // Support both schemas just in case, but prioritize 'number'/'floor'
  floor_number?: number;
  floor?: number;
  room_number?: string;
  number?: string;
  status?: string;
};

export async function listRooms(hotelId: string): Promise<Room[]> {
  console.log("[listRooms] called with hotelId:", hotelId);

  // If we are using Edge Functions for everything, use the /rooms endpoint
  if (IS_SUPABASE_FUNCTIONS) {
    try {
      console.log("[listRooms] fetching from Edge Function...");
      const res = await req<{ items: Room[] }>(`/rooms?hotelId=${hotelId}`);
      console.log("[listRooms] Edge Function response:", res);
      return res.items || [];
    } catch (e) {
      console.warn("Failed to fetch rooms from API, falling back to direct/demo", e);
    }
  }

  // Fallback / Direct DB access logic
  const supaClient = supa();
  if (supaClient) {
    console.log("[listRooms] fetching from direct DB...");
    const { data, error } = await supaClient
      .from("rooms")
      .select("*")
      .eq("hotel_id", hotelId)
      // Try ordering by standard columns if possible, but simpler to just fetch all
      // The DB has 'floor' and 'number'.
      .order("floor", { ascending: true })
      .order("number", { ascending: true });

    if (error) {
      console.error("[listRooms] DB error:", error);
      // It's possible the sorting failed if columns don't exist.
      // If so, retry without sort? Or just accept the error.
    } else {
      console.log("[listRooms] DB data length:", data?.length);
    }

    if (data && data.length > 0) {
      return data as Room[];
    }
  } else {
    console.log("[listRooms] No Supabase client available for direct access");
  }

  // Fallback to demo/mock data if table empty or no client
  if (isDemo()) {
    return [];
  }

  return [];
}
