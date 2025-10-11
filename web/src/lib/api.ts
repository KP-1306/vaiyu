// web/src/lib/api.ts

// Base URL (set on Netlify as VITE_API_URL, e.g. https://your-api.example.com)
export const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';
export const API_URL = API; // back-compat

/** When API is unreachable and demo fallbacks are used, we flip this on. */
export let DEMO_MODE = false;
export const isDemo = () => DEMO_MODE;

/* ---------------- Self-claim (guest attaches an existing booking) --------- */
export async function claimInit(data: { code: string; phone: string }) {
  // Starts a claim by sending/creating an OTP for the booking code + phone
  return req(`/claim/init`, { method: 'POST', body: JSON.stringify(data) });
}

export async function claimVerify(data: { code: string; otp: string }) {
  // Verifies the OTP and returns a short-lived token you can store in localStorage
  return req(`/claim/verify`, { method: 'POST', body: JSON.stringify(data) });
}


// ---------- small helper: timeout + safe fetch ----------
function withTimeout<T>(p: Promise<T>, ms = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Network timeout')), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

async function req<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  try {
    const r = await withTimeout(fetch(`${API}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
    }));
    const ct = r.headers.get('content-type') || '';
    const isJson = ct.includes('application/json');
    const payload = isJson ? await r.json() : await r.text();
    if (!r.ok) {
      const msg =
        (isJson && (payload as any)?.error) ||
        (typeof payload === 'string' ? payload : 'Request failed');
      throw new Error(msg);
    }
    return payload as T;
  } catch (e) {
    const fallback = demoFallback<T>(path, opts);
    if (fallback !== undefined) {
      DEMO_MODE = true;            // ✅ flip on once we use a fallback
      return fallback;
    }
    throw e;
  }
}

/* ------------------------------------------------------------------
   DEMO FALLBACKS: return realistic data shapes when API is offline
-------------------------------------------------------------------*/
const demoHotel = {
  slug: 'sunrise',
  name: 'Sunrise Resort',
  description: 'Hill-view stay powered by VAiyu',
  address: 'Mall Road, Nainital, Uttarakhand',
  amenities: ['WiFi', 'Parking', 'Breakfast', 'Pet Friendly'],
  phone: '+91-99999-99999',
  email: 'hello@sunrise.example',
  theme: { brand: '#145AF2', mode: 'light' },
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
  hints: [
    'Investigate 2 SLA breach(es); consider buffer or staffing in peak hours.',
  ],
};

function demoFallback<T>(path: string, _opts: RequestInit): T | undefined {
  const p = path.replace(/\/+$/, '');

  if (p.startsWith('/hotel/')) return demoHotel as unknown as T;

  if (p === '/catalog/services') return { items: demoServices } as unknown as T;

  if (p === '/menu/items') return { items: demoMenu } as unknown as T;

  if (p.startsWith('/experience/report')) return demoReport as unknown as T;

  if (p === '/reviews/pending' || p === '/reviews-pending')
    return { items: [] } as unknown as T;

  if (p === '/tickets') return { items: [] } as unknown as T;

  if (p === '/orders') return { items: [] } as unknown as T;

    if (p === '/claim/init') return { ok: true, method: 'otp', sent: true, demo: true } as unknown as T;
  if (p === '/claim/verify') {
    return {
      ok: true,
      token: 'demo-stay-token',
      booking: { code: 'ABC123', guest_name: 'Test Guest', hotel_slug: 'sunrise' }
    } as unknown as T;
  }


  return undefined;
}

/* ---------------- Hotel ---------------- */
export async function getHotel(slug: string) {
  return req(`/hotel/${encodeURIComponent(slug)}`);
}
export async function upsertHotel(payload: any) {
  return req(`/hotel/upsert`, { method: 'POST', body: JSON.stringify(payload) });
}

/* ---------------- Consent ---------------- */
export async function setBookingConsent(code: string, reviews: boolean) {
  return req(`/booking/${encodeURIComponent(code)}/consent`, {
    method: 'POST',
    body: JSON.stringify({ reviews }),
  });
}

/* ---------------- Catalog ---------------- */
export async function getServices() {
  return req(`/catalog/services`);
}
export async function getMenu() {
  return req(`/menu/items`);
}

/* ---------------- Tickets ---------------- */
export async function createTicket(data: any) {
  return req(`/tickets`, { method: 'POST', body: JSON.stringify(data) });
}
export async function listTickets() {
  return req(`/tickets`);
}
export async function getTicket(id: string) {
  return req(`/tickets/${encodeURIComponent(id)}`);
}
export async function updateTicket(id: string, patch: any) {
  return req(`/tickets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/* ---------------- Orders ---------------- */
export async function createOrder(data: any) {
  return req(`/orders`, { method: 'POST', body: JSON.stringify(data) });
}
export async function listOrders() {
  return req(`/orders`);
}
export async function updateOrder(id: string, patch: any) {
  return req(`/orders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/* ---------------- Folio / Flows ---------------- */
export async function getFolio() {
  return req(`/folio`);
}
export async function precheck(data: any) {
  return req(`/precheck`, { method: 'POST', body: JSON.stringify(data) });
}
export async function regcard(data: any) {
  return req(`/regcard`, { method: 'POST', body: JSON.stringify(data) });
}
export async function checkout(data: { bookingCode?: string; autopost?: boolean }) {
  return req(`/checkout`, { method: 'POST', body: JSON.stringify(data) });
}

/* ---------------- Reviews ---------------- */
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

/* ---------------- Experience (reports) ---------------- */
export async function getExperienceSummary(bookingCode: string) {
  return req(`/experience/summary/${encodeURIComponent(bookingCode)}`);
}
export async function getExperienceReport(slug: string) {
  return req(`/experience/report/${encodeURIComponent(slug)}`);
}

/* ---------------- Quick Check-in ---------------- */
export async function quickCheckin(data: { code: string; phone: string }) {
  return req(`/checkin`, { method: 'POST', body: JSON.stringify(data) });
}

/* ---------------- Grouped export + Back-compat ---------------- */
export const api = {
  API,
  API_URL,
  req,
  isDemo,

  // hotel
  getHotel,
  upsertHotel,

  // consent
  setBookingConsent,

  // catalog
  getServices,
  getMenu,
  services: (..._args: any[]) => getServices(),
  menu:     (..._args: any[]) => getMenu(),

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
