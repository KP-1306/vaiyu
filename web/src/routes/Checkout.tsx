import { useState } from "react";
import { checkout } from "../lib/api";

type CheckoutResult = {
  ok?: boolean;
  invoice?: string;
  review_link?: string;
  // if your server returns extra info (e.g., pending review id), it will appear here
  [key: string]: any;
};

export default function Checkout() {
  const [bookingCode, setBookingCode] = useState("DEMO");
  const [autopost, setAutopost] = useState(true); // allow auto-post (respects property policy/consent)
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await checkout({ bookingCode, autopost });
      setResult(res as any);
    } catch (e: any) {
      setErr(e?.message || "Checkout failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">Checkout</h1>

      <form onSubmit={onSubmit} className="bg-white rounded shadow p-4 space-y-3">
        <label className="block">
          <div className="text-sm text-gray-600 mb-1">Booking code</div>
          <input
            className="input w-full"
            value={bookingCode}
            onChange={(e) => setBookingCode(e.target.value)}
            placeholder="ABC123 / DEMO"
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autopost}
            onChange={(e) => setAutopost(e.target.checked)}
          />
          Auto-publish an AI review based on the stay (subject to guest/property policy)
        </label>

        <button className="btn" type="submit" disabled={loading}>
          {loading ? "Processing…" : "Complete checkout"}
        </button>
      </form>

      {err && <div className="card" style={{ borderColor: "#f59e0b" }}>⚠️ {err}</div>}

      {result && (
        <section className="bg-white rounded shadow p-4 space-y-3">
          <div className="font-semibold">Done ✅</div>

          {result.invoice && (
            <div>
              Invoice:&nbsp;
              <a className="underline" href={result.invoice} target="_blank" rel="noreferrer">
                Download
              </a>
            </div>
          )}

          {result.review_link && (
            <div>
              Review:&nbsp;
              <a className="underline" href={result.review_link} target="_blank" rel="noreferrer">
                Open
              </a>
              <div className="text-xs text-gray-500 mt-1">
                If the property requires approval, your AI-draft may be pending until staff approves it.
              </div>
            </div>
          )}

          {!result.invoice && !result.review_link && (
            <div className="text-gray-600">Checkout completed.</div>
          )}
        </section>
      )}

      <div className="text-sm">
        <a href="/stay/DEMO/bill" className="underline">View bill</a>
      </div>
    </main>
  );
}
