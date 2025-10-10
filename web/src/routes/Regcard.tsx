import { useState } from "react";
import { regcard } from "../lib/api";

type State = {
  bookingCode: string;
  guestName: string;
  email: string;
};
type Result = { ok?: boolean; pdf?: string; [k: string]: any };

export default function Regcard() {
  const [f, setF] = useState<State>({
    bookingCode: "DEMO",  // demo code
    guestName: "",
    email: "",
  });
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function up<K extends keyof State>(k: K, v: State[K]) {
    setF((p) => ({ ...p, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      // Backend just needs enough info to generate a PDF reg card.
      const result = await regcard({
        booking: f.bookingCode,
        guest: { name: f.guestName, email: f.email },
      });
      setRes(result as any);
    } catch (e: any) {
      setErr(e?.message || "Failed to create registration card");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">Registration Card</h1>

      {err && <div className="card" style={{ borderColor: "#f59e0b" }}>⚠️ {err}</div>}

      <form onSubmit={submit} className="bg-white rounded shadow p-4 space-y-3">
        <label className="block text-sm">
          Booking code
          <input
            className="input w-full mt-1"
            value={f.bookingCode}
            onChange={(e) => up("bookingCode", e.target.value)}
            placeholder="ABC123 / DEMO"
            required
          />
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-sm">
            Guest name
            <input
              className="input w-full mt-1"
              value={f.guestName}
              onChange={(e) => up("guestName", e.target.value)}
              placeholder="Optional"
            />
          </label>
          <label className="text-sm">
            Email
            <input
              type="email"
              className="input w-full mt-1"
              value={f.email}
              onChange={(e) => up("email", e.target.value)}
              placeholder="Optional"
            />
          </label>
        </div>

        <button className="btn" disabled={busy}>
          {busy ? "Generating…" : "Generate reg card"}
        </button>
      </form>

      {res?.pdf && (
        <section className="bg-white rounded shadow p-4">
          <div className="font-semibold mb-1">Ready ✅</div>
          <a
            className="underline"
            href={res.pdf}
            target="_blank"
            rel="noreferrer"
          >
            Download PDF
          </a>
        </section>
      )}
    </main>
  );
}
