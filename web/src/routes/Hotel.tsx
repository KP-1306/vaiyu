import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import '../theme.css'

type Theme = { brand?: string; mode?: 'light'|'dark' }
type Hotel = {
  slug: string; name: string; description?: string; address?: string;
  amenities?: string[]; phone?: string; email?: string; logo_url?: string; theme?: Theme
}

const API = import.meta.env.VITE_API_URL // e.g. https://vaiyu-api.onrender.com

export default function HotelPage() {
  const { slug = 'sunrise' } = useParams()
  const [hotel, setHotel] = useState<Hotel | null>(null)
  const [loading, setLoading] = useState(true)

  // apply theme from OwnerSettings
  useEffect(() => {
    if (!hotel?.theme) return
    if (hotel.theme.brand) document.documentElement.style.setProperty('--brand', hotel.theme.brand)
    document.documentElement.setAttribute('data-theme', hotel.theme.mode === 'dark' ? 'dark' : 'light')
  }, [hotel?.theme])

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/hotel/${slug}`)
      .then(r => r.json())
      .then(setHotel)
      .finally(() => setLoading(false))
  }, [slug])

  if (loading) return <div style={{padding:24}}>Loading…</div>
  if (!hotel)   return <div style={{padding:24}}>Hotel not found.</div>

  return (
    <div style={{maxWidth:1000, margin:'0 auto', padding:24}}>
      <header style={{display:'grid', gridTemplateColumns:'80px 1fr', gap:16, alignItems:'center'}}>
        {hotel.logo_url
          ? <img src={hotel.logo_url} alt="logo" style={{width:64,height:64,borderRadius:12}}/>
          : <div style={{width:64,height:64,background:'var(--border)',borderRadius:12}}/>}
        <div>
          <h1 style={{margin:'0 0 4px 0'}}>{hotel.name}</h1>
          {hotel.address && <div style={{color:'var(--muted)'}}>{hotel.address}</div>}
        </div>
      </header>

      <section className="card" style={{marginTop:16}}>
        <h3>About</h3>
        <p style={{marginTop:8}}>{hotel.description || 'Welcome!'}</p>
      </section>

      {!!(hotel.amenities?.length) && (
        <section className="card" style={{marginTop:16}}>
          <h3>Amenities</h3>
          <div style={{marginTop:8, display:'flex', gap:8, flexWrap:'wrap'}}>
            {hotel.amenities!.map(a => <span key={a} className="card" style={{padding:'6px 10px'}}>{a}</span>)}
          </div>
        </section>
      )}

      <section style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginTop:16}}>
        <div className="card">
          <h3>Quick Check-In</h3>
          <QuickCheckin />
        </div>
        <div className="card">
          <h3>Guest Reviews</h3>
          <Reviews slug={hotel.slug}/>
        </div>
      </section>

      {(hotel.phone || hotel.email) && (
        <footer style={{marginTop:24, color:'var(--muted)'}}>
          Contact: {hotel.phone} {hotel.phone && hotel.email ? ' · ' : ''} {hotel.email}
        </footer>
      )}
    </div>
  )
}

function QuickCheckin() {
  const [code, setCode] = useState('ABC123')
  const [phone, setPhone] = useState('9999999999')
  const [msg, setMsg] = useState<string | null>(null)
  const [assigned, setAssigned] = useState<{room_no:string; room_type:string} | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null); setAssigned(null)
    const r = await fetch(`${API}/checkin`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ code, phone })
    })
    const data = await r.json()
    if (!r.ok) return setMsg(data?.error || 'Failed')
    setAssigned(data?.room); setMsg('Checked in successfully.')
  }

  return (
    <form onSubmit={onSubmit} style={{display:'grid', gap:12}}>
      <input className="input" placeholder="Booking Code" value={code} onChange={e=>setCode(e.target.value)} />
      <input className="input" placeholder="Phone (registered)" value={phone} onChange={e=>setPhone(e.target.value)} />
      <button className="btn" type="submit">Check In</button>
      {msg && <div>{msg}</div>}
      {assigned && <div className="card" style={{background:'transparent'}}>
        Room Assigned: <b>{assigned.room_no}</b> ({assigned.room_type})
      </div>}
    </form>
  )
}

function Reviews({ slug }: { slug: string }) {
  const [items, setItems] = useState<any[]>([])
  const [open, setOpen] = useState(false)
  const [bookingCode, setBookingCode] = useState('ABC123')
  const [rating, setRating] = useState(5)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  const fetchReviews = useMemo(() => () => {
    fetch(`${API}/reviews/${slug}`).then(r=>r.json()).then(setItems).catch(()=>setItems([]))
  }, [slug])

  useEffect(() => { fetchReviews() }, [fetchReviews])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const r = await fetch(`${API}/reviews`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ bookingCode, rating, title, body })
    })
    const data = await r.json()
    if (!r.ok) return alert(data?.error || 'Failed')
    setOpen(false); setTitle(''); setBody(''); setRating(5)
    setItems([data, ...items])
  }

  return (
    <div style={{display:'grid', gap:12}}>
      {!items.length && <div>No reviews yet.</div>}
      {items.map((r) => (
        <div key={r.id} className="card">
          <div style={{display:'flex', justifyContent:'space-between'}}>
            <b>{'⭐'.repeat(r.rating)}</b>
            {r.verified && <span style={{fontSize:12, color:'var(--muted)'}}>Verified stay</span>}
          </div>
          {r.title && <div style={{marginTop:6, fontWeight:600}}>{r.title}</div>}
          {r.body && <div style={{marginTop:6}}>{r.body}</div>}
          <div style={{marginTop:6, fontSize:12, color:'var(--muted)'}}>
            by {r.guest_name || 'Guest'} · {new Date(r.created_at).toLocaleDateString()}
          </div>
        </div>
      ))}

      <button className="btn" onClick={()=>setOpen(v=>!v)}>{open ? 'Cancel' : 'Write a review'}</button>
      {open && (
        <form onSubmit={submit} style={{display:'grid', gap:10}}>
          <input className="input" value={bookingCode} onChange={e=>setBookingCode(e.target.value)} placeholder="Your booking code"/>
          <select className="select" value={rating} onChange={e=>setRating(parseInt(e.target.value))}>
            {[5,4,3,2,1].map(n => <option key={n} value={n}>{n} stars</option>)}
          </select>
          <input className="input" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Title (optional)"/>
          <textarea className="input" value={body} onChange={e=>setBody(e.target.value)} placeholder="Write your review…"/>
          <button className="btn" type="submit">Submit</button>
          <div style={{fontSize:12, color:'var(--muted)'}}>
            Reviews are marked “Verified” only if your booking is completed.
          </div>
        </form>
      )}
    </div>
  )
}
