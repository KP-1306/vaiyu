import Fastify from 'fastify'
import cors from '@fastify/cors'
import 'dotenv/config'

const app = Fastify({ logger: true })
const PORT = Number(process.env.PORT || 4000)
const ORIGIN = (process.env.CORS_ORIGIN || '*').split(',')

// -------------------------------
// In-memory demo data (no DB yet)
// -------------------------------
type Theme = { brand?: string; mode?: 'light' | 'dark' }

// Owner flags for truth-anchored reviews/experience
type ReviewsPolicy = {
  mode?: 'off' | 'preview' | 'auto'      // preview shows draft to guest; auto posts at checkout
  min_activity?: number                  // min (tickets + orders) to consider auto/preview
  block_if_late_exceeds?: number         // if late > this, skip auto-post
  require_consent?: boolean              // if true, only auto-post if booking has consent
}

type Hotel = {
  slug: string
  name: string
  description?: string
  address?: string
  amenities?: string[]
  phone?: string
  email?: string
  logo_url?: string
  theme?: Theme
  reviews_policy?: ReviewsPolicy
}
type Room = { hotel_slug: string; room_no: string; room_type: string; is_clean: boolean; is_occupied: boolean }
type BookingStatus = 'booked' | 'checked_in' | 'completed' | 'cancelled'
type Booking = {
  id: string
  hotel_slug: string
  guest_name: string
  guest_phone: string
  code: string
  room_type: string
  status: BookingStatus
  room_no?: string
  checkin_at?: string
  checkout_at?: string
  consent_reviews?: boolean            // guest consent captured via /booking/:code/consent
}
type Review = {
  id: string
  hotel_slug: string
  rating: number
  title?: string
  body?: string
  verified: boolean
  created_at: string
  guest_name?: string
  source: 'guest' | 'auto'
  anchors?: {
    tickets: number
    orders: number
    onTime: number
    late: number
    avgMins: number
    details?: string[]
  }
}

type ExperienceSummary = {
  bookingCode: string
  guest_name?: string
  hotel_slug: string
  kpis: { onTime: number; late: number; avgMins: number; tickets: number; orders: number }
  perService?: Array<{ service_key: string; count: number; late: number; avgMins: number }>
  narrative: { title: string; body: string }
  anchors: NonNullable<Review['anchors']>
  policyHints?: string[]
}

// ---- Demo seed ----
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
    require_consent: true
  }
}

const services = [
  { key: 'towel', label_en: 'Towel', sla_minutes: 25 },
  { key: 'room_cleaning', label_en: 'Room Cleaning', sla_minutes: 30 },
  { key: 'water_bottle', label_en: 'Water Bottles', sla_minutes: 20 },
  { key: 'laundry_pickup', label_en: 'Laundry Pickup', sla_minutes: 30 },
  { key: 'extra_pillow', label_en: 'Extra Pillow', sla_minutes: 20 }
]

const menu = [
  { item_key: 'veg_sandwich', name: 'Veg Sandwich', base_price: 120 },
  { item_key: 'masala_tea', name: 'Masala Tea', base_price: 40 }
]

// Rooms & bookings for quick check-in
let rooms: Room[] = [
  { hotel_slug: hotel.slug, room_no: '101', room_type: 'standard', is_clean: true, is_occupied: false },
  { hotel_slug: hotel.slug, room_no: '102', room_type: 'standard', is_clean: true, is_occupied: false },
  { hotel_slug: hotel.slug, room_no: '201', room_type: 'deluxe',   is_clean: true, is_occupied: false },
  { hotel_slug: hotel.slug, room_no: '301', room_type: 'suite',    is_clean: false, is_occupied: false }
]

let bookings: Booking[] = [
  {
    id: 'b1',
    hotel_slug: hotel.slug,
    guest_name: 'Test Guest',
    guest_phone: '9999999999',
    code: 'ABC123',
    room_type: 'standard',
    status: 'booked',
    consent_reviews: true // demo: consent already granted
  }
]

let reviews: Review[] = []

// Existing demo state
type Ticket = {
  id: string; service_key: string; room: string; booking: string; tenant?: string;
  status: 'Requested'|'Accepted'|'InProgress'|'Done';
  created_at: string; accepted_at?: string; started_at?: string; done_at?: string;
  sla_minutes: number; sla_deadline: string;
}
let tickets: Ticket[] = []
let orders: any[] = []
let folio: any = { lines: [{ description: 'Room (EP)', amount: 2800 }], total: 2800 }

// -------------------------------
// Helpers
// -------------------------------
const nowISO = () => new Date().toISOString()
const addMinutes = (iso: string, mins: number) => new Date(new Date(iso).getTime() + mins * 60000).toISOString()
function minutesBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)
}

function buildReviewDraftFromActivity(bookingCode: string) {
  const b = bookings.find(x => x.code === bookingCode)
  if (!b) return { error: 'Booking not found' }

  const tix = tickets.filter(t => t.booking === bookingCode)
  let onTime = 0, late = 0, avgMins = 0
  const details: string[] = []

  tix.forEach(t => {
    const end = t.done_at || t.started_at || t.accepted_at || t.created_at
    const mins = minutesBetween(t.created_at, end!)
    avgMins += mins
    const breached = new Date(end!) > new Date(t.sla_deadline)
    breached ? late++ : onTime++
    details.push(`• ${t.service_key} for room ${t.room} — ${mins} min, ${breached ? 'late vs SLA' : 'on time'}`)
  })
  if (tix.length) avgMins = Math.round(avgMins / tix.length)

  const ords = orders.filter(o => o.booking === bookingCode || o.stay_code === bookingCode)

  let rating = 5 - late
  if (late === 0 && tix.length > 0) rating = 5
  rating = Math.min(5, Math.max(1, rating))

  const title = late ? 'Mixed experience' : (tix.length ? 'Smooth & timely service' : 'Pleasant stay')
  const body = [
    `Stay code ${bookingCode}.`,
    tix.length ? `Housekeeping requests handled in ~${avgMins || 0} min on average.` : `No service requests recorded.`,
    late ? `${late} request(s) missed SLA.` : (tix.length ? `All requests were within SLA.` : ``),
    ords.length ? `${ords.length} kitchen order(s) recorded.` : ``,
    details.length ? `\nDetails:\n${details.join('\n')}` : ``
  ].filter(Boolean).join(' ')

  return {
    draft: {
      bookingCode,
      ratingSuggested: rating,
      titleSuggested: title,
      bodySuggested: body,
      anchors: { tickets: tix.length, orders: ords.length, onTime, late, avgMins, details }
    },
    booking: b
  }
}

// ---- Experience Summary helpers (owner-facing) ----
function summarizeByService(bookingCode: string) {
  const tix = tickets.filter(t => t.booking === bookingCode)
  const by: Record<string, { count: number; late: number; totalMins: number }> = {}
  tix.forEach(t => {
    const end = t.done_at || t.started_at || t.accepted_at || t.created_at
    const mins = minutesBetween(t.created_at, end!)
    const breached = new Date(end!) > new Date(t.sla_deadline)
    by[t.service_key] ??= { count: 0, late: 0, totalMins: 0 }
    by[t.service_key].count++
    by[t.service_key].totalMins += mins
    if (breached) by[t.service_key].late++
  })
  return Object.entries(by).map(([service_key, v]) => ({
    service_key,
    count: v.count,
    late: v.late,
    avgMins: Math.round(v.totalMins / v.count)
  }))
}

function policyHintsFromAnchors(a: NonNullable<Review['anchors']>): string[] {
  const hints: string[] = []
  if (a.late > 0) hints.push(`Investigate ${a.late} SLA breach(es); consider buffer or staffing in peak hours.`)
  if (a.avgMins > 30) hints.push(`Average resolution ${a.avgMins} min — review SLA targets or workflow.`)
  return hints.length ? hints : ['No obvious issues. Keep current policies.']
}

function buildExperienceSummary(bookingCode: string): ExperienceSummary | { error: string } {
  const res = buildReviewDraftFromActivity(bookingCode)
  if ((res as any).error) return res as any
  const { booking, draft } = res as any

  const perService = summarizeByService(bookingCode)
  const kpis = {
    onTime: draft.anchors.onTime,
    late: draft.anchors.late,
    avgMins: draft.anchors.avgMins,
    tickets: draft.anchors.tickets,
    orders: draft.anchors.orders
  }

  return {
    bookingCode,
    guest_name: booking.guest_name,
    hotel_slug: booking.hotel_slug,
    kpis,
    perService,
    narrative: { title: draft.titleSuggested, body: draft.bodySuggested },
    anchors: draft.anchors,
    policyHints: policyHintsFromAnchors(draft.anchors)
  }
}

// Policy evaluation for auto-post at checkout
function shouldAutoPost(policy: ReviewsPolicy | undefined, draftAnchors: NonNullable<Review['anchors']>, consent: boolean | undefined) {
  const mode = policy?.mode ?? 'preview'
  if (mode !== 'auto') return { allow: false, reason: 'mode_not_auto' }
  const minAct = policy?.min_activity ?? 1
  const totalAct = (draftAnchors.tickets || 0) + (draftAnchors.orders || 0)
  if (totalAct < minAct) return { allow: false, reason: 'low_activity' }
  const blockLate = policy?.block_if_late_exceeds ?? 0
  if ((draftAnchors.late || 0) > blockLate) return { allow: false, reason: 'too_many_late' }
  if (policy?.require_consent && !consent) return { allow: false, reason: 'no_consent' }
  return { allow: true as const, reason: 'ok' }
}

// -------------------------------
// Routes (existing + new)
// -------------------------------

// Friendly root
app.get('/', async () => ({
  ok: true,
  name: 'VAiyu API',
  try: [
    '/health', '/hotel/sunrise', 'POST /checkin',
    '/reviews/:slug', 'GET /reviews/draft/:code', 'POST /reviews/auto',
    '/experience/summary/:code', '/experience/report/:slug',
    'POST /booking/:code/consent'
  ]
}))

// Catalog
app.get('/hotels', async () => hotel)
app.get('/catalog/services', async () => ({ items: services }))
app.get('/menu/items', async () => ({ items: menu }))

// ---------- OwnerSettings → /hotel ----------
app.get('/hotel/:slug', async (req, reply) => {
  const { slug } = req.params as any
  if (slug !== hotel.slug) return reply.status(404).send({ error: 'Not found' })
  return hotel
})

app.post('/hotel/upsert', async (req, reply) => {
  const body = (req.body || {}) as Partial<Hotel>
  if (!body.slug || !body.name) return reply.status(400).send({ error: 'slug & name required' })
  // merge shallowly (simple demo)
  Object.assign(hotel, body)
  // If slug changed, cascade in-memory arrays
  rooms = rooms.map(r => r.hotel_slug === hotel.slug ? r : { ...r, hotel_slug: hotel.slug })
  bookings = bookings.map(b => b.hotel_slug === hotel.slug ? b : { ...b, hotel_slug: hotel.slug })
  return hotel
})

// ---------- Consent capture ----------
app.post('/booking/:code/consent', async (req, reply) => {
  const { code } = req.params as any
  const { reviews } = (req.body || {}) as { reviews?: boolean }
  const b = bookings.find(x => x.code === code)
  if (!b) return reply.status(404).send({ error: 'Booking not found' })
  b.consent_reviews = !!reviews
  return { ok: true, booking: b }
})

// ---------- Quick Check-In with room pre-assignment ----------
app.post('/checkin', async (req, reply) => {
  const { code, phone } = (req.body || {}) as { code?: string; phone?: string }
  if (!code || !phone) return reply.status(400).send({ error: 'code & phone are required' })

  const b = bookings.find(x => x.code === code && x.guest_phone === phone && x.status === 'booked')
  if (!b) return reply.status(404).send({ error: 'Booking not found or not eligible' })

  // Pass 1: match requested type
  let r = rooms.find(x => x.hotel_slug === b.hotel_slug && x.room_type === b.room_type && x.is_clean && !x.is_occupied)
  // Pass 2: any clean & free
  if (!r) r = rooms.find(x => x.hotel_slug === b.hotel_slug && x.is_clean && !x.is_occupied)
  if (!r) return reply.status(409).send({ error: 'No rooms available right now' })

  r.is_occupied = true
  b.status = 'checked_in'
  b.room_no = r.room_no
  b.checkin_at = nowISO()

  return { message: 'Checked in', booking: b, room: { room_no: r.room_no, room_type: r.room_type } }
})

// ---------- Reviews (manual + AI) ----------
app.get('/reviews/:slug', async (req, reply) => {
  const { slug } = req.params as any
  if (slug !== hotel.slug) return reply.status(404).send({ error: 'Hotel not found' })
  const rows = reviews
    .filter(r => r.hotel_slug === slug)
    .sort((a,b) => b.created_at.localeCompare(a.created_at))
  return rows.slice(0, 50)
})

// Manual review by guest
app.post('/reviews', async (req, reply) => {
  const { bookingCode, rating, title, body } = (req.body || {}) as { bookingCode?: string; rating?: number; title?: string; body?: string }
  if (!bookingCode || !rating) return reply.status(400).send({ error: 'bookingCode & rating required' })

  const b = bookings.find(x => x.code === bookingCode)
  if (!b) return reply.status(404).send({ error: 'Booking not found' })

  const item: Review = {
    id: String(Date.now()),
    hotel_slug: b.hotel_slug,
    rating: Number(rating),
    title,
    body,
    verified: b.status === 'completed',
    created_at: nowISO(),
    guest_name: b.guest_name,
    source: 'guest'
  }
  reviews.unshift(item)
  return item
})

// Build a draft from activity (for guests or agents to preview)
app.get('/reviews/draft/:code', async (req, reply) => {
  const { code } = req.params as any
  const res = buildReviewDraftFromActivity(code)
  if ((res as any).error) return reply.status(404).send(res)
  return (res as any).draft
})

// Auto-post an AI-authored review (truth-anchored)
app.post('/reviews/auto', async (req, reply) => {
  const { bookingCode, commit } = (req.body || {}) as { bookingCode?: string; commit?: boolean }
  if (!bookingCode) return reply.status(400).send({ error: 'bookingCode required' })

  const res = buildReviewDraftFromActivity(bookingCode)
  if ((res as any).error) return reply.status(404).send(res)

  const { draft, booking } = res as any
  if (!commit) return draft // preview only

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
    anchors: draft.anchors
  }
  reviews.unshift(item)
  return item
})

// ---------- Experience (owner-facing) ----------

// Per-stay Guest Experience Summary
app.get('/experience/summary/:code', async (req, reply) => {
  const { code } = req.params as any
  const sum = buildExperienceSummary(code)
  if ((sum as any).error) return reply.status(404).send(sum)
  return sum
})

// Simple property report (demo roll-up)
app.get('/experience/report/:slug', async (req, reply) => {
  const { slug } = req.params as any
  if (slug !== hotel.slug) return reply.status(404).send({ error: 'Hotel not found' })

  const hotelRoomNos = new Set(rooms.filter(r => r.hotel_slug === slug).map(r => r.room_no))
  const tix = tickets.filter(t => hotelRoomNos.has(t.room) ||
    !!bookings.find(b => b.code === t.booking && b.hotel_slug === slug)
  )

  let onTime = 0, late = 0, totalMins = 0
  tix.forEach(t => {
    const end = t.done_at || t.started_at || t.accepted_at || t.created_at
    const mins = minutesBetween(t.created_at, end!)
    totalMins += mins
    if (new Date(end!) > new Date(t.sla_deadline)) late++; else onTime++
  })
  const avgMins = tix.length ? Math.round(totalMins / tix.length) : 0

  const hotelBookingCodes = new Set(bookings.filter(b => b.hotel_slug === slug).map(b => b.code))
  const ords = orders.filter(o => hotelBookingCodes.has(o.booking) || hotelBookingCodes.has(o.stay_code))

  const hints = policyHintsFromAnchors({
    tickets: tix.length,
    orders: ords.length,
    onTime,
    late,
    avgMins,
    details: []
  })

  return {
    hotel: { slug: hotel.slug, name: hotel.name },
    period: 'all-time (demo)',
    kpis: { tickets: tix.length, orders: ords.length, onTime, late, avgMins },
    hints
  }
})

// ---------- Service tickets ----------
app.post('/tickets', async (req, reply) => {
  const body: any = req.body || {}
  const svc = services.find(s => s.key === body.service_key)
  const sla = svc?.sla_minutes ?? 30
  const created = nowISO()
  const t: Ticket = {
    id: String(Date.now()),
    status: 'Requested',
    created_at: created,
    sla_minutes: sla,
    sla_deadline: addMinutes(created, sla),
    ...body
  }
  tickets.unshift(t)
  return { ok: true, ticket: t }
})
app.get('/tickets', async () => ({ items: tickets }))
app.get('/tickets/:id', async (req, reply) => {
  const { id } = req.params as any
  const t = tickets.find(x => x.id === id)
  if (!t) return reply.status(404).send({ error: 'Not found' })
  return t
})
app.patch('/tickets/:id', async (req, reply) => {
  const { id } = req.params as any
  const body: any = req.body || {}
  const t = tickets.find(x => x.id === id)
  if (!t) return reply.status(404).send({ error: 'Not found' })
  if (body.status) {
    t.status = body.status
    const ts = nowISO()
    if (body.status === 'Accepted') t.accepted_at = ts
    if (body.status === 'InProgress') t.started_at = ts
    if (body.status === 'Done') t.done_at = ts
  }
  return { ok: true, ticket: t }
})

// ---------- Orders ----------
app.post('/orders', async (req, reply) => {
  const body: any = req.body || {}
  const o = { id: String(Date.now()), status: 'Placed', created_at: nowISO(), ...body }
  orders.unshift(o)
  return { ok: true, order: o }
})
app.get('/orders', async () => ({ items: orders }))
app.patch('/orders/:id', async (req, reply) => {
  const { id } = req.params as any
  const body: any = req.body || {}
  const o = orders.find(x => x.id === id)
  if (!o) return reply.status(404).send({ error: 'Not found' })
  if (body.status) o.status = body.status
  return { ok: true, order: o }
})

// ---------- Folio/Flows ----------
app.get('/folio', async () => folio)
app.post('/precheck', async () => ({ ok: true }))
app.post('/regcard', async () => ({ ok: true, pdf: '/fake.pdf' }))

// UPDATED: checkout enforces owner policy and can auto-post
app.post('/checkout', async (req, reply) => {
  const { bookingCode, autopost } = (req.body || {}) as { bookingCode?: string; autopost?: boolean }

  // pick booking
  let b = bookingCode
    ? bookings.find(x => x.code === bookingCode)
    : bookings.slice().reverse().find(x => x.status === 'checked_in' || x.status === 'booked')

  if (!b) {
    return { ok: true, invoice: '/invoice.pdf', review_link: 'https://example.com/review', note: 'No booking matched to complete' }
  }

  // mark completed
  b.status = 'completed'
  b.checkout_at = nowISO()

  let autoReview: Review | undefined
  if (autopost) {
    const res = buildReviewDraftFromActivity(b.code)
    if (!(res as any).error) {
      const { draft } = res as any
      const evalRes = shouldAutoPost(hotel.reviews_policy, draft.anchors, b.consent_reviews)
      if (evalRes.allow) {
        autoReview = {
          id: String(Date.now()),
          hotel_slug: b.hotel_slug,
          rating: draft.ratingSuggested,
          title: draft.titleSuggested,
          body: draft.bodySuggested,
          verified: true, // completed stay
          created_at: nowISO(),
          guest_name: b.guest_name,
          source: 'auto',
          anchors: draft.anchors
        }
        reviews.unshift(autoReview)
      }
    }
  }

  return {
    ok: true,
    invoice: '/invoice.pdf',
    review_link: 'https://example.com/review',
    ...(autoReview ? { review: autoReview } : {})
  }
})

app.post('/payments/checkout', async () => ({ link: 'https://pay.example.com/abc123' }))
app.post('/payments/webhook', async () => {
  folio.lines.push({ description: 'UPI Payment', amount: -2800 })
  folio.total = folio.lines.reduce((s: number, l: any) => s + (l.amount || 0), 0)
  return { ok: true }
})

// -------------------------------
// Boot
// -------------------------------
async function start () {
  await app.register(cors, {
    origin: ORIGIN,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS']
  })

  app.get('/health', async () => ({ ok: true }))

  app.listen({ port: PORT, host: '0.0.0.0' }, (err, addr) => {
    if (err) { app.log.error(err); process.exit(1) }
    app.log.info(`API listening on ${addr}`)
  })
}
start()
