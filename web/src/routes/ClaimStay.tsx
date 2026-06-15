// web/src/routes/ClaimStay.tsx
import { FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { claimInit, claimVerify, isDemo } from "../lib/api";
import SEO from "../components/SEO";
import Spinner from "../components/Spinner";

type Step = "form" | "otp";

export default function ClaimStay() {
  const { t } = useTranslation(["claimStay", "common"]);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Allow prefill via ?code=ABC123&phone=9999999999
  const initialCode = (searchParams.get("code") || "").toUpperCase();
  const initialPhone = searchParams.get("phone") || "";

  const [step, setStep] = useState<Step>("form");
  const [code, setCode] = useState(initialCode);
  const [phone, setPhone] = useState(initialPhone);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  function normalizePhone(raw: string) {
    return raw.replace(/[^\d]/g, "");
  }

  async function handleInit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setInfo(null);

    const trimmedCode = code.trim().toUpperCase();
    const cleanedPhone = normalizePhone(phone);

    if (!trimmedCode) {
      setErr(t("claimStay:validation.enterCode"));
      return;
    }
    if (!/^\d{8,15}$/.test(cleanedPhone)) {
      setErr(t("claimStay:validation.invalidPhone"));
      return;
    }

    setBusy(true);
    try {
      const res: any = await claimInit(trimmedCode, cleanedPhone);

      if (res && res.ok === false) {
        throw new Error(res.error || t("claimStay:validation.claimFailed"));
      }

      setStep("otp");

      if (isDemo() && res?.otp_hint) {
        setInfo(t("claimStay:demoOtpInfo", { otp: res.otp_hint }));
      } else {
        setInfo(t("claimStay:otpSent"));
      }
    } catch (e: any) {
      setErr(e?.message || t("claimStay:validation.claimFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setInfo(null);

    const trimmedCode = code.trim().toUpperCase();
    const trimmedOtp = otp.trim();

    if (!trimmedOtp) {
      setErr(t("claimStay:validation.enterOtp"));
      return;
    }

    setBusy(true);
    try {
      const res: any = await claimVerify(trimmedCode, trimmedOtp);

      if (res && res.ok === false) {
        throw new Error(res.error || t("claimStay:validation.verifyFailed"));
      }

      // --- Robustly extract booking + hotel info from any response shape ---
      const booking =
        res?.booking ??
        res?.data?.booking ??
        res?.data ??
        null;

      const bookingCode: string =
        booking?.code ??
        booking?.bookingCode ??
        res?.bookingCode ??
        res?.booking_code ??
        trimmedCode;

      // Prefer hotel_id when available (backend may use this for menu/services)
      const hotelId: string | undefined =
        booking?.hotel_id ??
        res?.hotelId ??
        res?.hotel_id ??
        undefined;

      const hotelSlug: string | undefined =
        booking?.hotel_slug ??
        booking?.hotelSlug ??
        booking?.hotel?.slug ??
        res?.hotelSlug ??
        undefined;

      // Prefer sending guest straight into their in-room menu.
      if (bookingCode) {
        const search = new URLSearchParams();

        // Keep existing behaviour: slug in `hotel` param (for current GuestMenu route).
        if (hotelSlug) search.set("hotel", hotelSlug);

        // NEW: also pass `hotelId` when backend returns it (future-proof).
        if (hotelId) search.set("hotelId", hotelId);

        const qs = search.toString();
        const menuPath = `/stay/${encodeURIComponent(bookingCode)}/menu${qs ? `?${qs}` : ""
          }`;

        navigate(menuPath, { replace: true });
        return;
      }

      // Fallback: guest dashboard (unchanged behaviour)
      navigate("/guest", { replace: true });
    } catch (e: any) {
      setErr(e?.message || t("claimStay:validation.verifyFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50">
      <SEO title={t("claimStay:seoTitle")} />

      {/* Top bar with single nav control */}
      <header className="sticky top-0 z-10 backdrop-blur bg-white/70 border-b">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
              {/* key icon */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M21 7a5 5 0 0 1-7.938 4.063L10 14h-2v2H6v2H4v-2.586l5.062-5.062A5 5 0 1 1 21 7zM17 7a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            </span>
            <span className="font-semibold">{t("claimStay:title")}</span>
          </div>
          <Link to="/guest" className="btn btn-light">
            {t("claimStay:backToDashboard")}
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-2 gap-8 items-start">
          {/* Left: Brand / Illustration */}
          <div className="hidden lg:block">
            <div className="relative rounded-3xl overflow-hidden border shadow-sm bg-white">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-emerald-50 to-amber-50" />
              <div className="relative p-8">
                <h2 className="text-2xl font-semibold">{t("claimStay:welcome")}</h2>
                <p className="text-slate-600 mt-2">
                  {t("claimStay:welcomeDesc")}
                </p>

                {/* Stepper */}
                <ol className="mt-6 space-y-4">
                  <Step
                    num={1}
                    title={t("claimStay:step1Title")}
                    active={step === "form"}
                    done={step === "otp"}
                  >
                    {t("claimStay:step1Desc")}
                  </Step>
                  <Step
                    num={2}
                    title={t("claimStay:step2Title")}
                    active={step === "otp"}
                    done={false}
                  >
                    {t("claimStay:step2Desc")}
                  </Step>
                </ol>

                {/* Decorative card */}
                <div className="mt-8 rounded-2xl border bg-white/70 p-5">
                  <div className="flex items-center gap-3">
                    <span className="h-10 w-10 rounded-xl bg-blue-600/10 text-blue-700 flex items-center justify-center">
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <path
                          d="M7 7h10M7 12h6M7 17h8"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                        />
                      </svg>
                    </span>
                    <div>
                      <div className="font-medium">{t("claimStay:secureTitle")}</div>
                      <div className="text-sm text-slate-600">
                        {t("claimStay:secureDesc")}
                      </div>
                    </div>
                  </div>
                  {isDemo() && (
                    <p className="mt-3 text-xs text-slate-500">
                      {t("claimStay:demoHint.pre")}{" "}
                      <span className="font-mono">ABC123</span> {t("claimStay:demoHint.mid")}{" "}
                      <span className="font-mono">123456</span> {t("claimStay:demoHint.post")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right: Form */}
          <section className="rounded-3xl border bg-white shadow-sm p-6 lg:p-8">
            {err && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm p-3">
                {err}
              </div>
            )}

            {info && (
              <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 text-blue-800 text-sm p-3">
                {info}
              </div>
            )}

            {busy && (
              <div className="mb-4 flex items-center gap-2 text-sm text-slate-600">
                <Spinner
                  label={
                    step === "form"
                      ? "Sending OTP to your phone…"
                      : "Verifying OTP…"
                  }
                />
              </div>
            )}

            {step === "form" ? (
              <form className="grid gap-5" onSubmit={handleInit}>
                <div>
                  <label className="text-sm font-medium">{t("claimStay:bookingCodeLabel")}</label>
                  <div className="mt-1 relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <path
                          d="M4 7h16M7 12h6M9 17h6"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                      </svg>
                    </span>
                    <input
                      className="w-full rounded-xl border px-10 py-2.5 outline-none ring-0 focus:border-blue-500 focus:bg-blue-50/20 transition"
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      placeholder="ABC123"
                      autoComplete="off"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">
                    {t("claimStay:phoneLabel")}
                  </label>
                  <div className="mt-1 relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                      +91
                    </span>
                    <input
                      className="w-full rounded-xl border pl-12 pr-4 py-2.5 outline-none focus:border-blue-500 focus:bg-blue-50/20 transition"
                      value={phone}
                      inputMode="numeric"
                      onChange={(e) =>
                        setPhone(normalizePhone(e.target.value))
                      }
                      placeholder="9999999999"
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {t("claimStay:phoneHint")}
                  </p>
                </div>

                <button
                  className="btn w-full h-11 rounded-xl"
                  type="submit"
                  disabled={busy}
                >
                  {busy ? t("claimStay:sending") : t("claimStay:sendOtp")}
                </button>

                {isDemo() && (
                  <div className="text-xs text-slate-500 text-center">
                    {t("claimStay:demoOtpLabel")} <span className="font-mono">123456</span>
                  </div>
                )}
              </form>
            ) : (
              <form className="grid gap-5" onSubmit={handleVerify}>
                <div>
                  <label className="text-sm font-medium">{t("claimStay:enterOtpLabel")}</label>
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
                  <button
                    className="btn w-full h-11 rounded-xl"
                    type="submit"
                    disabled={busy}
                  >
                    {busy ? t("claimStay:verifying") : t("claimStay:verifyOpen")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-light h-11 rounded-xl"
                    onClick={() => {
                      setStep("form");
                      setOtp("");
                      setInfo(null);
                      setErr(null);
                    }}
                    disabled={busy}
                  >
                    {t("claimStay:startOver")}
                  </button>
                </div>

                {isDemo() && (
                  <div className="text-xs text-slate-500 text-center">
                    Demo OTP: <span className="font-mono">123456</span>
                  </div>
                )}
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
          !active && !done
            ? "bg-white text-slate-700 border-slate-300"
            : "",
        ].join(" ")}
      >
        {done ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="m5 12 4 4L19 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          num
        )}
      </span>
      <div>
        <div className="font-medium">{title}</div>
        {children ? (
          <div className="text-sm text-slate-600">{children}</div>
        ) : null}
      </div>
    </li>
  );
}
