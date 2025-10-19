import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

/** Shape we expect from the view (see SQL section below) */
type BillRow = {
  bill_id: string;
  stay_id: string | null;
  hotel_name: string | null;
  checkin_at: string | null;
  checkout_at: string | null;
  amount_paise: number | null;
  issued_at: string | null;
  download_url: string | null; // public URL of the PDF (optional)
};

const inr = (p: number | null | undefined) =>
  typeof p === "number" ? `₹${(p / 100).toFixed(2)}` : "—";

export default function Bills() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<BillRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Try to read from the view if available
        const { data, error } = await supabase
          .from("user_bills_overview")
          .select("*")
          .order("issued_at", { ascending: false });
        if (error) throw error;

        setRows((data || []) as BillRow[]);
      } catch (e: any) {
        // If the view doesn't exist yet, show a friendly message
        setError(
          e?.message?.includes("relation") || e?.message?.includes("does not exist")
            ? "Bills will appear here once we enable invoice exports on your account."
            : e?.message || "Could not load bills right now."
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <main className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your bills</h1>
        <Link to="/guest" className="btn btn-light">Back to dashboard</Link>
      </div>

      <p className="text-sm text-gray-600 mt-2">
        Download tax invoices and receipts from your stays.
      </p>

      {loading ? (
        <div className="min-h-[30vh] grid place-items-center">Loading…</div>
      ) : error ? (
        <div className="mt-4 rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <section className="mt-5 overflow-x-auto rounded-2xl border bg-white/90 shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600">
                <th className="px-4 py-3">Issued</th>
                <th className="px-4 py-3">Hotel</th>
                <th className="px-4 py-3">Stay dates</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.bill_id} className="border-t">
                  <td className="px-4 py-3">
                    {r.issued_at ? new Date(r.issued_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3">{r.hotel_name ?? "—"}</td>
                  <td className="px-4 py-3">
                    {r.checkin_at
                      ? new Date(r.checkin_at).toLocaleDateString()
                      : "—"}{" "}
                    –{" "}
                    {r.checkout_at
                      ? new Date(r.checkout_at).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3">{inr(r.amount_paise)}</td>
                  <td className="px-4 py-3 text-right">
                    {r.download_url ? (
                      <a className="btn" href={r.download_url} target="_blank" rel="noreferrer">
                        Download PDF
                      </a>
                    ) : (
                      <span className="text-xs text-gray-500">Not available</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <div className="mt-5 rounded-2xl border bg-white/90 shadow-sm p-8 text-center">
      <p className="text-gray-700">
        No bills yet. Your invoices will appear here after your next stay.
      </p>
      <div className="mt-3">
        <Link to="/stays" className="btn btn-light">View stays</Link>
      </div>
    </div>
  );
}
