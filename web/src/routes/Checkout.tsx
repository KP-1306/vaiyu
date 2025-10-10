// web/src/routes/Checkout.tsx
import { useCallback, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  checkout as apiCheckout,
  setBookingConsent,
} from '../lib/api';

type ReviewAnchors = {
  tickets: number;
  orders: number;
  onTime: number;
  late: number;
  avgMins: number;
  details?: string[];
};

type ReviewLike = {
  id: string;
  hotel_slug: string;
  rating: number;
  title?: string;
  body?: string;
  verified: boolean;
  created_at: string;
  guest_name?: string;
  source: 'guest' | 'auto';
  status: 'pending' | 'published' | 'rejected' | 'draft';
  visibility: 'public' | 'private';
  booking_code?: string;
  anchors?: ReviewAnchors;
};

type CheckoutResponse = {
  ok: boolean;
  invoice: string;
  review_link: string;
  note?: string;
  review?: ReviewLike;         // if auto-published
  pending_review?: ReviewLike; // if created as pending
};

export default function Checkout() {
  const { code = '' } = useParams();
  const [consent, setConsent] = useState(true); // default to true (guest can opt-out)
  const [autoPost, setAutoPost] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<CheckoutResponse | null>(null);

  const hasOutcome = useMemo(
    () => !!(result?.review || result?.pending_review || result?.note),
    [result]
  );

  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    setResult(null);
    try {
      // 1) Record/overwrite consent for this booking
      if (code) {
        await setBookingConsent(code, consent);
      }

      // 2) Trigger checkout, optionally autopost the AI summary
      const r = await apiCheckout({ bookingCode: code, autopost: autoPost });
      setResult(r as CheckoutResponse);
    } catch (e: any) {
      setErr(e?.message || 'Checkout failed');
    } finally {
      setSubmitting(false);
    }
  }, [code, consent, autoPost]);

  return (
    <main className="max-w-2xl mx-auto p-4 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Checkout</h1>
        <span className="text-sm text-gray-600">Stay code: <b>{code || '—'}</b></span>
      </header>

      {err && <div className="card" style={{ borderColor: '#f59e0b' }}>⚠️ {err}</div>}

      <form onSubmit={onSubmit} className="card space-y-3">
        <div className="text-sm text-gray-700">
          Finalize the stay and (optionally) create a truth-anchored experience summary.
        </div>

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            I consent to sharing a factual summary of my stay (requests, SLAs, orders) as a public review/experience.
            <div className="text-xs text-gray-500">
              You can change this choice now; it only affects this checkout.
            </div>
          </span>
        </label>

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={autoPost}
            onChange={(e) => setAutoPost(e.target.checked)}
          />
          <span>
            Auto-create an AI summary at checkout
            <div className="text-xs text-gray-500">
              If property policy blocks auto-post (e.g., too many late SLAs), a <b>pending</b> draft will be created instead.
            </div>
          </span>
        </label>

        <div className="flex gap-2">
          <button className="btn" type="submit" disabled={submitting}>
            {submitting ? 'Processing…' : 'Complete Checkout'}
          </button>
          {result?.invoice && (
            <a className="btn btn-light" href={result.invoice} target="_blank" rel="noreferrer">
              View Invoice
            </a>
          )}
        </div>
      </form>

      {/* Outcome section */}
      {hasOutcome && (
        <section className="card space-y-3">
          <div className="font-semibold">Outcome</div>

          {result?.note && (
            <div className="text-sm text-gray-700">{result.note}</div>
          )}

          {result?.review && <ReviewCard title="Published review" r={result.review} />}
          {result?.pending_review && <ReviewCard title="Pending review (awaiting approval)" r={result.pending_review} />}

          {result?.review_link && (
            <div className="text-xs text-gray-500">
              Review link: <a className="link" href={result.review_link} target="_blank" rel="noreferrer">{result.review_link}</a>
            </div>
          )}
        </section>
      )}

      {!hasOutcome && (
        <section className="card">
          <div className="text-sm text-gray-600">
            Once you complete checkout, any applicable review will appear here (published or pending).
          </div>
        </section>
      )}
    </main>
  );
}

function ReviewCard({ title, r }: { title: string; r: ReviewLike }) {
  return (
    <div className="border rounded p-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold">{title}</div>
        <div className="flex items-center gap-2">
          <span className="badge">{r.source === 'auto' ? 'AI' : 'Guest'}</span>
          <span className={`badge ${r.status === 'published' ? 'badge-success' : 'badge-muted'}`}>
            {r.status}
          </span>
          <span className={`badge ${r.visibility === 'public' ? '' : 'badge-muted'}`}>
            {r.visibility}
          </span>
        </div>
      </div>

      <div className="mt-1">{'⭐'.repeat(r.rating)}</div>
      {r.title && <div className="mt-1 font-medium">{r.title}</div>}
      {r.body && <div className="mt-1 whitespace-pre-wrap">{r.body}</div>}

      {r.anchors && (
        <details className="mt-2">
          <summary className="cursor-pointer">Why this rating?</summary>
          <div className="text-sm mt-2 text-gray-700">
            Requests: {r.anchors.tickets} · Orders: {r.anchors.orders} · On-time: {r.anchors.onTime} · Late: {r.anchors.late} · Avg mins: {r.anchors.avgMins}
            {r.anchors.details?.length ? (
              <div className="mt-2">
                {r.anchors.details.map((d, i) => (
                  <div key={i} style={{ opacity: 0.9 }}>{d}</div>
                ))}
              </div>
            ) : null}
          </div>
        </details>
      )}

      <div className="text-xs text-gray-500 mt-2">
        {r.guest_name ? `by ${r.guest_name} • ` : ''}{new Date(r.created_at).toLocaleString()}
      </div>
    </div>
  );
}
