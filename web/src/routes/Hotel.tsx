// web/src/routes/Hotel.tsx
import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTheme } from '../components/ThemeProvider';
import {
  API,                 // base URL for direct fetches (check-in)
  getHotel,            // hotel details (has demo fallback)
  isDemo,              // tells us if we're showing demo data
  listReviews,         // GET /reviews/:slug
  postManualReview,    // POST /reviews
  reviewDraft,         // GET /reviews/draft/:code
  postAutoReviewCommit // POST /reviews/auto (commit)
} from '../lib/api';

import '../theme.css';

type Theme = { brand?: string; mode?: 'light' | 'dark' };
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
};

type Review = {
  id: string;
  hotel_slug: string;
  rating: number;
  title?: string;
  body?: string;
  verified: boolean;
  created_at: string;
  guest_name?: string;
  source?: 'guest' | 'auto';
  anchors?: {
    tickets: number;
    orders: number;
    onTime: number;
    late: number;
    avgMins: number;
    details?: string[];
  };
};

export default function HotelPage() {
  const { slug = 'sunrise' } = useParams();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const { setTheme } = useTheme();

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        const data = (await getHotel(slug)) as Hotel;
        if (!mounted) return;
        setHotel(data);
        // Apply theme globally via ThemeProvider
        setTheme({
          brand: data?.theme?.brand,
          mode: data?.theme?.mode || 'light',
        });
      } catch (e: any) {
        if (!mounted) return;
        setErr(e?.message || 'Hotel not found');
        setHotel(null);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [slug, setTheme]);

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;
  if (err) return <div style={{ padding: 24 }}>⚠ {err}</div>;
  if (!hotel) return <div style={{ padding: 24 }}>Hotel not found.</div>;

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 16, alignItems: 'center' }}>
          {hotel.logo_url ? (
            <img src={hotel.logo_url} alt="logo" style={{ width: 64, height: 64, borderRadius: 12 }} />
          ) : (
            <div style={{ width: 64, height: 64, background: 'var(--border)', borderRadius: 12 }} />
          )}
          <div>
            <h1 style={{ margin: '0 0 4px 0' }}>{hotel.name}</h1>
            {hotel.address && <div style={{ color: 'var(--muted)' }}>{hotel.address}</div>}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {isDemo() && (
            <span className="badge" style={{ background: '#FEF3C7', color: '#92400E' }}>
              Demo data
            </span>
          )}
          {/* quick links for owners (keep or remove as you prefer) */}
          <nav style={{ display: 'flex', gap: 12 }}>
            <Link className="link" to="/owner">Owner Settings</Link>
            <Link className="link" to={`/owner/dashboard/${hotel.slug}`}>Dashboard</Link>
          </nav>
        </div>
      </header>

      <section className="card" style={{ marginTop: 16 }}>
        <h3>About</h3>
        <p style={{ marginTop: 8 }}>{hotel.description || 'Welcome!'}</p>
      </section>

      {!!hotel.amenities?.length && (
        <section className="card" style={{ marginTop: 16 }}>
          <h3>Amenities</h3>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {hotel.amenities!.map((a) => (
              <span key={a} className="badge">
                {a}
              </span>
            ))}
          </div>
        </section>
      )}

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div className="card">
          <h3>Quick Check-In</h3>
          <QuickCheckin />
        </div>
        <div className="card">
          <h3>Guest Reviews</h3>
          <Reviews slug={hotel.slug} />
        </div>
      </section>

      {(hotel.phone || hotel.email) && (
        <footer style={{ marginTop: 24, color: 'var(--muted)' }}>
          Contact: {hotel.phone} {hotel.phone && hotel.email ? ' · ' : ''} {hotel.email}
        </footer>
      )}
    </div>
  );
}

function QuickCheckin() {
  const [code, setCode] = useState('ABC123');
  const [phone, setPhone] = useState('9999999999');
  const [msg, setMsg] = useState<string | null>(null);
  const [assigned, setAssigned] = useState<{ room_no: string; room_type: string } | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setAssigned(null);
    try {
      const r = await fetch(`${API}/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, phone }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as any)?.error || 'Failed');
      setAssigned((data as any)?.room);
      setMsg('Checked in successfully.');
    } catch (err: any) {
      setMsg(err?.message || 'Failed');
    }
  };

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
      <input className="input" placeholder="Booking Code" value={code} onChange={(e) => setCode(e.target.value)} />
      <input className="input" placeholder="Phone (registered)" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <button className="btn" type="submit">Check In</button>
      {msg && <div>{msg}</div>}
      {assigned && (
        <div className="card" style={{ background: 'transparent' }}>
          Room Assigned: <b>{assigned.room_no}</b> ({assigned.room_type})
        </div>
      )}
    </form>
  );
}

function Reviews({ slug }: { slug: string }) {
  const [items, setItems] = useState<Review[]>([]);
  const [open, setOpen] = useState(false);

  // manual inputs
  const [bookingCode, setBookingCode] = useState('ABC123');
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  // AI suggestion state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDraft, setAiDraft] = useState<{
    bookingCode?: string;
    ratingSuggested: number;
    titleSuggested?: string;
    bodySuggested?: string;
    anchors?: Review['anchors'];
  } | null>(null);

  const fetchReviews = useMemo(
    () => async () => {
      try {
        const rows = (await listReviews(slug)) as unknown as Review[];
        setItems(rows || []);
      } catch {
        setItems([]);
      }
    },
    [slug]
  );

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  // Manual submit
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = (await postManualReview({ bookingCode, rating, title, body })) as unknown as Review;
      setOpen(false);
      setTitle('');
      setBody('');
      setRating(5);
      setItems([created, ...items]);
    } catch (err: any) {
      alert(err?.message || 'Failed');
    }
  };

  // Load AI suggestion from activity
  const suggest = async () => {
    if (!bookingCode) return alert('Enter your booking code first.');
    setAiLoading(true);
    setAiDraft(null);
    try {
      const draft = (await reviewDraft(bookingCode)) as any;
      setAiDraft(draft);
    } catch (err: any) {
      alert(err?.message || 'Failed to build draft');
    } finally {
      setAiLoading(false);
    }
  };

  // Commit/publish AI review directly
  const publishAI = async () => {
    if (!bookingCode) return alert('Enter your booking code first.');
    try {
      const published = (await postAutoReviewCommit(bookingCode)) as unknown as Review;
      setItems([published, ...items]);
      setAiDraft(null);
      alert('AI review published.');
    } catch (err: any) {
      alert(err?.message || 'Failed');
    }
  };

  // Apply AI suggestion into manual form
  const applySuggestion = () => {
    if (!aiDraft) return;
    setRating(aiDraft.ratingSuggested || 5);
    setTitle(aiDraft.titleSuggested || '');
    setBody(aiDraft.bodySuggested || '');
    setOpen(true);
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {!items.length && <div>No reviews yet.</div>}
      {items.map((r) => (
        <div key={r.id} className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <b>{'⭐'.repeat(r.rating)}</b>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {r.source && (
                <span className={`badge ${r.source === 'auto' ? 'badge-muted' : ''}`} title="Source">
                  {r.source === 'auto' ? 'AI' : 'Guest'}
                </span>
              )}
              {r.verified && <span className="badge badge-success">Verified stay</span>}
            </div>
          </div>
          {r.title && <div style={{ marginTop: 6, fontWeight: 600 }}>{r.title}</div>}
          {r.body && <div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{r.body}</div>}
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>
            by {r.guest_name || 'Guest'} · {new Date(r.created_at).toLocaleDateString()}
          </div>

          {r.anchors && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer' }}>Why this rating?</summary>
              <div style={{ marginTop: 6, fontSize: 13 }}>
                Requests: {r.anchors.tickets} · Orders: {r.anchors.orders} · On-time: {r.anchors.onTime} · Late:{' '}
                {r.anchors.late} · Avg mins: {r.anchors.avgMins}
                {r.anchors.details?.length ? (
                  <div style={{ marginTop: 6 }}>
                    {r.anchors.details.map((d, i) => (
                      <div key={i} style={{ opacity: 0.85 }}>
                        {d}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </details>
          )}
        </div>
      ))}

      {/* Manual composer */}
      <button className="btn" onClick={() => setOpen((v) => !v)}>
        {open ? 'Cancel' : 'Write a review'}
      </button>
      {open && (
        <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
          <input className="input" value={bookingCode} onChange={(e) => setBookingCode(e.target.value)} placeholder="Your booking code" />
          <select className="select" value={rating} onChange={(e) => setRating(parseInt(e.target.value))}>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n} stars
              </option>
            ))}
          </select>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" />
          <textarea className="input" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your review…" />
          <button className="btn" type="submit">Submit</button>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Reviews are marked “Verified” only if your booking is completed.
          </div>
        </form>
      )}

      {/* AI suggestion tools */}
      <div className="hr" />
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ fontWeight: 700 }}>Prefer a suggestion?</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8 }}>
          <input
            className="input"
            value={bookingCode}
            onChange={(e) => setBookingCode(e.target.value)}
            placeholder="Enter your booking code"
          />
          <button className="btn btn-light" onClick={suggest} disabled={aiLoading}>
            {aiLoading ? 'Preparing…' : 'AI suggestion from my stay'}
          </button>
          <button className="btn btn-outline" onClick={publishAI} disabled={aiLoading}>
            Publish AI review
          </button>
        </div>

        {aiDraft && (
          <div className="card" style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontWeight: 700 }}>Suggested review</div>
            <div>Rating: {'⭐'.repeat(aiDraft.ratingSuggested || 5)}</div>
            {aiDraft.titleSuggested && <div style={{ fontWeight: 600 }}>{aiDraft.titleSuggested}</div>}
            {aiDraft.bodySuggested && <div style={{ whiteSpace: 'pre-wrap' }}>{aiDraft.bodySuggested}</div>}
            {aiDraft.anchors && (
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                Requests: {aiDraft.anchors.tickets} · Orders: {aiDraft.anchors.orders} · On-time: {aiDraft.anchors.onTime} · Late:{' '}
                {aiDraft.anchors.late} · Avg mins: {aiDraft.anchors.avgMins}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={applySuggestion} type="button">
                Use this in the form
              </button>
              <button className="btn btn-outline" onClick={() => setAiDraft(null)} type="button">
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
