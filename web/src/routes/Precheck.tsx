import { useState } from "react";
import { API_URL } from "../lib/api";

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
};

export default function Precheck() {
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
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  function up<K extends keyof Form>(k: K, v: Form[K]) {
    setF((p) => ({ ...p, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");

    const payload = {
      hotel: "DEMO",
      booking: "DEMO",
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
      const r = await fetch(`${API_URL}/precheck`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        // Fallback: store locally so front desk can read it later
        const key = `precheck:DEMO:${Date.now()}`;
        localStorage.setItem(key, JSON.stringify(payload));
        setMsg(
          "Saved locally (API offline). Front desk can read this from the device."
        );
      } else {
        setMsg("Pre-check-in submitted. We’ll be ready when you arrive!");
      }
    } catch {
      const key = `precheck:DEMO:${Date.now()}`;
      localStorage.setItem(key, JSON.stringify(payload));
      setMsg(
        "Saved locally (network error). Front desk can read this from the device."
      );
    } finally {
      setBusy(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <main className="max-w-xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-3">Pre-check-in</h1>
      {msg && (
        <div className="mb-3 p-2 bg-emerald-50 border border-emerald-200 rounded text-emerald-700">
          {msg}
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
          />
        </label>

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
