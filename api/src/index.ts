// api/src/index.ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import 'dotenv/config';
import gridPlugin from './plugins/grid';

await fastify.register(gridPlugin);

import Fastify from 'fastify';
import postgres from '@fastify/postgres';
import cors from '@fastify/cors';
import referralsPlugin from './plugins/referrals';

const fastify = Fastify({ logger: true });

await fastify.register(cors, {
  origin: process.env.CORS_ORIGIN?.split(',').map(s => s.trim()) || true,
  methods: ['GET','POST','PATCH','DELETE','OPTIONS'],
});
await fastify.register(postgres, {
  connectionString: process.env.DATABASE_URL!,
     // ssl: { rejectUnauthorized: false }, // if your provider needs it
});

// ... your other plugins/routes here ...

await fastify.register(referralsPlugin); // <<---- add this

fastify.get('/health', async () => ({ ok: true, t: Date.now() }));

const port = Number(process.env.PORT || 4000);
fastify.listen({ port, host: '0.0.0.0' })
  .then(() => fastify.log.info(`API on :${port}`))
  .catch((e) => { fastify.log.error(e); process.exit(1); });

const app = Fastify({ logger: true });
const PORT = Number(process.env.PORT || 4000);
const ORIGIN = (process.env.CORS_ORIGIN || '*').split(',');

/* =============================================================================
   In-memory demo data (no DB yet)
============================================================================= */
type Theme = { brand?: string; mode?: 'light' | 'dark' };

type ReviewsPolicy = {
  mode?: 'off' | 'preview' | 'auto';
  min_activity?: number;
  block_if_late_exceeds?: number;
  require_consent?: boolean;
};

type Hotel = {
  slug: string;
  name: string;
  description?: string;
  address?: string;
  amenities?: string[];
  phone?: string;
  email?: string;
  logo_url?: string;
  theme?: Theme;
  reviews_policy?: ReviewsPolicy;
};

type Room = {
  hotel_slug: string;
  room_no: string;
  room_type: string;
  is_clean: boolean;
  is_occupied: boolean;
};

type BookingStatus = 'booked' | 'checked_in' | 'completed' | 'cancelled';
type Booking = {
  id: string;
  hotel_slug: string;
  guest_name: string;
  guest_phone: string;
  code: string;
  room_type: string;
  status: BookingStatus;
  room_no?: string;
  checkin_at?: string;
  checkout_at?: string;
  consent_reviews?: boolean;
};

type ReviewStatus = 'draft' | 'pending' | 'published' | 'rejected';
type ReviewVisibility = 'private' | 'public';

type Review = {
  id: string;
  hotel_slug: string;
  rating: number;
  title?: string;
  body?: string;
  verified: boolean;
  created_at: string;
  updated_at?: string;
  guest_name?: string;
  source: 'guest' | 'auto';
  status: ReviewStatus;
  visibility: ReviewVisibility;
  booking_code?: string;
  approval: {
    required: boolean;
    approved: boolean;
    approved_at?: string;
  };
  anchors?: {
    tickets: number;
    orders: number;
    onTime: number;
    late: number;
    avgMins: number;
    details?: string[];
  };
};

type ExperienceSummary = {
  bookingCode: string;
  guest_name?: string;
  hotel_slug: string;
  kpis: { onTime: number; late: number; avgMins: number; tickets: number; orders: number };
  perService?: Array<{ service_key: string; count: number; late: number; avgMins: number }>;
  narrative: { title: string; body: string };
  anchors: NonNullable<Review['anchors']>;
  policyHints?: string[];
};

type Service = { key: string; label_en: string; sla_minutes: number };

/* ---- Demo seed ---- */
const hotel: Hotel = {
  slug: 'sunrise',
  name: 'Sunrise Resort',
  description: 'Hill-view stay powered by VAiyu',
  address: 'Mall Road, Nainital, Uttarakhand',
  amenities: ['WiFi', 'Parking', 'Breakfast', 'Pet Friendly'],
  phone: '+91-99999-99999',
  email: 'hello@sunrise.example',
  logo_url: '',
  theme: { brand: '#145AF2', mode: 'light' },
  reviews_policy: {
    mode: 'preview',
    min_activity: 1,
    block_if_late_exceeds: 0,
    require_consent: true,
  },
};

let services: Service[] = [
  { key: 'towel', label_en: 'Towel', sla_minutes: 25 },
  { key: 'room_cleaning', label_en: 'Room Cleaning', sla_minutes: 30 },
  { key: 'water_bottle', label_en: 'Water Bottles', sla_minutes: 20 },
  { key: 'laundry_pickup', label_en: 'Laundry Pickup', sla_minutes: 30 },
  { key: 'extra_pillow', label_en: 'Extra Pillow', sla_minutes: 20 },
];

const menu = [
  { item_key: 'veg_sandwich', name: 'Veg Sandwich', base_price: 120 },
  { item_key: 'masala_tea', name: 'Masala Tea', base_price: 40 },
];

let rooms: Room[] = [
  { hotel_slug: hotel.slug, room_no: '101', room_type: 'standard', is_clean: true, is_occupied: false },
  { hotel_slug: hotel.slug, room_no: '102', room_type: 'standard', is_clean: true, is_occupied: false },
  { hotel_slug: hotel.slug, room_no: '201', room_type: 'deluxe', is_clean: true, is_occupied: false },
  { hotel_slug: hotel.slug, room_no: '301', room_type: 'suite', is_clean: false, is_occupied: false },
];

let bookings: Booking[] = [
  {
    id: 'b1',
    hotel_slug: hotel.slug,
    guest_name: 'Test Guest',
    guest_phone: '9999999999',
    code: 'ABC123',
    room_type: 'standard',
    status: 'booked',
    consent_reviews: true,
  },
];

let reviews: Review[] = [];

/* Existing demo state (ops) */
type Ticket = {
  id: string;
  service_key: string;
  room: string;
  booking: string;
  tenant?: string;
  status: 'Requested' | 'Accepted' | 'InProgress' | 'Done';
  created_at: string;
  accepted_at?: string;
  started_at?: string;
  done_at?: string;
  sla_minutes: number;
  sla_deadline: string;
};
let tickets: Ticket[] = [];
let orders: any[] = [];
let folio: any = { lines: [{ description: 'Room (EP)', amount: 2800 }], total: 2800 };

/* =============================================================================
   Helpers
============================================================================= */
const nowISO = () => new Date().toISOString();
const addMinutes = (iso: string, mins: number) => new Date(new Date(iso).getTime() + mins * 60000).toISOString();
const minutesBetween = (a: string, b: string) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);

/* Build a review draft from recorded activity */
function buildReviewDraftFromActivity(bookingCode: string) {
  const b = bookings.find((x) => x.code === bookingCode);
  if (!b) return { error: 'Booking not found' };

  const tix = tickets.filter((t) => t.booking === bookingCode);
  let onTime = 0,
    late = 0,
    avgMins = 0;
  const details: string[] = [];

  tix.forEach((t) => {
    const end = t.done_at || t.started_at || t.accepted_at || t.created_at;
    const mins = minutesBetween(t.created_at, end!);
    avgMins += mins;
    const breached = new Date(end!) > new Date(t.sla_deadline);
    breached ? late++ : onTime++;
    details.push(`• ${t.service_key} for room ${t.room} — ${mins} min, ${breached ? 'late vs SLA' : 'on time'}`);
  });
  if (tix.length) avgMins = Math.round(avgMins / tix.length);

  const ords = orders.filter((o) => o.booking === bookingCode || o.stay_code === bookingCode);

  let rating = 5 - late;
  if (late === 0 && tix.length > 0) rating = 5;
  rating = Math.min(5, Math.max(1, rating));

  const title = late ? 'Mixed experience' : tix.length ? 'Smooth & timely service' : 'Pleasant stay';
  const body = [
    `Stay code ${bookingCode}.`,
    tix.length ? `Housekeeping requests handled in ~${avgMins || 0} min on average.` : `No service requests recorded.`,
    late ? `${late} request(s) missed SLA.` : tix.length ? `All requests were within SLA.` : ``,
    ords.length ? `${ords.length} kitchen order(s) recorded.` : ``,
    details.length ? `\nDetails:\n${details.join('\n')}` : ``,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    draft: {
      bookingCode,
      ratingSuggested: rating,
      titleSuggested: title,
      bodySuggested: body,
      anchors: { tickets: tix.length, orders: ords.length, onTime, late, avgMins, details },
    },
    booking: b,
  };
}

/* Owner-facing summary helpers */
function summarizeByService(bookingCode: string) {
  const tix = tickets.filter((t) => t.booking === bookingCode);
  const by: Record<string, { count: number; late: number; totalMins: number }> = {};
  tix.forEach((t) => {
    const end = t.done_at || t.started_at || t.accepted_at || t.created_at;
    const mins = minutesBetween(t.created_at, end!);
    const breached = new Date(end!) > new Date(t.sla_deadline);
    by[t.service_key] ??= { count: 0, late: 0, totalMins: 0 };
    by[t.service_key].count++;
    by[t.service_key].totalMins += mins;
    if (breached) by[t.service_key].late++;
  });
  return Object.entries(by).map(([service_key, v]) => ({
    service_key,
    count: v.count,
    late: v.late,
    avgMins: Math.round(v.totalMins / v.count),
  }));
}

function policyHintsFromAnchors(a: NonNullable<Review['anchors']>): string[] {
  const hints: string[] = [];
  if (a.late > 0) hints.push(`Investigate ${a.late} SLA breach(es); consider buffer or staffing in peak hours.`);
  if (a.avgMins > 30) hints.push(`Average resolution ${a.avgMins} min — review SLA targets or workflow.`);
  return hints.length ? hints : ['No obvious issues. Keep current policies.'];
}

function buildExperienceSummary(bookingCode: string): ExperienceSummary | { error: string } {
  const res = buildReviewDraftFromActivity(bookingCode);
  if ((res as any).error) return res as any;
  const { booking, draft } = res as any;

  const perService = summarizeByService(bookingCode);
  const kpis = {
    onTime: draft.anchors.onTime,
    late: draft.anchors.late,
    avgMins: draft.anchors.avgMins,
    tickets: draft.anchors.tickets,
    orders: draft.anchors.orders,
  };

  return {
    bookingCode,
    guest_name: booking.guest_name,
    hotel_slug: booking.hotel_slug,
    kpis,
    perService,
    narrative: { title: draft.titleSuggested, body: draft.bodySuggested },
    anchors: draft.anchors,
    policyHints: policyHintsFromAnchors(draft.anchors),
  };
}

function shouldAutoPublish(policy: ReviewsPolicy | undefined, draftAnchors: NonNullable<Review['anchors']>, consent: boolean | undefined) {
  const mode = policy?.mode ?? 'preview';
  if (mode !== 'auto') return { allow: false, reason: 'mode_not_auto' };
  const minAct = policy?.min_activity ?? 1;
  const totalAct = (draftAnchors.tickets || 0) + (draftAnchors.orders || 0);
  if (totalAct < minAct) return { allow: false, reason: 'low_activity' };
  const blockLate = policy?.block_if_late_exceeds ?? 0;
  if ((draftAnchors.late || 0) > blockLate) return { allow: false, reason: 'too_many_late' };
  if (policy?.require_consent && !consent) return { allow: false, reason: 'no_consent' };
  return { allow: true as const, reason: 'ok' };
}

/* =============================================================================
   🔌 SSE: live event stream
============================================================================= */
type SseClient = { id: string; write: (chunk: string) => void; close: () => void };
const sseClients = new Map<string, SseClient>();

const sseFormat = (event: string, data: any) => `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
function broadcast(event: string, data: any) {
  const payload = sseFormat(event, data);
  for (const [, c] of sseClients) {
    try {
      c.write(payload);
    } catch {}
  }
}

/* =============================================================================
   Self-claim (OTP + opaque tokens)
============================================================================= */
const claimOtps = new Map<string, { otp: string; expires: number }>(); // key: `${code}|${phone}`
const claimTokens = new Map<string, { token: string; bookingCode: string; expires: number }>();
const rand4 = () => String(Math.floor(1000 + Math.random() * 9000));

function getTokenFromAuth(h?: string) {
  if (!h) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1];
}
function getBookingFromToken(token?: string) {
  if (!token) return undefined;
  const rec = claimTokens.get(token);
  if (!rec || rec.expires < Date.now()) return undefined;
  return bookings.find((b) => b.code === rec.bookingCode);
}
function getGuestIdFromToken(token?: string) {
  const b = getBookingFromToken(token);
  return b?.guest_phone; // phone as demo "guestId"
}

/* =============================================================================
   Routes
============================================================================= */

// Friendly root
app.get('/', async () => ({
  ok: true,
  name: 'VAiyu API',
  try: [
    '/health',
    '/hotel/sunrise',
    'POST /checkin',
    '/reviews/:slug',
    'GET /reviews/draft/:code',
    'POST /reviews/auto',
    '/reviews/pending',
    '/reviews/approve',
    '/reviews/reject',
    '/experience/summary/:code',
    '/experience/report/:slug',
    'POST /booking/:code/consent',
    '/referrals/init',
    '/referrals/apply',
    'GET /me/stays',
    'GET /credits/mine',
    'POST /credits/redeem',
    '/events',
  ],
}));

/* ---------- SSE ---------- */
app.get('/events', async (req, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  const id = String(Date.now()) + Math.random().toString(16).slice(2);
  const client: SseClient = {
    id,
    write: (chunk: string) => reply.raw.write(chunk),
    close: () => reply.raw.end(),
  };
  sseClients.set(id, client);

  client.write(sseFormat('hello', { ok: true, ts: nowISO() }));

  const iv = setInterval(() => {
    try {
      client.write(sseFormat('ping', { ts: nowISO() }));
    } catch {}
  }, 25000);

  req.raw.on('close', () => {
    clearInterval(iv);
    sseClients.delete(id);
    try {
      client.close();
    } catch {}
  });

  return reply;
});

/* ---------- Catalog / Hotel ---------- */
app.get('/hotels', async () => hotel);

app.get('/catalog/services', async () => ({ items: services }));

app.post('/catalog/services', async (req, reply) => {
  const body = (req.body || {}) as { items?: Service[] };
  if (!Array.isArray(body.items)) return reply.status(400).send({ error: 'items array required' });
  services = body.items.map((s) => ({
    key: String(s.key),
    label_en: String(s.label_en || ''),
    sla_minutes: Number(s.sla_minutes ?? 30),
  }));
  return { ok: true, items: services };
});

app.patch('/catalog/services/:key', async (req, reply) => {
  const { key } = req.params as any;
  const patch = (req.body || {}) as Partial<Service>;
  const i = services.findIndex((s) => s.key === key);
  if (i === -1) return reply.status(404).send({ error: 'Service not found' });
  services[i] = { ...services[i], ...patch, key: services[i].key };
  return { ok: true, item: services[i] };
});

app.delete('/catalog/services/:key', async (req, reply) => {
  const { key } = req.params as any;
  const before = services.length;
  services = services.filter((s) => s.key !== key);
  if (services.length === before) return reply.status(404).send({ error: 'Service not found' });
  return { ok: true };
});

app.get('/menu/items', async () => ({ items: menu }));

app.get('/hotel/:slug', async (req, reply) => {
  const { slug } = req.params as any;
  if (slug !== hotel.slug) return reply.status(404).send({ error: 'Not found' });
  return hotel;
});

app.post('/hotel/upsert', async (req, reply) => {
  const body = (req.body || {}) as Partial<Hotel>;
  if (!body.slug || !body.name) return reply.status(400).send({ error: 'slug & name required' });
  Object.assign(hotel, body);
  rooms = rooms.map((r) => (r.hotel_slug === hotel.slug ? r : { ...r, hotel_slug: hotel.slug }));
  bookings = bookings.map((b) => (b.hotel_slug === hotel.slug ? b : { ...b, hotel_slug: hotel.slug }));
  return hotel;
});

/* ---------- Consent ---------- */
app.post('/booking/:code/consent', async (req, reply) => {
  const { code } = req.params as any;
  const { reviews: consent } = (req.body || {}) as { reviews?: boolean };
  const b = bookings.find((x) => x.code === code);
  if (!b) return reply.status(404).send({ error: 'Booking not found' });
  b.consent_reviews = !!consent;
  return { ok: true, booking: b };
});

/* ---------- Self-claim (OTP → token) ---------- */
app.post('/claim/init', async (req, reply) => {
  const { code, phone } = (req.body || {}) as { code?: string; phone?: string };
  if (!code || !phone) return reply.status(400).send({ error: 'code & phone required' });

  const b = bookings.find((x) => x.code === code && x.guest_phone === phone);
  if (!b) return reply.status(404).send({ error: 'Booking not found' });

  const otp = process.env.DEMO_STATIC_OTP || rand4();
  const key = `${code}|${phone}`;
  claimOtps.set(key, { otp, expires: Date.now() + 5 * 60_000 });

  req.server.log.info({ code, phone, otp }, 'claim.init demo OTP');
  return { ok: true, method: 'otp', sent: true };
});

app.post('/claim/verify', async (req, reply) => {
  const { code, otp } = (req.body || {}) as { code?: string; otp?: string };
  if (!code || !otp) return reply.status(400).send({ error: 'code & otp required' });

  const b = bookings.find((x) => x.code === code);
  if (!b) return reply.status(404).send({ error: 'Booking not found' });

  const key = `${code}|${b.guest_phone}`;
  const rec = claimOtps.get(key);
  if (!rec || rec.expires < Date.now()) return reply.status(400).send({ error: 'OTP expired' });
  if (rec.otp !== otp) return reply.status(401).send({ error: 'Invalid OTP' });

  claimOtps.delete(key);

  const token = 'st_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  claimTokens.set(token, { token, bookingCode: code, expires: Date.now() + 24 * 60 * 60_000 }); // 24h

  return { ok: true, token, booking: { code: b.code, guest_name: b.guest_name, hotel_slug: b.hotel_slug } };
});

/* ---------- Quick Check-in ---------- */
app.post('/checkin', async (req, reply) => {
  const { code, phone } = (req.body || {}) as { code?: string; phone?: string };
  if (!code || !phone) return reply.status(400).send({ error: 'code & phone are required' });

  const b = bookings.find((x) => x.code === code && x.guest_phone === phone && x.status === 'booked');
  if (!b) return reply.status(404).send({ error: 'Booking not found or not eligible' });

  let r = rooms.find((x) => x.hotel_slug === b.hotel_slug && x.room_type === b.room_type && x.is_clean && !x.is_occupied);
  if (!r) r = rooms.find((x) => x.hotel_slug === b.hotel_slug && x.is_clean && !x.is_occupied);
  if (!r) return reply.status(409).send({ error: 'No rooms available right now' });

  r.is_occupied = true;
  b.status = 'checked_in';
  b.room_no = r.room_no;
  b.checkin_at = nowISO();

  return { message: 'Checked in', booking: b, room: { room_no: r.room_no, room_type: r.room_type } };
});

/* ---------- Reviews (manual + AI) ---------- */
app.get('/reviews/:slug', async (req, reply) => {
  const { slug } = req.params as any;
  if (slug !== hotel.slug) return reply.status(404).send({ error: 'Hotel not found' });
  const rows = reviews
    .filter((r) => r.hotel_slug === slug && r.visibility === 'public' && r.status === 'published')
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return rows.slice(0, 50);
});

app.get('/reviews/pending', async () => ({
  items: reviews.filter((r) => r.status === 'pending').sort((a, b) => b.created_at.localeCompare(a.created_at)),
}));
app.get('/reviews-pending', async () => ({
  items: reviews.filter((r) => r.status === 'pending').sort((a, b) => b.created_at.localeCompare(a.created_at)),
}));

app.post('/reviews', async (req, reply) => {
  const { bookingCode, rating, title, body } = (req.body || {}) as {
    bookingCode?: string;
    rating?: number;
    title?: string;
    body?: string;
  };
  if (!bookingCode || !rating) return reply.status(400).send({ error: 'bookingCode & rating required' });

  const b = bookings.find((x) => x.code === bookingCode);
  if (!b) return reply.status(404).send({ error: 'Booking not found' });

  const item: Review = {
    id: String(Date.now()),
    hotel_slug: b.hotel_slug,
    rating: Number(rating),
    title,
    body,
    verified: b.status === 'completed',
    created_at: nowISO(),
    guest_name: b.guest_name,
    source: 'guest',
    status: 'published',
    visibility: 'public',
    booking_code: bookingCode,
    approval: { required: false, approved: true, approved_at: nowISO() },
  };
  reviews.unshift(item);
  broadcast('review_created', { review: item });
  return item;
});

app.get('/reviews/draft/:code', async (req, reply) => {
  const { code } = req.params as any;
  const res = buildReviewDraftFromActivity(code);
  if ((res as any).error) return reply.status(404).send(res);
  return (res as any).draft;
});

app.post('/reviews/auto', async (req, reply) => {
  const { bookingCode, commit } = (req.body || {}) as { bookingCode?: string; commit?: boolean };
  if (!bookingCode) return reply.status(400).send({ error: 'bookingCode required' });

  const res = buildReviewDraftFromActivity(bookingCode);
  if ((res as any).error) return reply.status(404).send(res);
  const { draft, booking } = res as any;

  if (!commit) return draft;

  const item: Review = {
    id: String(Date.now()),
    hotel_slug: booking.hotel_slug,
    rating: draft.ratingSuggested,
    title: draft.titleSuggested,
    body: draft.bodySuggested,
    verified: booking.status === 'completed',
    created_at: nowISO(),
    guest_name: booking.guest_name,
    source: 'auto',
    status: 'published',
    visibility: 'public',
    booking_code: bookingCode,
    approval: { required: false, approved: true, approved_at: nowISO() },
    anchors: draft.anchors,
  };
  reviews.unshift(item);
  broadcast('review_created', { review: item });
  return item;
});

app.post('/reviews/approve', async (req, reply) => {
  const { id, bookingCode } = (req.body || {}) as { id?: string; bookingCode?: string };
  if (!id) return reply.status(400).send({ error: 'id required' });
  const r = reviews.find((x) => x.id === id);
  if (!r) return reply.status(404).send({ error: 'Review not found' });
  if (bookingCode && r.booking_code && r.booking_code !== bookingCode) return reply.status(403).send({ error: 'Booking code mismatch' });
  r.status = 'published';
  r.visibility = 'public';
  r.approval = { required: false, approved: true, approved_at: nowISO() };
  r.updated_at = nowISO();
  broadcast('review_updated', { id: r.id, action: 'approved' });
  return { ok: true, review: r };
});

app.post('/reviews/reject', async (req, reply) => {
  const { id, bookingCode } = (req.body || {}) as { id?: string; bookingCode?: string };
  if (!id) return reply.status(400).send({ error: 'id required' });
  const r = reviews.find((x) => x.id === id);
  if (!r) return reply.status(404).send({ error: 'Review not found' });
  if (bookingCode && r.booking_code && r.booking_code !== bookingCode) return reply.status(403).send({ error: 'Booking code mismatch' });
  r.status = 'rejected';
  r.visibility = 'private';
  r.updated_at = nowISO();
  broadcast('review_updated', { id: r.id, action: 'rejected' });
  return { ok: true, review: r };
});

app.post('/reviews/:id/approve', async (req, reply) => {
  const { id } = req.params as any;
  const { bookingCode } = (req.body || {}) as { bookingCode?: string };
  const r = reviews.find((x) => x.id === id);
  if (!r) return reply.status(404).send({ error: 'Review not found' });
  if (bookingCode && r.booking_code && r.booking_code !== bookingCode) return reply.status(403).send({ error: 'Booking code mismatch' });
  r.status = 'published';
  r.visibility = 'public';
  r.approval = { required: false, approved: true, approved_at: nowISO() };
  r.updated_at = nowISO();
  broadcast('review_updated', { id: r.id, action: 'approved' });
  return { ok: true, review: r };
});

app.post('/reviews/:id/reject', async (req, reply) => {
  const { id } = req.params as any;
  const { bookingCode } = (req.body || {}) as { bookingCode?: string };
  const r = reviews.find((x) => x.id === id);
  if (!r) return reply.status(404).send({ error: 'Review not found' });
  if (bookingCode && r.booking_code && r.booking_code !== bookingCode) return reply.status(403).send({ error: 'Booking code mismatch' });
  r.status = 'rejected';
  r.visibility = 'private';
  r.updated_at = nowISO();
  broadcast('review_updated', { id: r.id, action: 'rejected' });
  return { ok: true, review: r };
});

/* ---------- Experience (owner) ---------- */
app.get('/experience/summary/:code', async (req, reply) => {
  const { code } = req.params as any;
  const sum = buildExperienceSummary(code);
  if ((sum as any).error) return reply.status(404).send(sum);
  return sum;
});

app.get('/experience/report/:slug', async (req, reply) => {
  const { slug } = req.params as any;
  if (slug !== hotel.slug) return reply.status(404).send({ error: 'Hotel not found' });

  const hotelRoomNos = new Set(rooms.filter((r) => r.hotel_slug === slug).map((r) => r.room_no));
  const tix = tickets.filter((t) => hotelRoomNos.has(t.room) || !!bookings.find((b) => b.code === t.booking && b.hotel_slug === slug));

  let onTime = 0,
    late = 0,
    totalMins = 0;
  tix.forEach((t) => {
    const end = t.done_at || t.started_at || t.accepted_at || t.created_at;
    const mins = minutesBetween(t.created_at, end!);
    totalMins += mins;
    if (new Date(end!) > new Date(t.sla_deadline)) late++;
    else onTime++;
  });
  const avgMins = tix.length ? Math.round(totalMins / tix.length) : 0;

  const hotelBookingCodes = new Set(bookings.filter((b) => b.hotel_slug === slug).map((b) => b.code));
  const ords = orders.filter((o) => hotelBookingCodes.has(o.booking) || hotelBookingCodes.has(o.stay_code));

  const hints = policyHintsFromAnchors({
    tickets: tix.length,
    orders: ords.length,
    onTime,
    late,
    avgMins,
    details: [],
  });

  return {
    hotel: { slug: hotel.slug, name: hotel.name },
    period: 'all-time (demo)',
    kpis: { tickets: tix.length, orders: ords.length, onTime, late, avgMins },
    hints,
  };
});

/* ---------- Tickets ---------- */
app.post('/tickets', async (req, reply) => {
  const body: any = req.body || {};
  const svc = services.find((s) => s.key === body.service_key);
  const sla = svc?.sla_minutes ?? 30;
  const created = nowISO();
  const t: Ticket = {
    id: String(Date.now()),
    status: 'Requested',
    created_at: created,
    sla_minutes: sla,
    sla_deadline: addMinutes(created, sla),
    ...body,
  };
  tickets.unshift(t);
  broadcast('ticket_created', { ticket: t });
  return { ok: true, ticket: t };
});
app.get('/tickets', async () => ({ items: tickets }));
app.get('/tickets/:id', async (req, reply) => {
  const { id } = req.params as any;
  const t = tickets.find((x) => x.id === id);
  if (!t) return reply.status(404).send({ error: 'Not found' });
  return t;
});
app.patch('/tickets/:id', async (req, reply) => {
  const { id } = req.params as any;
  const body: any = req.body || {};
  const t = tickets.find((x) => x.id === id);
  if (!t) return reply.status(404).send({ error: 'Not found' });
  if (body.status) {
    t.status = body.status;
    const ts = nowISO();
    if (body.status === 'Accepted') t.accepted_at = ts;
    if (body.status === 'InProgress') t.started_at = ts;
    if (body.status === 'Done') t.done_at = ts;
  }
  broadcast('ticket_updated', { ticket: t });
  return { ok: true, ticket: t };
});

/* ---------- Orders ---------- */
app.post('/orders', async (req, reply) => {
  const body: any = req.body || {};
  const o = { id: String(Date.now()), status: 'Placed', created_at: nowISO(), ...body };
  orders.unshift(o);
  broadcast('order_created', { order: o });
  return { ok: true, order: o };
});
app.get('/orders', async () => ({ items: orders }));
app.patch('/orders/:id', async (req, reply) => {
  const { id } = req.params as any;
  const body: any = req.body || {};
  const o = orders.find((x) => x.id === id);
  if (!o) return reply.status(404).send({ error: 'Not found' });
  if (body.status) o.status = body.status;
  broadcast('order_updated', { order: o });
  return { ok: true, order: o };
});

/* ---------- Folio / Flows ---------- */
app.get('/folio', async () => folio);
app.post('/precheck', async () => ({ ok: true }));
app.post('/regcard', async () => ({ ok: true, pdf: '/fake.pdf' }));

app.post('/checkout', async (req, reply) => {
  const { bookingCode, autopost } = (req.body || {}) as { bookingCode?: string; autopost?: boolean };

  let b =
    bookingCode ? bookings.find((x) => x.code === bookingCode) : bookings.slice().reverse().find((x) => x.status === 'checked_in' || x.status === 'booked');

  if (!b) {
    return { ok: true, invoice: '/invoice.pdf', review_link: 'https://example.com/review', note: 'No booking matched to complete' };
  }

  b.status = 'completed';
  b.checkout_at = nowISO();

  const out: any = { ok: true, invoice: '/invoice.pdf', review_link: 'https://example.com/review' };

  if (autopost) {
    const res = buildReviewDraftFromActivity(b.code);
    if (!(res as any).error) {
      const { draft } = res as any;
      const publishCheck = shouldAutoPublish(hotel.reviews_policy, draft.anchors, b.consent_reviews);

      if (publishCheck.allow) {
        const r: Review = {
          id: String(Date.now()),
          hotel_slug: b.hotel_slug,
          rating: draft.ratingSuggested,
          title: draft.titleSuggested,
          body: draft.bodySuggested,
          verified: true,
          created_at: nowISO(),
          guest_name: b.guest_name,
          source: 'auto',
          status: 'published',
          visibility: 'public',
          booking_code: b.code,
          approval: { required: false, approved: true, approved_at: nowISO() },
          anchors: draft.anchors,
        };
        reviews.unshift(r);
        broadcast('review_created', { review: r });
        out.review = r;
      } else {
        const r: Review = {
          id: String(Date.now()),
          hotel_slug: b.hotel_slug,
          rating: draft.ratingSuggested,
          title: draft.titleSuggested,
          body: draft.bodySuggested,
          verified: true,
          created_at: nowISO(),
          guest_name: b.guest_name,
          source: 'auto',
          status: 'pending',
          visibility: 'private',
          booking_code: b.code,
          approval: { required: true, approved: false },
          anchors: draft.anchors,
        };
        reviews.unshift(r);
        broadcast('review_created', { review: r });
        out.pending_review = r;
        out.note = `Pending approval (${publishCheck.reason})`;
      }
    }
  }

  return out;
});

app.post('/payments/checkout', async () => ({ link: 'https://pay.example.com/abc123' }));
app.post('/payments/webhook', async () => {
  folio.lines.push({ description: 'UPI Payment', amount: -2800 });
  folio.total = folio.lines.reduce((s: number, l: any) => s + (l.amount || 0), 0);
  return { ok: true };
});

/* =============================================================================
   NEW: Referrals & Credits + My Stays (token auth)
============================================================================= */

type ReferralCode = { code: string; property: string; referrerGuestId?: string; created_at: string };
const referralCodes = new Map<string, ReferralCode>(); // code -> record
const creditsByGuest = new Map<string, Record<string, number>>(); // guestId -> { property: balance }

function creditGuest(guestId: string, property: string, amount: number) {
  const m = creditsByGuest.get(guestId) || {};
  m[property] = Math.max(0, (m[property] || 0) + amount);
  creditsByGuest.set(guestId, m);
}

/* Start a referral: returns a code + share URL. Auth optional (better if present). */
app.post('/referrals/init', async (req, reply) => {
  const { property, channel } = (req.body || {}) as { property?: string; channel?: string };
  const auth = req.headers.authorization;
  const token = getTokenFromAuth(auth);
  const referrerId = getGuestIdFromToken(token);

  const prop = property || hotel.slug;
  const code = (prop.slice(0, 3).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6)).toUpperCase();
  referralCodes.set(code, { code, property: prop, referrerGuestId: referrerId, created_at: nowISO() });

  const shareUrl = `${process.env.PUBLIC_SITE_ORIGIN || 'https://vaiyu.co.in'}/hotel/${prop}?ref=${encodeURIComponent(code)}${
    channel ? `&ch=${encodeURIComponent(channel)}` : ''
  }`;

  return { ok: true, code, shareUrl };
});

/* Apply a referral for a referee's booking. In demo we award credits to the referrer. */
app.post('/referrals/apply', async (req, reply) => {
  const body = (req.body || {}) as {
    bookingCode?: string;
    referrer?: { accountId?: string; phone?: string; email?: string; code?: string };
  };
  if (!body.bookingCode) return reply.status(400).send({ error: 'bookingCode required' });

  const b = bookings.find((x) => x.code === body.bookingCode);
  if (!b) return reply.status(404).send({ error: 'Booking not found' });

  let referrerGuestId: string | undefined;

  // 1) If a referral code is provided, look up stored record
  if (body.referrer?.code && referralCodes.has(body.referrer.code)) {
    referrerGuestId = referralCodes.get(body.referrer.code)!.referrerGuestId;
  }

  // 2) Otherwise, you could match by phone/email (demo: single seeded user)
  if (!referrerGuestId) {
    if (body.referrer?.phone === '9999999999') referrerGuestId = '9999999999';
  }

  if (!referrerGuestId) return { ok: true, status: 'pending' }; // nothing to award in demo

  // Award demo credits to referrer on this property
  creditGuest(referrerGuestId, b.hotel_slug, 500);

  return { ok: true, status: 'applied', awarded: 500 };
});

/* Return current user's stays (derived from token) */
app.get('/me/stays', async (req, reply) => {
  const token = getTokenFromAuth(req.headers.authorization);
  const b = getBookingFromToken(token);
  if (!b) return reply.status(401).send({ error: 'unauthorized' });

  const toStay = (bk: Booking) => {
    const status = bk.status === 'checked_in' ? 'active' : bk.status === 'completed' ? 'completed' : 'upcoming';
    return {
      code: bk.code,
      status,
      hotel_slug: bk.hotel_slug,
      hotel_name: hotel.name,
      check_in: bk.checkin_at || new Date(Date.now() + 2 * 86400000).toISOString(),
      check_out: bk.checkout_at || new Date(Date.now() + 5 * 86400000).toISOString(),
    };
  };

  // In demo: just return the booking tied to token (plus a couple of illustrative records)
  const items = [
    toStay(b),
    { ...toStay(b), code: 'LIVE001', status: 'active', check_in: new Date(Date.now() - 86400000).toISOString(), check_out: new Date(Date.now() + 86400000).toISOString() },
    { ...toStay(b), code: 'DONE789', status: 'completed', check_in: new Date(Date.now() - 14 * 86400000).toISOString(), check_out: new Date(Date.now() - 10 * 86400000).toISOString() },
  ];

  return { stays: items };
});

/* Get my credit balances (per property) */
app.get('/credits/mine', async (req, reply) => {
  const token = getTokenFromAuth(req.headers.authorization);
  const guestId = getGuestIdFromToken(token);
  if (!guestId) return reply.status(401).send({ error: 'unauthorized' });

  const m = creditsByGuest.get(guestId) || {};
  const items = Object.keys(m).map((property) => ({
    property,
    balance: m[property] || 0,
    currency: 'INR',
    expiresAt: null,
  }));
  const total = items.reduce((s, it) => s + (it.balance || 0), 0);
  return { items, total };
});

/* Redeem credits for a property (e.g., order discount) */
app.post('/credits/redeem', async (req, reply) => {
  const token = getTokenFromAuth(req.headers.authorization);
  const guestId = getGuestIdFromToken(token);
  if (!guestId) return reply.status(401).send({ error: 'unauthorized' });

  const { property, amount } = (req.body || {}) as { property?: string; amount?: number };
  if (!property || !amount || amount <= 0) return reply.status(400).send({ error: 'property and positive amount required' });

  const m = creditsByGuest.get(guestId) || {};
  const before = m[property] || 0;
  const after = Math.max(0, before - amount);
  m[property] = after;
  creditsByGuest.set(guestId, m);

  return { ok: true, newBalance: after };
});

/* =============================================================================
   Boot
============================================================================= */
async function start() {
  await app.register(cors, {
    origin: ORIGIN,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.get('/health', async () => ({ ok: true }));

  app.listen({ port: PORT, host: '0.0.0.0' }, (err, addr) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
    app.log.info(`API listening on ${addr}`);
  });
}
start();
