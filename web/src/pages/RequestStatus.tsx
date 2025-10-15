import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";

const API = import.meta.env.VITE_API_URL as string;

type TTicket = {
  id: string;
  service_key: string;
  room: string | null;
  status: "open" | "closed";
  created_at: string;
  closed_at: string | null;
  minutes_to_close: number | null;
  on_time: boolean | null;
};

export default function RequestStatus() {
  const { slug = "DEMO", id = "" } = useParams();
  const [t, setT] = useState<TTicket | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch(`${API}/ticket-get?id=${encodeURIComponent(id)}`);
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
      setT(j.ticket as TTicket);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  useEffect(() => {
    load();
    const i = setInterval(load, 5000); // poll every 5s
    return () => clearInterval(i);
  }, [id]);

  if (err) return <div className="p-6">Error: {err}</div>;
  if (!t) return <div className="p-6">Loading…</div>;

  return (
    <div className="max-w-xl mx-auto p-6">
      <Link to="/" className="text-sm text-sky-600">← Back to home</Link>
      <h1 className="text-2xl font-semibold mt-3">Request Status</h1>
      <div className="mt-4 rounded-xl border bg-white p-4">
        <div className="text-sm text-gray-500">Property</div>
        <div className="font-medium">{slug}</div>

        <div className="mt-3 text-sm text-gray-500">Request</div>
        <div className="font-medium">{t.service_key} {t.room ? `(Room ${t.room})` : ""}</div>

        <div className="mt-3 text-sm text-gray-500">Status</div>
        <div className={`inline-flex items-center gap-2 px-2 py-1 rounded-full text-sm
            ${t.status === "open" ? "bg-yellow-100 text-yellow-800" : "bg-green-100 text-green-800"}`}>
          {t.status === "open" ? "Open / In progress" : "Closed"}
        </div>

        {t.status === "closed" && (
          <div className="mt-3 text-sm">
            <div>Closed in <b>{t.minutes_to_close ?? "-"}</b> min</div>
            <div>On time: <b>{t.on_time ? "Yes" : "No"}</b></div>
          </div>
        )}

        <div className="mt-4 text-xs text-gray-500">ID: {t.id}</div>
      </div>
    </div>
  );
}
