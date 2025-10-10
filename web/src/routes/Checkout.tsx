// web/src/routes/Checkout.tsx
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { checkout, setBookingConsent } from '../lib/api';

type ApiReview = {
  id: string;
  rating: number;
  title?: string;
  body?: string;
  created_at: string;
  source: 'guest' | 'auto';
  status: 'pending' | 'published' | 'rejected' | 'draft';
  visibility: 'public' | 'private';
};

type CheckoutResponse = {
  ok: boolean;
  invoice?: string;
  review_link?: string;
  note?: string;
  review?: ApiReview;         // auto-published
  pending_review?: ApiReview; // created but needs approval
};

export default function Checkout() {
  const { code = '' } = useParams();
  const [consent, setConsent] = useState<boolean>(true);
  const [autopost, setAutopost] = useState<boolean>(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<CheckoutResponse | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code) {
      setErr('Missing booking code in the URL.');
      return;
    }

    setBusy(true);
    setErr(null);
    setRes(null);

    try {
      // 1) Record consent preference (safe to call anytime)
      await setBookingConsent(code, consent);

      // 2) Checkout (and optionally request auto publication)
      const out = await checkout({ bookingCode: code, autopost });
      setRes(out as CheckoutResponse);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e: any) {
      setErr(e?.message || 'Checkout failed');
    } finally {
      setBusy(false);
    }
  }

  const Published = res?.review;
  const Pending = res?.pending_review;

  return (
    <main className="max-w-xl mx-auto p-4 space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Checkout</h1>
        <div className="text-sm text-gray-600">Booking code: <b>{code || '—'}</b></div>
      </header>

      {err && (
        <div className="p-2 bg-amber-50 border border-amber-200 rounded text-amber-800">
          ⚠️ {err}
        </div>
      )}

      {res && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-emerald-800 space-y-2">
          <div>Checkout completed.</div>
          {res.invoice && (
            <div>
              Invoice: <a className="link" href={res.invoice} target="_blank" rel="noreferrer">Download</a>
            </div>
          )}
          {res.review_link && (
            <div>
              Review link: <a className="link" href={res.review_link} target="_blank" rel="noreferrer">Open</a>
            </div>
          )}
          {res.note && <div className="text-sm opacity-90">{res.note}</div>}
        </div>
      )}

      {/* Auto-published result */}
      {Published && (
        <section className="card">
          <div className="font-semibold">Published review</div>
          <div className="text-sm text-gray-600">Source: {Published.source.toUpperCase()}</div>
          <div className="mt-2">{'⭐'.repeat(Published.rating)}</div>
          {Published.title && <div className="mt-1 font-semibold">{Published.title}</div>}
          {Published.body && <div className="mt-1 whitespace-pre-wrap">{Published.body}</div>}
          <div className="mt-2 text-xs text-gray-500">
            {new Date(Published.created_at).toLocaleString()} • {Published.status}/{Published.visibility}
          </div>
        </section>
      )}

      {/* Pending result (needs approval) */}
      {Pending && (
        <section className="card">
          <div className="font-semibold">AI review created — pending approval</div>
          <div className="text-sm text-gray-600">Source: {Pending.source.toUpperCase()}</div>
          <div className="mt-2">{'⭐'.repeat(Pending.rating)}</div>
          {Pending.title && <div className="mt-1 font-semibold">{Pending.title}</div>}
          {Pending.body && <div className="mt-1 whitespace-pre-wrap">{Pending.body}</div>}
          <div className="mt-2 text-xs text-gray-500">
            {new Date(Pending.created_at).toLocaleString()} • {Pending.status}/{Pending.visibility}
          </div>
        </section>
      )}

      {/* Form */}
      <form onSubmit={onSubmit} className="bg-white p-4 rounded shadow space-y-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span className="text-sm">
            I consent to publishing a truthful, activity-anchored review for this stay.
          </span>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={autopost}
            onChange={(e) => setAutopost(e.target.checked)}
          />
          <span className="text-sm">
            Auto-publish the AI-generated review if policy allows (else create a pending draft).
          </span>
        </label>

        <div className="pt-1">
          <button
            disabled={busy}
            className="px-4 py-2 rounded bg-sky-600 text-white disabled:opacity-60"
          >
            {busy ? 'Finishing…' : 'Finish checkout'}
          </button>
        </div>
      </form>

      <p className="text-xs text-gray-500">
        Note: Auto-publish respects your hotel’s policy (activity threshold, late SLA blocks, consent requirement).
      </p>
    </main>
  );
}
