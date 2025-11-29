// web/src/routes/Precheck.tsx
//
// Guest pre check-in form.
//
// - Reads booking code from route (:code) or query (?code=)
// - Auto-prefills from central Guest Identity (if available)
// - Optional referral (VAiyu Account ID / phone / email)
// - Sends a flexible payload to /precheck so BE can accept multiple shapes
// - Best-effort upsert to guest-identity-upsert so future forms can auto-fill

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import BackHome from "../components/BackHome";
import {
  precheck,
  referralApply,
  // we cast to any when calling so slight type mismatches won't break build
  upsertGuestIdentity as upsertGuestIdentityApi,
} from "../lib/api";
import { useGuestIdentity } from "../hooks/useGuestIdentity";

const ID_TYPES = [
  "Aadhaar",
  "Driving Licence",
  "Passport",
  "Voter ID",
  "PAN",
  "Other",
];

type Form = {
  guestName: string;
  phone: string;
  email: string;
  idType: string;
  idNumber: string;
  arrivalDate: string;
  arrivalTime: string;
  paxAdults: number;
  paxKids: number;
  notes: string;

  // Referral – Account ID or registered phone/email of referrer
  referral: string;
  referralType: "auto"; // we auto-detect email/phone/accountId
};

function useInitialBookingCode() {
  const { code: codeParam } = useParams<{ code?: string }>();
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const queryCode = search.get("code");

  const raw = (codeParam || queryCode || "").trim();
  return raw ? raw.toUpperCase() : "";
}

function buildReferralPayload(input: string) {
  const v = input.trim();
  if (!v) return null;

  // Rudimentary detection: email vs phone vs accountId
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { email: v };
  if (/^\+?\d{10,15}$/.test(v)) return { phone: v };

  // Fallback: treat as VAiyu account ID
  return { accountId: v };
}

export default function Precheck() {
  const bookingCode = useInitialBookingCode();
  const bookingLabel = bookingCode || "DEMO";

  // Guest Identity: we cast to any so we don't depend on exact hook typing
  const gi: any = (useGuestIdentity as any)({ bookingCode });
  const identity = gi?.identity;
  const identityLoading = gi?.loading;
  const identityError = gi?.error;

  const [f, setF] = useState<Form>({
    guestName: "",
    phone: "",
    email: "",
    idType: ID_TYPES[0], // default Aadhaar
    idNumber: "",
    arrivalDate: "",
    arrivalTime: "",
    paxAdults: 2,
    paxKids: 0,
    notes: "",
    referral: "",
    referralType: "auto",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const [err, setErr] = useState<string>("");

  function up<K extends keyof Form>(k: K, v: Form[K]) {
    setF((p) => ({ ...p, [k]: v }));
  }

  // Auto-fill from central Guest Identity once it loads
  useEffect(() => {
    if (!identity) return;

    setF((prev) => ({
      ...prev,
      guestName:
        prev.guestName ||
        identity.name ||
        identity.full_name ||
        identity.display_name ||
        "",
      phone:
        prev.phone ||
        identity.phone ||
        identity.primary_phone ||
        identity.mobile ||
        "",
      email:
        prev.email ||
        identity.email ||
        identity.primary_email ||
        identity.secondary_email ||
        "",
      idType:
        prev.idType ||
        identity.id_type ||
        identity.idType ||
        ID_TYPES[0],
      idNumber:
        prev.idNumber ||
        identity.id_number ||
        identity.idNumber ||
        "",
    }));
  }, [identity]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    setErr("");

    const effectiveCode = bookingCode || "DEMO";

    // Payload mirrors your previous structure but is flexible enough
    // for the backend to evolve:
    const payload: any = {
      hotel: "DEMO", // optional; backend can ignore or map from booking
      booking: effectiveCode,
      room_pref: "",
      guest: {
        name: f.guestName,
        phone: f.phone,
        email: f.email || null,
        id_type: f.idType,
        id_number: f.idNumber,
      },
      arrival: {
        date: f.arrivalDate || null,
        time: f.arrivalTime || null,
        adults: f.paxAdults,
        kids: f.paxKids,
      },
      notes: f.notes || null,
    };

    // Optionally attach referral info into payload as a hint (doesn't
    // replace the dedicated /referrals/apply call).
    const refPayload = buildReferralPayload(f.referral);
    if (refPayload) {
      payload.referral = refPayload;
    }

    try {
      // 1) If referral present, apply it against this booking
      if (refPayload) {
        await referralApply(effectiveCode, refPayload);
      }

      // 2) Best-effort: upsert Guest Identity so future forms can auto-fill
      try {
        if (typeof upsertGuestIdentityApi === "function") {
          await (upsertGuestIdentityApi as any)({
            // keep it very forgiving; BE can map what it needs
            booking_code: effectiveCode,
            name: f.guestName,
            phone: f.phone,
            email: f.email || null,
            id_type: f.idType,
            id_number: f.idNumber || null,
          });
        }
      } catch (giErr) {
        // We intentionally swallow Guest Identity errors so precheck
        // itself is not blocked.
        console.warn("[Precheck] guest-identity upsert failed", giErr);
      }

      // 3) Normal precheck flow
      await precheck(payload);

      setMsg("Pre-check-in submitted. We’ll be ready when you arrive!");
      setErr("");
    } catch (e: any) {
      // Fallback: store locally so the desk can read it later
      const key = `precheck:${effectiveCode}:${Date.now()}`;
      try {
        localStorage.setItem(key, JSON.stringify(payload));
        setMsg(
          "Saved locally (offline). Front desk can read this from this device if needed."
        );
      } catch {
        // ignore localStorage failures
        setMsg(
          "We couldn’t reach the server. Please share your details with the front desk on arrival."
        );
      }
      setErr(e?.message || "Something went wrong while submitting pre-check-in.");
    } finally {
      setBusy(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <main className="max-w-xl mx-auto p-4">
      <BackHome />

      <h1 className="text-xl font-semibold mb-1">Pre-check-in</h1>
      <div className="text-sm text-gray-600 mb-2">
        Booking code: <b>{bookingLabel}</b>
      </div>

      {identityLoading && (
        <div className="mb-3 text-xs text-gray-500">
          Loading your saved details…
        </div>
      )}
      {identityError && (
        <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded text-amber-800 text-xs">
          We couldn’t auto-fill your details this time. You can still continue.
        </div>
      )}

      {msg && (
        <div
          className="mb-3 p-2 bg-emerald-50 border border-emerald-200 rounded text-emerald-700"
          role="status"
        >
          {msg}
        </div>
      )}
      {err && (
        <div
          className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded text-amber-800"
          role="alert"
        >
          {err}
        </div>
      )}

      <form
        onSubmit={submit}
        className="space-y-3 bg-white p-3 rounded shadow"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-sm">
            Guest name
            <input
              required
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.guestName}
              onChange={(e) => up("guestName", e.target.value)}
            />
          </label>

          <label className="text-sm">
            Phone
            <input
              required
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.phone}
              onChange={(e) => up("phone", e.target.value)}
            />
          </label>

          <label className="text-sm">
            Email
            <input
              type="email"
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.email}
              onChange={(e) => up("email", e.target.value)}
            />
          </label>

          <label className="text-sm">
            ID type
            <select
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.idType}
              onChange={(e) => up("idType", e.target.value)}
            >
              {ID_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm md:col-span-2">
            ID number
            <input
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.idNumber}
              onChange={(e) => up("idNumber", e.target.value)}
            />
          </label>

          <label className="text-sm">
            Arrival date
            <input
              type="date"
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.arrivalDate}
              onChange={(e) => up("arrivalDate", e.target.value)}
            />
          </label>

          <label className="text-sm">
            Arrival time
            <input
              type="time"
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.arrivalTime}
              onChange={(e) => up("arrivalTime", e.target.value)}
            />
          </label>

          <label className="text-sm">
            Adults
            <input
              type="number"
              min={1}
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.paxAdults}
              onChange={(e) =>
                up("paxAdults", Number(e.target.value) || 1)
              }
            />
          </label>

          <label className="text-sm">
            Kids
            <input
              type="number"
              min={0}
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.paxKids}
              onChange={(e) =>
                up("paxKids", Number(e.target.value) || 0)
              }
            />
          </label>
        </div>

        <label className="text-sm">
          Special requests / notes
          <textarea
            className="mt-1 border rounded w-full px-2 py-1"
            rows={3}
            value={f.notes}
            onChange={(e) => up("notes", e.target.value)}
            placeholder="Anything we should know? (Late arrival, accessibility, etc.)"
          />
        </label>

        {/* Referral (optional) */}
        <div className="border rounded p-3 bg-gray-50">
          <div className="text-[11px] text-gray-500">
            Referral (optional)
          </div>
          <label className="text-sm block">
            VAiyu Account ID / Registered Phone / Email
            <input
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.referral}
              onChange={(e) => up("referral", e.target.value)}
              placeholder="e.g. +9198xxxxxxx or name@domain.com or VAID1234"
            />
          </label>
          <div className="text-[11px] text-gray-500 mt-1">
            Credits are property-scoped; they’re issued to your referrer
            after your checkout.
          </div>
        </div>

        <div className="pt-1">
          <button
            disabled={busy}
            className="px-4 py-2 rounded bg-sky-600 text-white disabled:opacity-60"
          >
            {busy ? "Submitting…" : "Submit"}
          </button>
        </div>
      </form>
    </main>
  );
}
