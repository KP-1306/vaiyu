// web/src/routes/ClaimStay.tsx
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { API } from "../lib/api";

type InitResp =
  | { ok: true; claimId: string }
  | { ok: false; error: string };

type VerifyResp =
  | { ok: true; bookingId?: string }
  | { ok: false; error: string };

export default function ClaimStay() {
  const nav = useNavigate();

  // Step state
  const [step, setStep] = useState<"init" | "verify">("init");

  // Form fields
  const [bookingCode, setBookingCode] = useState("");
  const [channel, setChannel] = useState<"phone" | "email">("phone");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  // OTP
  const [claimId, setClaimId] = useState<string | null>(null);
  const [otp, setOtp] = useState("");

  // UX state
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleInit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!bookingCode.trim()) {
      setError("Please enter your booking code.");
      return;
    }
    if (channel === "phone" && !/^\d{8,15}$/.test(phone.trim())) {
      setError("Enter a valid phone number (digits only).");
      return;
    }
    if (channel === "email" && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`${API}/claim/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          bookingCode: bookingCode.trim(),
          phone: channel === "phone" ? phone.trim() : undefined,
          email: channel === "email" ? email.trim() : undefined,
        }),
      });
      const j = (await res.json()) as InitResp;
      if (!res.ok || !("ok" in j) || !j.ok) {
        throw new Error((j as any).error || `Failed to send OTP (${res.status})`);
      }
      setClaimId(j.claimId);
      setStep("verify");
    } catch (err: any) {
      setError(err?.message || "Could not start claim.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!otp.trim()) {
      setError("Please enter the OTP.");
      return;
    }
    if (!claimId) {
      setError("Missing claim session. Please start again.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`${API}/claim/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ claimId, otp: otp.trim() }),
      });
      const j = (await res.json()) as VerifyResp;
      if (!res.ok || !("ok" in j) || !j.ok) {
        throw new Error((j as any).error || `Verification failed (${res.status})`);
      }
      nav("/guest", { replace: true });
    } catch (err: any) {
      setError(err?.message || "Could not verify OTP.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50">
      {/* Top bar with single nav control */}
      <header className="sticky top-0 z-10 backdrop-blur bg-white/70 border-b">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
              {/* key icon */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M21 7a5 5 0 0 1-7.938 4.063L10 14h-2v2H6v2H4v-2.586l5.062-5.062A5 5 0 1 1 21 7zM17 7a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
            </span>
            <span className="font-semibold">Claim your stay</span>
          </div>
          <Link to="/guest" className="btn btn-light">← Back to dashboard</Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-2 gap-8 items-start">
          {/* Left: Brand / Illustration */}
          <div className="hidden lg:block">
            <div className="relative rounded-3xl overflow-hidden border shadow-sm bg-white">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-emerald-50 to-amber-50" />
              <div className="relative p-8">
                <h2 className="text-2xl font-semibold">Welcome to VAiyu</h2>
                <p className="text-slate-600 mt-2">
                  Verify your booking with a quick OTP. You can use your phone number or email
                  (since SMS is not connected yet).
                </p>

                {/* Stepper */}
                <ol className="mt-6 space-y-4">
                  <Step num={1} title="Verify details" active={step === "init"} done={step === "verify"}>
                    Enter your booking code and choose Phone or Email.
                  </Step>
                  <Step num={2} title="Enter OTP" active={step === "verify"}>
                    Type the 6-digit code sent to your contact.
                  </Step>
                </ol>

                {/* Decorative card */}
                <div className="mt-8 rounded-2xl border bg-white/70 p-5">
                  <div className="flex items-center gap-3">
                    <span className="h-10 w-10 rounded-xl bg-blue-600/10 text-blue-700 flex items-center justify-center">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <path d="M7 7h10M7 12h6M7 17h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
                      </svg>
                    </span>
                    <div>
                      <div className="font-medium">Demo mode</div>
                      <div className="text-sm text-slate-600">Use OTP <span className="font-mono">123456</span> for testing.</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Form */}
          <section className="rounded-3xl border bg-white shadow-sm p-6 lg:p-8">
            {error ? (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm p-3">
                {error}
              </div>
            ) : null}

            {step === "init" ? (
              <form className="grid gap-5" onSubmit={handleInit}>
                <div>
                  <label className="text-sm font-medium">Booking code</label>
                  <div className="mt-1 relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path d="M4 7h16M7 12h10M9 17h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                      </svg>
                    </span>
                    <input
                      className="w-full rounded-xl border px-10 py-2.5 outline-none ring-0 focus:border-blue-500 focus:bg-blue-50/20 transition"
                      value={bookingCode}
                      onChange={(e) => setBookingCode(e.target.value.toUpperCase())}
                      placeholder="ABC123"
                      autoComplete="one-time-code"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">Verify via</label>
                  <div className="mt-2 inline-grid grid-cols-2 rounded-xl border bg-slate-50 p-1">
                    <button
                      type="button"
                      className={`px-4 py-2 rounded-lg text-sm transition ${
                        channel === "phone"
                          ? "bg-white shadow-sm border"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                      onClick={() => setChannel("phone")}
                    >
                      Phone
                    </button>
                    <button
                      type="button"
                      className={`px-4 py-2 rounded-lg text-sm transition ${
                        channel === "email"
                          ? "bg-white shadow-sm border"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                      onClick={() => setChannel("email")}
                    >
                      Email
                    </button>
                  </div>
                </div>

                {channel === "phone" ? (
                  <div>
                    <label className="text-sm font-medium">Phone on your booking</label>
                    <div className="mt-1 relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">+91</span>
                      <input
                        className="w-full rounded-xl border pl-12 pr-4 py-2.5 outline-none focus:border-blue-500 focus:bg-blue-50/20 transition"
                        value={phone}
                        inputMode="numeric"
                        onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                        placeholder="9999999999"
                      />
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Digits only, 8–15 characters.</p>
                  </div>
                ) : (
                  <div>
                    <label className="text-sm font-medium">Email on your booking</label>
                    <input
                      className="mt-1 w-full rounded-xl border px-4 py-2.5 outline-none focus:border-blue-500 focus:bg-blue-50/20 transition"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                    />
                  </div>
                )}

                <button className="btn w-full h-11 rounded-xl" type="submit" disabled={busy}>
                  {busy ? "Sending…" : "Send OTP"}
                </button>

                <div className="text-xs text-slate-500 text-center">Demo OTP: 123456</div>
              </form>
            ) : (
              <form className="grid gap-5" onSubmit={handleVerify}>
                <div>
                  <label className="text-sm font-medium">Enter OTP</label>
                  <input
                    className="mt-1 w-full rounded-xl border px-4 py-2.5 tracking-widest text-center text-lg outline-none focus:border-blue-500 focus:bg-blue-50/20 transition"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.trim())}
                    placeholder="123456"
                    inputMode="numeric"
                    autoFocus
                  />
                </div>

                <div className="flex items-center gap-3">
                  <button className="btn w-full h-11 rounded-xl" type="submit" disabled={busy}>
                    {busy ? "Verifying…" : "Verify"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-light h-11 rounded-xl"
                    onClick={() => {
                      setStep("init");
                      setOtp("");
                      setClaimId(null);
                    }}
                    disabled={busy}
                  >
                    Start over
                  </button>
                </div>

                <div className="text-xs text-slate-500 text-center">Demo OTP: 123456</div>
              </form>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

/** ---------- small presentational helper ---------- */
function Step({
  num,
  title,
  active,
  done,
  children,
}: {
  num: number;
  title: string;
  active?: boolean;
  done?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={[
          "inline-flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold",
          done ? "bg-green-600 text-white border-green-600" : "",
          active && !done ? "bg-blue-600 text-white border-blue-600" : "",
          !active && !done ? "bg-white text-slate-700 border-slate-300" : "",
        ].join(" ")}
      >
        {done ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : (
          num
        )}
      </span>
      <div>
        <div className="font-medium">{title}</div>
        {children ? <div className="text-sm text-slate-600">{children}</div> : null}
      </div>
    </li>
  );
}
