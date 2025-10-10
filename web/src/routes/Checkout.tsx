import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { checkout, setBookingConsent } from '../lib/api';

const LS = (code: string) => `consent:${code}`;

type ReviewOut = {
  id: string;
  source: 'auto' | 'guest';
  status: 'published' | 'pending' | 'rejected' | 'draft';
  visibility: 'public' | 'private';
  rating: number;
  title?: string;
  body?: string;
  created_at: string;
};

export default function Checkout() {
  const { code = '' } = useParams();
  const [autopost, setAutopost] = useState(true);
  const [consent, setConsentState] = useState<boolean>(true);
  const [updatingConsent, setUpdatingConsent] = useState(false);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  // restore consent preference captured on Regcard
  useEffect(() => {
    if (!code) return;
    try {
      const raw = localStorage.getItem(LS(code));
      if (raw !== null) setConsentState(raw === '1');
    } catch {}
  }, [code]);

  const reviewNote = useMemo(() => {
    if (!result) return '';
    if (result.review) return '✅ Review published automatically (policy allowed).';
    if (result.pending_review) return `🟡 Draft created, pending approval (${result.note || 'policy check'}).`;
    return '';
  }, [result]);

  async function updateConsent(newVal: boolean) {
    if (!code) return;
    setUpdatingConsent(true);
    try {
      await setBookingConsent(code, newVal);
      try { localStorage.setItem(LS(code), newVal ? '1' : '0'); } catch {}
      setConsentState(newVal);
    } finally {
      setUpdatingConsent(false);
    }
  }

  async function doCheckout() {
    if (!code) return;
    setErr(null);
    setLoading(true);
    setResult(null);
    try {
      const r = await checkout({ bookingCode: code, autopost });
      setResult(r);
    } catch (e: any) {
      setErr(e?.message || 'Checkout failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-xl mx-auto p-4 space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Checkout</h1>
        <div className="text-sm text-gray-600">Stay code: {code}</div>
      </header>

      {err && <div className="card" style={{ borderColor: '#f59e0b' }}>⚠️ {err}</div>}

      <section className="card">
        <div className="font-semibold mb-2">Review/Experience consent</div>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            Current status:{' '}
            <b className={consent ? 'text-emerald-700' : 'text-gray-700'}>
              {consent ? 'Given' : 'Not given'}
            </b>
            <div className="text-xs text-gray-600">
              (Owner policy may still require consent to auto-publish.)
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn btn-light"
              onClick={() => updateConsent(!consent)}
              disabled={updatingConsent}
              title="Toggle consent"
            >
              {updatingConsent ? 'Updating…' : consent ? 'Revoke consent' : 'Grant consent'}
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="font-semibold mb-2">Finalize</div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autopost}
            onChange={(e) => setAutopost(e.target.checked)}
          />
          Try auto-post review on checkout (policy-aware)
        </label>
        <div className="flex items-center gap-2 mt-3">
          <button className="btn" onClick={doCheckout} disabled={loading}>
            {loading ? 'Processing…' : 'Complete checkout'}
          </button>
          <Link className="link" to={`/regcard/${encodeURIComponent(code)}`}>
            ← Back to Regcard
          </Link>
        </div>
      </section>

      {result && (
        <section className="card">
          <div className="font-semibold mb-1">Result</div>
          <pre className="text-xs bg-gray-50 rounded p-2 overflow-auto">
            {JSON.stringify(result, null, 2)}
          </pre>
          {reviewNote && <div className="mt-2 text-sm">{reviewNote}</div>}

          {/* quick view if a review is created */}
          {result?.review && <ReviewCard r={result.review as ReviewOut} />}
          {result?.pending_review && <ReviewCard r={result.pending_review as ReviewOut} pending />}
        </section>
      )}
    </main>
  );
}

function ReviewCard({ r, pending }: { r: ReviewOut; pending?: boolean }) {
  return (
    <div className="mt-3 bg-white rounded border p-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold">
          {pending ? 'Pending draft' : 'Published review'} · {'⭐'.repeat(r.rating)}
        </div>
        <span className="badge">{r.source === 'auto' ? 'AI' : 'Guest'}</span>
      </div>
      {r.title && <div className="mt-1 font-medium">{r.title}</div>}
      {r.body && <div className="mt-1 whitespace-pre-wrap">{r.body}</div>}
    </div>
  );
}
