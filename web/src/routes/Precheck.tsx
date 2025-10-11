import { useState } from "react";
import { useParams } from "react-router-dom";
import { precheck, referralApply } from "../lib/api";

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

  referral: string;         // NEW: Account ID or registered phone/email of referrer
  referralType: "auto";     // we auto-detect: email/phone/else accountId
};

export default function Precheck() {
  const { code: bookingCodeParam = "" } = useParams();
  const [f, setF] = useState<Form>({
    guestName: "",
    phone: "",
    email: "",
    idType: "Aadhar",
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

  function buildReferralPayload(input: string) {
    const v = input.trim();
    if (!v) return null;
    // rudimentary detection
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { email: v };
    if (/^\+?\d{10,15}$/.test(v)) return { phone: v };
    return { accountId: v };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    setErr("");

    const bookingCode = bookingCodeParam || "DEMO";

    // Payload mirrors your previous structure
    const payload = {
      hotel: "DEMO",
      booking: bookingCode,
      room_pref: "",
      guest: {
        name: f.guestName,
        phone: f.phone,
        email: f.email,
        id_type: f.idType,
        id_number: f.idNumber,
      },
      arrival: {
        date: f.arrivalDate,
        time: f.arrivalTime,
        adults: f.paxAdults,
        kids: f.paxKids,
      },
      notes: f.notes,
    };

    try {
      // 1) If referral present, apply it against this booking
      const refPayload = buildReferralPayload(f.referral);
      if (refPayload) {
        await referralApply(bookingCode, refPayload);
      }

      // 2) Continue normal precheck
      await precheck(payload);

      setMsg("Pre-check-in submitted. We’ll be ready when you arrive!");
    } catch (e: any) {
      // Fallback: store locally so the desk can read it later
      const key = `precheck:${bookingCode}:${Date.now()}`;
      localStorage.setItem(key, JSON.stringify(payload));
      setMsg("Saved locally (offline). Front desk can read this from the device.");
      setErr(e?.message || "");
    } finally {
      setBusy(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <main className="max-w-xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-1">Pre-check-in</h1>
      <div className="text-sm text-gray-600 mb-3">Booking code: <b>{bookingCodeParam || 'DEMO'}</b></div>

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

      <form onSubmit={submit} className="space-y-3 bg-white p-3 rounded shadow">
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
              <option>Aadhar</option>
              <option>PAN</option>
              <option>Passport</option>
              <option>Driving License</option>
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
              onChange={(e) => up("paxAdults", Number(e.target.value))}
            />
          </label>

          <label className="text-sm">
            Kids
            <input
              type="number"
              min={0}
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.paxKids}
              onChange={(e) => up("paxKids", Number(e.target.value))}
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

        {/* NEW: Referral (optional) */}
        <div className="border rounded p-3 bg-gray-50">
          <div className="text-[11px] text-gray-500">Referral (optional)</div>
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
            Credits are property-scoped; they’re issued to your referrer after your checkout.
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
