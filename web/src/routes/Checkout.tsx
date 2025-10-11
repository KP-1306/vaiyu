import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { checkout, setBookingConsent, redeemCredits } from '../lib/api';

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

const TOKEN_KEY = 'stay:token';

export default function Checkout() {
  const { code = '' } = useParams();
  const [consent, setConsent] = useState<boolean>(true);
  const [autopost, setAutopost] = useState<boolean>(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<CheckoutResponse | null>(null);

  // Credits UI
  const [creditsProperty, setCreditsProperty] = useState<string>(''); // property slug; if you can infer this, prefill it
  const [creditsAmount, setCreditsAmount] = useState<number>(0);
  const [creditsMsg, setCreditsMsg] = useState<string>('');
  const [creditsBusy, setCreditsBusy] = useState<boolean>(false);
  const token = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) || '' : '';

  async function onApplyCredits(e: React.FormEvent) {
    e.preventDefault();
    setCreditsMsg('');
    setErr(null);
    if (!creditsProperty) {
      setErr('Please enter the property slug to apply credits.');
      return;
    }
    if (creditsAmount <= 0) {
      setErr('Enter a positive amount to redeem.');
      return;
    }
    try {
      setCreditsBusy(true);
      const r = await redeemCredits(token, creditsProperty.trim(), Math.floor(creditsAmount), {
        reason: 'checkout',
        bookingCode: code || undefined,
      });
      setCreditsMsg(`Applied ₹${creditsAmount}. New balance: ₹${r?.newBalance ?? '—'}`);
    } catch (e: any) {
      setErr(e?.message || 'Failed to apply credits');
    } finally {
      setCreditsBusy(false);
    }
  }

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
      // 1) Record consent preference
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

      {/* NEW: Apply credits */}
      <section className="bg-gray-50 p-4 rounded border space-y-2">
        <div className="font-medium">Use credits</div>
        <div className="text-xs text-gray-600">
          Credits are property-scoped and reduce your F&amp;B/services bill.
        </div>

        <form onSubmit={onApplyCredits} className="mt-2 grid gap-2">
          <label className="text-sm">
            Property slug
            <input
              className="mt-1 border rounded w-full px-2 py-1"
              placeholder="e.g. sunrise"
              value={creditsProperty}
              onChange={(e) => setCreditsProperty(e.target.value)}
            />
          </label>

          <label className="text-sm">
            Amount (₹)
            <input
              type="number"
              min={0}
              className="mt-1 border rounded w-full px-2 py-1"
              value={creditsAmount}
              onChange={(e) => setCreditsAmount(Number(e.target.value))}
            />
          </label>

          <div>
            <button
              disabled={creditsBusy || creditsAmount <= 0}
              className="px-4 py-2 rounded border bg-white hover:bg-gray-50 disabled:opacity-60"
            >
              {creditsBusy ? 'Applying…' : 'Apply credits'}
            </button>
          </div>
        </form>

        {creditsMsg && <div className="text-sm text-emerald-700">{creditsMsg}</div>}
      </section>

      {/* Finish checkout */}
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
