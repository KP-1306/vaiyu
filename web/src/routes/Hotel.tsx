import { useEffect, useState } from "react";
import { API_URL } from "../lib/api";

type Hotel = {
  id: string;
  name: string;
  slug?: string;
  city?: string;
  address?: string;
  amenities?: string[];
  phone?: string;
};

export default function Hotel() {
  const [h, setH] = useState<Hotel | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const r = await fetch(`${API_URL}/hotels`);
        const j = await r.json();
        // try to find DEMO; else pick first
        const item =
          (j.items || []).find((x: any) => x.slug === "DEMO") ||
          (j.items || [])[0] ||
          null;
        setH(item);
        setErr(null);
      } catch (e: any) {
        setErr(e?.message || "Failed to load hotel");
      }
    }
    load();
  }, []);

  return (
    <main className="max-w-3xl mx-auto p-4">
      {!h ? (
        <div className="text-gray-500">{err || "Loading hotel…"}</div>
      ) : (
        <div className="space-y-4">
          <header className="bg-white rounded shadow p-4">
            <div className="text-xs text-gray-500">Property microsite</div>
            <h1 className="text-2xl font-semibold">{h.name || "Hotel"}</h1>
            <div className="text-sm text-gray-600">
              {h.address || h.city || "Address"} • {h.phone || ""}
            </div>
          </header>

          <section className="bg-white rounded shadow p-4">
            <h2 className="font-semibold mb-2">Amenities</h2>
            <ul className="list-disc pl-6 text-sm">
              {(h.amenities && h.amenities.length
                ? h.amenities
                : ["Free Wi-Fi", "24x7 Front Desk", "Room Service (7am–11pm)"]
              ).map((a: string, i: number) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </section>

          <section className="bg-white rounded shadow p-4">
            <h2 className="font-semibold mb-2">Why stay with us</h2>
            <p className="text-sm text-gray-700">
              Fast check-in, Bharat-simple service app, and transparent billing.
              Your comfort is our priority.
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
