import Fastify from 'fastify'
import cors from '@fastify/cors'
import 'dotenv/config'

const app = Fastify({ logger: true })
const PORT = Number(process.env.PORT || 4000)
const ORIGIN = (process.env.CORS_ORIGIN || '*').split(',')

// Demo data.
const hotel = { slug: 'sunrise', name: 'Sunrise Resort', description: 'Hill-view stay powered by VAiyu' }
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

type Ticket = {
  id: string; service_key: string; room: string; booking: string; tenant?: string;
  status: 'Requested'|'Accepted'|'InProgress'|'Done';
  created_at: string; accepted_at?: string; started_at?: string; done_at?: string;
  sla_minutes: number; sla_deadline: string;
}
let tickets: Ticket[] = []
let orders: any[] = []
let folio: any = { lines: [{ description: 'Room (EP)', amount: 2800 }], total: 2800 }

const nowISO = () => new Date().toISOString()
const addMinutes = (iso: string, mins: number) => new Date(new Date(iso).getTime() + mins * 60000).toISOString()

// Routes
app.get('/hotels', async () => hotel)
app.get('/catalog/services', async () => ({ items: services }))
app.get('/menu/items', async () => ({ items: menu }))

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

async function start () {
  await app.register(cors, { origin: ORIGIN })
  app.listen({ port: PORT, host: '0.0.0.0' }, (err, addr) => {
    if (err) { app.log.error(err); process.exit(1) }
    app.log.info(`API listening on ${addr}`)
  })
}
start()
