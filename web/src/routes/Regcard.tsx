// web/src/routes/Regcard.tsx
//
// Guest Registration (Regcard)
// - Uses booking "code" from route
// - Auto-prefills name/phone/ID from central Guest Identity (if available)
// - Persists consent both on backend + localStorage
// - Best-effort upsert to guest-identity so future flows can auto-fill

import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { regcard, setBookingConsent } from "../lib/api";
import * as apiLib from "../lib/api";
import { useGuestIdentity } from "../hooks/useGuestIdentity";

const LS = (code: string) => `consent:${code}`;

export default function Regcard() {
  const { code = "" } = useParams<{ code?: string }>();
  const bookingCode = (code || "").trim();

  const [name, setName] = useState("Test Guest");
  const [phone, setPhone] = useState("9999999999");
  const [idNo, setIdNo] = useState("");
  const [consent, setConsent] = useState<boolean>(true); // default on (can change)
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pdf, setPdf] = useState<string | null>(null);

  // -------- Guest Identity (auto-prefill) --------
  const gi: any =
    (useGuestIdentity as any)?.({
      bookingCode,
    }) ?? {};
  const identity =
    gi?.identity ?? gi?.guest ?? gi?.data ?? gi?.profile ?? null;
  const identityLoading: boolean = gi?.loading ?? gi?.isLoading ?? false;
  const identityError: any = gi?.error ?? null;

  useEffect(() => {
    if (!identity) return;

    // Only override obvious placeholders / empty values
    setName((prev) => {
      if (prev && prev !== "Test Guest") return prev;
      return (
        identity.name ||
        identity.full_name ||
        identity.display_name ||
        identity.guest_name ||
        prev
      );
    });

    setPhone((prev) => {
      if (prev && prev !== "9999999999") return prev;
      return (
        identity.phone ||
        identity.primary_phone ||
        identity.mobile ||
        identity.contact_phone ||
        prev
      );
    });

    setIdNo((prev) => {
      if (prev) return prev;
      return identity.id_number || identity.idNo || identity.id || prev;
    });
  }, [identity]);

  // Restore last consent choice (local cache)
  useEffect(() => {
    if (!bookingCode) return;
    try {
      const raw = localStorage.getItem(LS(bookingCode));
      if (raw !== null) setConsent(raw === "1");
    } catch {
      // ignore localStorage errors
    }
  }, [bookingCode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    if (!bookingCode) {
      setErr(
        "Missing booking code in the link. Please use the registration link sent by your hotel."
      );
      return;
    }

    setErr(null);
    setSaving(true);

    try {
      // 1) Call regcard backend
      const r = await regcard({ code: bookingCode, name, phone, idNo });
      setPdf((r as any)?.pdf || null);

      // 2) Persist consent on backend
      await setBookingConsent(bookingCode, consent);

      // 3) Best-effort: upsert Guest Identity so future flows can auto-fill
      try {
        const anyApi = apiLib as any;
        if (typeof anyApi.upsertGuestIdentity === "function") {
          await anyApi.upsertGuestIdentity({
            booking_code: bookingCode,
            name,
            phone,
            // we only collect ID number here; email is optional/unknown on this page
            id_number: idNo || null,
          });
        } else if (typeof anyApi.apiUpsert === "function") {
          // Generic fallback via /guest-identity-upsert Edge Function / backend route
          await anyApi.apiUpsert("/guest-identity-upsert", {
            booking_code: bookingCode,
            name,
            phone,
            id_number: idNo || null,
          });
        }
      } catch (giErr) {
        console.warn("[Regcard] guest-identity upsert failed (non-blocking)", giErr);
      }

      // 4) Remember consent locally for better UX across pages
      try {
        localStorage.setItem(LS(bookingCode), consent ? "1" : "0");
      } catch {
        // ignore localStorage failure
      }

      alert("Registration saved. Consent preference recorded.");
    } catch (e: any) {
      console.error("[Regcard] submit failed", e);
      const raw = String(e?.message || "");

      let friendly =
        "We couldn’t save your registration. Please try again or contact the front desk.";
      if (/not\s*found/i.test(raw) || /no booking/i.test(raw)) {
        friendly =
          "We couldn’t find this stay. Please check your booking link or contact the front desk.";
      }

      setErr(friendly);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Guest Registration</h1>
        <div className="text-sm text-gray-600">Stay code: {bookingCode || "—"}</div>
      </header>

      {identityLoading && (
        <div className="text-xs text-gray-500">
          Loading your saved details…
        </div>
      )}
      {identityError && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
          We couldn’t auto-fill your details this time. You can still continue
          by filling the form below.
        </div>
      )}

      {err && (
        <div className="card" style={{ borderColor: "#f59e0b" }}>
          ⚠️ {err}
        </div>
      )}

      <form
        onSubmit={submit}
        className="bg-white rounded shadow p-4 space-y-3"
      >
        <label className="text-sm">
          Full name
          <input
            className="input w-full mt-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className="text-sm">
          Phone
          <input
            className="input w-full mt-1"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>

        <label className="text-sm">
          ID number
          <input
            className="input w-full mt-1"
            value={idNo}
            onChange={(e) => setIdNo(e.target.value)}
          />
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
            I consent to an AI-generated summary of my stay being posted publicly
            under my first name. This helps the property improve and helps future
            guests. You can change this later during checkout.
          </span>
        </label>

        <div className="flex items-center gap-2">
          <button className="btn" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save & Continue"}
          </button>

          {pdf && (
            <a
              className="btn btn-light"
              href={pdf}
              target="_blank"
              rel="noreferrer"
            >
              View PDF
            </a>
          )}

          <Link
            className="link ml-auto"
            to={`/checkout/${encodeURIComponent(bookingCode || "")}`}
          >
            Go to Checkout →
          </Link>
        </div>
      </form>
    </main>
  );
}
