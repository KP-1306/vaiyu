// web/src/routes/ClaimStay.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { claimInit, claimVerify } from '../lib/api';

const TOKEN_KEY = 'stay:token';

type InitResp = {
  ok?: boolean;
  method?: 'otp';
  sent?: boolean;
  // optional fields if you decide to expose a hint in demo mode
  demo?: boolean;
  otp_hint?: string;
};

type VerifyResp = {
  ok?: boolean;
  token?: string;
  booking?: { code: string; guest_name?: string; hotel_slug?: string };
};

export default function ClaimStay() {
  const n = useNavigate();
  const qs = new URLSearchParams(window.location.search);
  const [bookingCode, setBookingCode] = useState(qs.get('booking') || 'ABC123');
  const [phone, setPhone] = useState(qs.get('contact') || '9999999999'); // phone used on the booking
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [otp, setOtp] = useState('');
  const [msg, setMsg] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState<string | undefined>(undefined);

  useEffect(() => {
    // If already claimed/logged in, go to guest area
    const tok = localStorage.getItem(TOKEN_KEY);
    if (tok) n('/dashboard', { replace: true });
  }, [n]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    setLoading(true);
    setHint(undefined);
    try {
      // API expects an object: { code, phone }
      const r = (await claimInit({ code: bookingCode.trim(), phone: phone.trim() })) as InitResp;
      if (!r || r.ok === false) throw new Error('Could not start claim');

      // Optional demo hint (we return it only in demo/offline mode)
      if (r.otp_hint) setHint(r.otp_hint);

      setStep('otp');
    } catch (err: any) {
      setMsg(err?.message || 'Failed to start claim');
    } finally {
      setLoading(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    setLoading(true);
    try {
      // API expects an object: { code, otp }
      const r = (await claimVerify({ code: bookingCode.trim(), otp: otp.trim() })) as VerifyResp;
      const token = r?.token;
      if (!token) throw new Error('No token returned');

      localStorage.setItem(TOKEN_KEY, token);

      // If booking is returned, drop the user into their guest menu for that booking
      const next =
        r?.booking?.code ? `/stay/${encodeURIComponent(r.booking.code)}/menu` : '/dashboard';
      n(next, { replace: true });
    } catch (err: any) {
      setMsg(err?.message || 'Failed to verify OTP');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-md mx-auto p-4">
      <h1 className="text-xl font-semibold mb-3">Claim your stay</h1>
      {msg && (
        <div className="mb-3 p-2 rounded border border-amber-300 bg-amber-50 text-amber-800">
          {msg}
        </div>
      )}

      {step === 'form' && (
        <form onSubmit={start} className="bg-white rounded shadow p-4 space-y-3">
          <label className="text-sm">
            Booking code
            <input
              className="input w-full mt-1"
              required
              value={bookingCode}
              onChange={(e) => setBookingCode(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Phone on your booking
            <input
              className="input w-full mt-1"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <button className="btn" disabled={loading} type="submit">
            {loading ? 'Please wait…' : 'Send OTP'}
          </button>
          {hint && (
            <div className="text-xs text-gray-500">
              Demo OTP:&nbsp;<b>{hint}</b>
            </div>
          )}
        </form>
      )}

      {step === 'otp' && (
        <form onSubmit={verify} className="bg-white rounded shadow p-4 space-y-3">
          <div className="text-sm text-gray-700">
            We’ve sent an OTP to <b>{phone}</b>
          </div>
          <label className="text-sm">
            Enter OTP
            <input
              className="input w-full mt-1"
              required
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button className="btn" disabled={loading} type="submit">
              {loading ? 'Verifying…' : 'Verify'}
            </button>
            <button className="btn btn-light" type="button" onClick={() => setStep('form')}>
              Change details
            </button>
          </div>
          {hint && (
            <div className="text-xs text-gray-500">
              Demo OTP:&nbsp;<b>{hint}</b>
            </div>
          )}
        </form>
      )}
    </main>
  );
}
