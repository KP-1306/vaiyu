import { useEffect, useState } from "react";
import { getFolio } from "../lib/api";

type FolioLine = { description: string; amount: number };
type Folio = { lines: FolioLine[]; total: number };

export default function Bill() {
  const [folio, setFolio] = useState<Folio | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const f = await getFolio();
        setFolio(f as any);
      } catch (e: any) {
        setErr(e?.message || "Failed to load folio");
      }
    })();
  }, []);

  return (
    <main className="max-w-xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">Your Bill</h1>

      {err && <div className="card" style={{ borderColor: "#f59e0b" }}>⚠️ {err}</div>}

      <ul className="bg-white rounded shadow divide-y">
        {(folio?.lines || []).map((l: FolioLine, i: number) => (
          <li key={i} className="p-3 flex justify-between">
            <span>{l.description}</span>
            <span>₹{l.amount}</span>
          </li>
        ))}
      </ul>

      <div className="text-right font-semibold">
        Total: ₹{folio?.total ?? 0}
      </div>
    </main>
  );
}
