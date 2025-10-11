import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { claimInit, claimVerify } from '../lib/api';

const TOKEN_KEY = 'stay:token';

export default function ClaimStay() {
  const n = useNavigate();
  const qs = new URLSearchParams(location.search);
  const [bookingCode, setBookingCode] = useState(qs.get('booking') || 'ABC123');
  const [contact, setContact] = useState(qs.get('contact') || '9999999999'); // phone/email
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [otp, setOtp] = useState('');
  const [msg, setMsg] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState<string | undefined>(undefined);

  useEffect(() => {
    // If already logged in, go dashboard
    const tok = localStorage.getItem(TOKEN_KEY);
    if (tok) n('/dashboard', { replace: true });
  }, [n]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    setLoading(true);
    try {
      const r = await claimInit(bookingCode.trim(), contact.trim());
      setHint((r as any)?.otp_hint);
      setStep('otp');
    } catch (e: any) {
      setMsg(e?.message || 'Failed to start claim');
    } finally {
      setLoading(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    setLoading(true);
    try {
      const r = await claimVerify(bookingCode.trim(), otp.trim());
      const token = (r as any)?.token;
      if (!token) throw new Error('No token returned');
      localStorage.setItem(TOKEN_KEY, token);
      n('/dashboard', { replace: true });
    } catch (e: any) {
      setMsg(e?.message || 'Failed to verify OTP');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-md mx-auto p-4">
      <h1 className="text-xl font-semibold mb-3">Claim your stay</h1>
      {msg && <div className="mb-3 p-2 rounded border border-amber-300 bg-amber-50 text-amber-800">{msg}</div>}

      {step === 'form' && (
        <form onSubmit={start} className="bg-white rounded shadow p-4 space-y-3">
          <label className="text-sm">
            Booking code
            <input className="input w-full mt-1" required value={bookingCode} onChange={(e) => setBookingCode(e.target.value)} />
          </label>
          <label className="text-sm">
            Phone or email (used for your booking)
            <input className="input w-full mt-1" required value={contact} onChange={(e) => setContact(e.target.value)} />
          </label>
          <button className="btn" disabled={loading} type="submit">{loading ? 'Please wait…' : 'Send OTP'}</button>
          {hint && <div className="text-xs text-gray-500">Demo OTP: <b>{hint}</b></div>}
        </form>
      )}

      {step === 'otp' && (
        <form onSubmit={verify} className="bg-white rounded shadow p-4 space-y-3">
          <div className="text-sm text-gray-700">We’ve sent an OTP to <b>{contact}</b></div>
          <label className="text-sm">
            Enter OTP
            <input className="input w-full mt-1" required value={otp} onChange={(e) => setOtp(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <button className="btn" disabled={loading} type="submit">{loading ? 'Verifying…' : 'Verify'}</button>
            <button className="btn btn-light" type="button" onClick={() => setStep('form')}>Change details</button>
          </div>
          {hint && <div className="text-xs text-gray-500">Demo OTP: <b>{hint}</b></div>}
        </form>
      )}
    </main>
  );
}
