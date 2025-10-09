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
}

const hotel: Hotel = {
  slug: 'sunrise',
  name: 'Sunrise Resort',
  description: 'Hill-view stay powered by VAiyu',
  address: 'Mall Road, Nainital, Uttarakhand',
  amenities: ['WiFi', 'Parking', 'Breakfast', 'Pet Friendly'],
  phone: '+91-99999-99999',
  email: 'hello@sunrise.example',
  logo_url: '',
  theme: { brand: '#145AF2', mode: 'light' }
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
    status: 'booked'
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

// Helpers
const nowISO = () => new Date().toISOString()
const addMinutes = (iso: string, mins: number) => new Date(new Date(iso).getTime() + mins * 60000).toISOString()

// -------------------------------
// Routes (existing + new)
// -------------------------------

// Catalog (existing)
app.get('/hotels', async () => hotel)
app.get('/catalog/services', async () => ({ items: services }))
app.get('/menu/items', async () => ({ items: menu }))

// ---------- NEW: OwnerSettings → /hotel ----------
app.get('/hotel/:slug', async (req, reply) => {
  const { slug } = req.params as any
  if (slug !== hotel.slug) return reply.status(404).send({ error: 'Not found' })
  return hotel
})

app.post('/hotel/upsert', async (req, reply) => {
  const body = (req.body || {}) as Partial<Hotel>
  if (!body.slug || !body.name) return reply.status(400).send({ error: 'slug & name required' })
  // For single-property demo we simply overwrite current in-memory hotel when slug matches or replace it otherwise.
  Object.assign(hotel, body)
  // If slug changed, cascade in-memory arrays
  rooms = rooms.map(r => r.hotel_slug === hotel.slug ? r : { ...r, hotel_slug: hotel.slug })
  bookings = bookings.map(b => b.hotel_slug === hotel.slug ? b : { ...b, hotel_slug: hotel.slug })
  return hotel
})

// ---------- NEW: Quick Check-In with room pre-assignment ----------
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

// ---------- NEW: Truth-anchored Reviews (stub) ----------
app.get('/reviews/:slug', async (req, reply) => {
  const { slug } = req.params as any
  if (slug !== hotel.slug) return reply.status(404).send({ error: 'Hotel not found' })
  const rows = reviews
    .filter(r => r.hotel_slug === slug)
    .sort((a,b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 50)
  return rows
})

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
    guest_name: b.guest_name
  }
  reviews.unshift(item)
  return item
})

// ---------- Existing: Service tickets ----------
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

// ---------- Existing: Orders ----------
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

// ---------- Existing: Folio/Flows ----------
app.get('/folio', async () => folio)
app.post('/precheck', async () => ({ ok: true }))
app.post('/regcard', async () => ({ ok: true, pdf: '/fake.pdf' }))
app.post('/checkout', async () => ({ ok: true, invoice: '/invoice.pdf', review_link: 'https://example.com/review' }))
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
  // CORS
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
