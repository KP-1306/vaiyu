import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { regcard, setBookingConsent } from '../lib/api';

const LS = (code: string) => `consent:${code}`;

export default function Regcard() {
  const { code = '' } = useParams();
  const [name, setName] = useState('Test Guest');
  const [phone, setPhone] = useState('9999999999');
  const [idNo, setIdNo] = useState('');
  const [consent, setConsent] = useState<boolean>(true); // default on (can change)
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pdf, setPdf] = useState<string | null>(null);

  // restore last choice (local cache so we can show it later on checkout)
  useEffect(() => {
    if (!code) return;
    try {
      const raw = localStorage.getItem(LS(code));
      if (raw !== null) setConsent(raw === '1');
    } catch {}
  }, [code]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code) return;
    setErr(null);
    setSaving(true);
    try {
      // 1) simulate regcard
      const r = await regcard({ code, name, phone, idNo });
      setPdf((r as any)?.pdf || null);

      // 2) persist consent on backend
      await setBookingConsent(code, consent);

      // 3) remember locally for a better UX across pages
      try { localStorage.setItem(LS(code), consent ? '1' : '0'); } catch {}

      alert('Registration saved. Consent preference recorded.');
    } catch (e: any) {
      setErr(e?.message || 'Failed to save registration');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Guest Registration</h1>
        <div className="text-sm text-gray-600">Stay code: {code}</div>
      </header>

      {err && <div className="card" style={{ borderColor: '#f59e0b' }}>⚠️ {err}</div>}

      <form onSubmit={submit} className="bg-white rounded shadow p-4 space-y-3">
        <label className="text-sm">
          Full name
          <input className="input w-full mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="text-sm">
          Phone
          <input className="input w-full mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="text-sm">
          ID number
          <input className="input w-full mt-1" value={idNo} onChange={(e) => setIdNo(e.target.value)} />
        </label>

        {/* Consent capture */}
        <label className="flex items-start gap-2 text-sm bg-gray-50 rounded p-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            I consent to an AI-generated summary of my stay being posted publicly under my first name.  
            This helps the property improve and helps future guests. You can change this later during checkout.
          </span>
        </label>

        <div className="flex items-center gap-2">
          <button className="btn" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save & Continue'}
          </button>
          {pdf && (
            <a className="btn btn-light" href={pdf} target="_blank" rel="noreferrer">
              View PDF
            </a>
          )}
          <Link className="link ml-auto" to={`/checkout/${encodeURIComponent(code)}`}>
            Go to Checkout →
          </Link>
        </div>
      </form>
    </main>
  );
}
