// web/src/lib/api.ts

export const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';
// Back-compat alias for older files (e.g. Menu.tsx):
export const API_URL = API;

async function req<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
    ...opts,
  });

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
}

// -----------------------------
// Hotel (OwnerSettings / Theming)
// -----------------------------
export async function getHotel(slug: string) {
  return req(`/hotel/${encodeURIComponent(slug)}`);
}

export async function upsertHotel(payload: any) {
  return req(`/hotel/upsert`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// -----------------------------
// Consent
// -----------------------------
export async function setBookingConsent(code: string, reviews: boolean) {
  return req(`/booking/${encodeURIComponent(code)}/consent`, {
    method: 'POST',
    body: JSON.stringify({ reviews }),
  });
}

// -----------------------------
// Catalog
// -----------------------------
export async function getServices() {
  return req(`/catalog/services`);
}

export async function getMenu() {
  return req(`/menu/items`);
}

// -----------------------------
// Tickets
// -----------------------------
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

// -----------------------------
// Orders
// -----------------------------
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

// -----------------------------
// Folio / Flows
// -----------------------------
export async function getFolio() {
  return req(`/folio`);
}

export async function precheck(data: any) {
  return req(`/precheck`, { method: 'POST', body: JSON.stringify(data) });
}

export async function regcard(data: any) {
  return req(`/regcard`, { method: 'POST', body: JSON.stringify(data) });
}

/**
 * Checkout
 * Pass `{ bookingCode, autopost }`.
 * - If `autopost: true`, server may publish or create a pending review based on policy/consent.
 */
export async function checkout(data: { bookingCode?: string; autopost?: boolean }) {
  return req(`/checkout`, { method: 'POST', body: JSON.stringify(data) });
}

// -----------------------------
// Reviews (manual + AI + approvals)
// -----------------------------
export async function listReviews(slug: string) {
  return req(`/reviews/${encodeURIComponent(slug)}`);
}

export async function listPendingReviews() {
  return req(`/reviews-pending`);
}

export async function postManualReview(data: {
  bookingCode: string;
  rating: number;
  title?: string;
  body?: string;
}) {
  return req(`/reviews`, { method: 'POST', body: JSON.stringify(data) });
}

export async function reviewDraft(bookingCode: string) {
  return req(`/reviews/draft/${encodeURIComponent(bookingCode)}`);
}

export async function postAutoReviewPreview(bookingCode: string) {
  return req(`/reviews/auto`, {
    method: 'POST',
    body: JSON.stringify({ bookingCode }),
  });
}

export async function postAutoReviewCommit(bookingCode: string) {
  return req(`/reviews/auto`, {
    method: 'POST',
    body: JSON.stringify({ bookingCode, commit: true }),
  });
}

export async function approveReview(id: string, bookingCode: string) {
  return req(`/reviews/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    body: JSON.stringify({ bookingCode }),
  });
}

export async function rejectReview(id: string, bookingCode: string) {
  return req(`/reviews/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ bookingCode }),
  });
}

// -----------------------------
// Experience (reports)
// -----------------------------
export async function getExperienceSummary(bookingCode: string) {
  return req(`/experience/summary/${encodeURIComponent(bookingCode)}`);
}

export async function getExperienceReport(slug: string) {
  return req(`/experience/report/${encodeURIComponent(slug)}`);
}

// -----------------------------
// Quick Check-in
// -----------------------------
export async function quickCheckin(data: { code: string; phone: string }) {
  return req(`/checkin`, { method: 'POST', body: JSON.stringify(data) });
}

// -----------------------------
// Export as a grouped API (optional)
// -----------------------------
export const api = {
  API,
  API_URL, // back-compat
  req,

  // hotel
  getHotel,
  upsertHotel,

  // consent
  setBookingConsent,

  // catalog
  getServices,
  getMenu,

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
