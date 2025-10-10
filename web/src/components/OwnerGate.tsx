// web/src/components/OwnerGate.tsx
import { useMemo, useState } from 'react';

const STORAGE_KEY = 'owner:pin';

export default function OwnerGate({ children }: { children: React.ReactNode }) {
  // Read expected PIN from env (Netlify → Vite)
  const EXPECTED = useMemo(
    () => String(import.meta.env.VITE_OWNER_PIN || '').trim(),
    []
  );

  // If no PIN configured, treat as unlocked (dev-friendly)
  const [ok, setOk] = useState<boolean>(() => {
    if (!EXPECTED) return true;
    return localStorage.getItem(STORAGE_KEY) === EXPECTED;
  });
  const [pin, setPin] = useState('');

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const entered = pin.trim();
    if (!EXPECTED) {
      // Shouldn't happen (unlocked mode), but allow through
      setOk(true);
      return;
    }
    if (entered === EXPECTED) {
      // Store the actual PIN so a PIN change invalidates old sessions
      localStorage.setItem(STORAGE_KEY, EXPECTED);
      setOk(true);
    } else {
      alert('Incorrect PIN');
    }
  }

  if (ok) {
    // (Optional) expose a small logout helper in dev:
    // window.ownerLogout = () => localStorage.removeItem(STORAGE_KEY);
    return <>{children}</>;
  }

  return (
    <main className="max-w-sm mx-auto p-6">
      <h1 className="text-xl font-semibold mb-3">Owner Access</h1>

      {!EXPECTED && (
        <div className="card" style={{ marginBottom: 12, borderColor: '#f59e0b' }}>
          <b>Note:</b> No <code>VITE_OWNER_PIN</code> is set — owner routes run unlocked in this environment.
        </div>
      )}

      <form onSubmit={onSubmit} className="bg-white rounded shadow p-4 space-y-3">
        <input
          className="input w-full"
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="Enter PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
        <button className="btn w-full" type="submit">
          Continue
        </button>
      </form>

      <div className="text-xs text-gray-600 mt-3">
        Tip: set <code>VITE_OWNER_PIN</code> in your Netlify env to require a PIN in production.
      </div>
    </main>
  );
}
