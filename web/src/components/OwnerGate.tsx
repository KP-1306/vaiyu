import { useState } from 'react';

const KEY = 'owner:pin';

export default function OwnerGate({ children }: { children: React.ReactNode }) {
  const [ok, setOk] = useState(() => localStorage.getItem(KEY) === '1');
  const [pin, setPin] = useState('');

  function check(e: React.FormEvent) {
    e.preventDefault();
    // choose your pin here or read from Vite env (e.g., import.meta.env.VITE_OWNER_PIN)
    const expected = import.meta.env.VITE_OWNER_PIN || '1234';
    if (pin === expected) {
      localStorage.setItem(KEY, '1');
      setOk(true);
    } else {
      alert('Wrong PIN');
    }
  }

  if (ok) return <>{children}</>;

  return (
    <main className="max-w-sm mx-auto p-6">
      <h1 className="text-xl font-semibold mb-3">Owner Access</h1>
      <form onSubmit={check} className="bg-white rounded shadow p-4 space-y-3">
        <input
          className="input w-full"
          placeholder="Enter PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
        <button className="btn" type="submit">Continue</button>
      </form>
    </main>
  );
}
