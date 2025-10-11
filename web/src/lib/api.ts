// web/src/lib/api.ts

// Base URL (set on Netlify as VITE_API_URL, e.g. https://your-api.example.com)
export const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';
export const API_URL = API; // back-compat

/** When API is unreachable and demo fallbacks are used, we flip this on. */
export let DEMO_MODE = false;
export const isDemo = () => DEMO_MODE;

/* ============================================================================
   Types (lightweight)
============================================================================ */
export type Stay = {
  code: string;
  status: 'upcoming' | 'active' | 'completed';
  hotel_slug?: string;
  hotel_name?: string;
  check_in?: string;
  check_out?: string;
};

// after the Stay type
export type Service = {
  key: string;
  label_en: string;
  sla_minutes: number;
};


export type ReferralIdentifier = {
  /** exactly one of these should be provided */
  accountId?: string;
  phone?: string;
  email?: string;
};

export type CreditBalance = {
  property: string;        // property slug (e.g., "sunrise")
  balance: number;         // in currency minor units if your API does that, or just number
  currency?: string;       // e.g., "INR"
  expiresAt?: string | null;
};

type Json = Record<string, unknown> | Array<unknown> | string | number | boolean | null;

/* ============================================================================
   HTTP helpers
============================================================================ */
function withTimeout<T>(p: Promise<T>, ms = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Network timeout')), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

function buildHeaders(opts: RequestInit): HeadersInit {
  const h: Record<string, string> = { ...(opts.headers as Record<string, string> | undefined) };
  // Only set Content-Type if we’re sending a body and caller didn’t set it
  const hasBody = typeof opts.body !== 'undefined';
  if (hasBody && !Object.keys(h).some(k => k.toLowerCase() === 'content-type')) {
    h['Content-Type'] = 'application/json';
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

    // Try to parse as JSON if possible, else text
    const ct = r.headers.get('content-type') || '';
    const isJson = ct.includes('application/json');
    const payload = isJson ? await r.json() : await r.text();

    if (!r.ok) {
      const msg =
        (isJson && (payload as any)?.error) ||
        (typeof payload === 'string' && payload.trim()) ||
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
  slug: 'sunrise',
  name: 'Sunrise Resort',
  description: 'Hill-view stay powered by VAiyu',
  address: 'Mall Road, Nainital, Uttarakhand',
  amenities: ['WiFi', 'Parking', 'Breakfast', 'Pet Friendly'],
  phone: '+91-99999-99999',
  email: 'hello@sunrise.example',
  theme: { brand: '#145AF2', mode: 'light' as const },
};

const demoServices = [
  { key: 'towel', label_en: 'Towel', sla_minutes: 25 },
  { key: 'room_cleaning', label_en: 'Room Cleaning', sla_minutes: 30 },
  { key: 'water_bottle', label_en: 'Water Bottles', sla_minutes: 20 },
  { key: 'extra_pillow', label_en: 'Extra Pillow', sla_minutes: 20 },
];

const demoMenu = [
  { item_key: 'veg_sandwich', name: 'Veg Sandwich', base_price: 120 },
  { item_key: 'masala_tea', name: 'Masala Tea', base_price: 40 },
];

const demoReport = {
  hotel: { slug: 'sunrise', name: 'Sunrise Resort' },
  period: 'all-time (demo)',
  kpis: { tickets: 7, orders: 4, onTime: 9, late: 2, avgMins: 18 },
  hints: ['Investigate 2 SLA breach(es); consider buffer or staffing in peak hours.'],
};

function demoFallback<T>(path: string, opts: RequestInit): T | undefined {
  const p = path.replace(/\/+$/, '');

  if (p.startsWith('/hotel/')) return demoHotel as unknown as T;
  if (p === '/catalog/services') return { items: demoServices } as unknown as T;
  if (p === '/menu/items') return { items: demoMenu } as unknown as T;
  if (p.startsWith('/experience/report')) return demoReport as unknown as T;

  if (p === '/reviews/pending' || p === '/reviews-pending')
    return { items: [] } as unknown as T;

  if (p === '/tickets') return { items: [] } as unknown as T;
  if (p === '/orders') return { items: [] } as unknown as T;

  // Self-claim fallbacks
  if (p === '/claim/init')
    return {
      ok: true,
      method: 'otp',
      sent: true,
      demo: true,
      otp_hint: '123456',
    } as unknown as T;

  if (p === '/claim/verify') {
    return {
      ok: true,
      token: 'demo-stay-token',
      booking: { code: 'ABC123', guest_name: 'Test Guest', hotel_slug: 'sunrise' },
    } as unknown as T;
  }

  // Guest "my stays"
  if (p === '/me/stays') {
    const stays: Stay[] = [
      {
        code: 'ABC123',
        status: 'upcoming',
        hotel_slug: 'sunrise',
        hotel_name: 'Sunrise Resort',
        check_in: new Date(Date.now() + 2 * 86400000).toISOString(),
        check_out: new Date(Date.now() + 5 * 86400000).toISOString(),
      },
      {
        code: 'LIVE001',
        status: 'active',
        hotel_slug: 'sunrise',
        hotel_name: 'Sunrise Resort',
        check_in: new Date(Date.now() - 1 * 86400000).toISOString(),
        check_out: new Date(Date.now() + 1 * 86400000).toISOString(),
      },
      {
        code: 'DONE789',
        status: 'completed',
        hotel_slug: 'sunrise',
        hotel_name: 'Sunrise Resort',
        check_in: new Date(Date.now() - 14 * 86400000).toISOString(),
        check_out: new Date(Date.now() - 10 * 86400000).toISOString(),
      },
    ];
    return { stays, items: stays } as unknown as T;
  }

  // Referrals & Credits (demo)
  if (p === '/referrals/init') {
    const body = safeJson(opts.body);
    const property = body?.property ?? 'sunrise';
    return {
      ok: true,
      code: 'SUN-9X7Q',
      shareUrl: `https://www.vaiyu.co.in/hotel/${property}?ref=SUN-9X7Q`,
      demo: true
    } as unknown as T;
  }
  if (p === '/referrals/apply') {
    return { ok: true, status: 'pending' } as unknown as T;
  }
  if (p === '/credits/mine') {
    const items: CreditBalance[] = [
      { property: 'sunrise', balance: 750, currency: 'INR', expiresAt: new Date(Date.now() + 15552000000).toISOString() }
    ];
    return { items, total: 750 } as unknown as T;
  }
  if (p === '/credits/redeem') {
    const body = safeJson(opts.body);
    const newBalance = Math.max(0, 750 - (Number(body?.amount) || 0));
    return { ok: true, newBalance } as unknown as T;
  }

  return undefined;
}

/* small util for demoFallback */
function safeJson(body: any): any {
  try {
    if (!body) return undefined;
    return typeof body === 'string' ? JSON.parse(body) : body;
  } catch {
    return undefined;
  }
}

/* ============================================================================
   Self-claim (guest attaches an existing booking)
============================================================================ */

/** Starts a claim by sending/creating an OTP for the booking code + contact. */
export async function claimInit(code: string, contact: string) {
  // Keep a back-compat object form for server expectations
  return req(`/claim/init`, {
    method: 'POST',
    body: JSON.stringify({ code, phone: contact }),
  });
}

/** Verifies the OTP and returns a short-lived token (store in localStorage). */
export async function claimVerify(code: string, otp: string) {
  return req(`/claim/verify`, {
    method: 'POST',
    body: JSON.stringify({ code, otp }),
  });
}

/** Fetch current guest’s stays (Bearer token required). Returns both {stays} and {items} for compatibility. */
export async function myStays(token: string): Promise<{ stays: Stay[]; items: Stay[] }> {
  const res = await req<any>('/me/stays', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const stays: Stay[] = res?.stays ?? res?.items ?? [];
  return { stays, items: stays };
}

/** Upsert/replace the full services catalog (owner side). */
export async function saveServices(items: Service[]) {
  // server expects { items: Service[] }
  return req(`/catalog/services`, {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}

/** Generic POST upsert helper some owner pages use. */
export async function apiUpsert(path: string, payload: unknown) {
  return req(path, { method: 'POST', body: JSON.stringify(payload) });
}

/** Generic DELETE helper some owner pages use. */
export async function apiDelete(path: string) {
  return req(path, { method: 'DELETE' });
}


/* ============================================================================
   Referrals & Credits (property-scoped)
============================================================================ */

/**
 * Start a referral for a property. Returns a shareable code+URL.
 * Token is optional here if public; include if your API requires auth.
 */
export async function referralInit(property: string, token?: string, channel = 'guest_dashboard') {
  return req(`/referrals/init`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: JSON.stringify({ property, channel }),
  });
}

/**
 * Apply a referral to a referee booking using ONE of: referrer VAiyu Account ID, phone, or email.
 * Example calls:
 *   referralApply('ABC123', { phone: '+9199...' })
 *   referralApply('ABC123', { email: 'user@example.com' })
 *   referralApply('ABC123', { accountId: 'acc_123' })
 */
export async function referralApply(bookingCode: string, referrer: ReferralIdentifier) {
  const body: any = { bookingCode };
  const keys = ['accountId', 'phone', 'email'] as const;

  // copy exactly one identifier if present
  for (const k of keys) {
    if ((referrer as any)[k]) body.referrer = { [k]: (referrer as any)[k] };
  }

  return req(`/referrals/apply`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Get my credit balances (per property) */
export async function myCredits(token: string): Promise<{ items: CreditBalance[]; total?: number }> {
  return req(`/credits/mine`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Redeem credits for a property context (e.g., F&B order). */
export async function redeemCredits(token: string, property: string, amount: number, context?: any) {
  return req(`/credits/redeem`, {
    method: 'POST',
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
  return req(`/hotel/upsert`, { method: 'POST', body: JSON.stringify(payload) });
}

/* ============================================================================
   Consent
============================================================================ */
export async function setBookingConsent(code: string, reviews: boolean) {
  return req(`/booking/${encodeURIComponent(code)}/consent`, {
    method: 'POST',
    body: JSON.stringify({ reviews }),
  });
}

/* ============================================================================
   Catalog
============================================================================ */
export async function getServices() {
  return req(`/catalog/services`);
}
export async function getMenu() {
  return req(`/menu/items`);
}

/* ============================================================================
   Tickets
============================================================================ */
export async function createTicket(data: Json) {
  return req(`/tickets`, { method: 'POST', body: JSON.stringify(data) });
}
export async function listTickets() {
  return req(`/tickets`);
}
export async function getTicket(id: string) {
  return req(`/tickets/${encodeURIComponent(id)}`);
}
export async function updateTicket(id: string, patch: Json) {
  return req(`/tickets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/* ============================================================================
   Orders
============================================================================ */
export async function createOrder(data: Json) {
  return req(`/orders`, { method: 'POST', body: JSON.stringify(data) });
}
export async function listOrders() {
  return req(`/orders`);
}
export async function updateOrder(id: string, patch: Json) {
  return req(`/orders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
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
  return req(`/precheck`, { method: 'POST', body: JSON.stringify(data) });
}
export async function regcard(data: Json) {
  return req(`/regcard`, { method: 'POST', body: JSON.stringify(data) });
}
export async function checkout(data: { bookingCode?: string; autopost?: boolean }) {
  return req(`/checkout`, { method: 'POST', body: JSON.stringify(data) });
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
  bookingCode: string; rating: number; title?: string; body?: string;
}) {
  return req(`/reviews`, { method: 'POST', body: JSON.stringify(data) });
}
export async function reviewDraft(bookingCode: string) {
  return req(`/reviews/draft/${encodeURIComponent(bookingCode)}`);
}
export async function postAutoReviewPreview(bookingCode: string) {
  return req(`/reviews/auto`, { method: 'POST', body: JSON.stringify({ bookingCode }) });
}
export async function postAutoReviewCommit(bookingCode: string) {
  return req(`/reviews/auto`, { method: 'POST', body: JSON.stringify({ bookingCode, commit: true }) });
}
export async function approveReview(id: string, bookingCode?: string) {
  return req(`/reviews/approve`, {
    method: 'POST',
    body: JSON.stringify({ id, bookingCode }),
  });
}
export async function rejectReview(id: string, bookingCode?: string) {
  return req(`/reviews/reject`, {
    method: 'POST',
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
  return req(`/checkin`, { method: 'POST', body: JSON.stringify(data) });
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
  services: (..._args: any[]) => getServices(), // back-compat alias
  menu: (..._args: any[]) => getMenu(),         // back-compat alias
  saveServices,
  apiUpsert,
  apiDelete,

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
};
