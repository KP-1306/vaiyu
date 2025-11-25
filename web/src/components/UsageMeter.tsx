// web/src/components/UsageMeter.tsx

import { useEffect, useState } from "react";
import { API } from "../lib/api";

type Usage = {
  month_utc?: string;
  used_tokens: number;
  budget_tokens: number;
};

export default function UsageMeter({ hotelId }: { hotelId?: string }) {
  const [data, setData] = useState<Usage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();

    (async () => {
      setLoading(true);
      try {
        // NOTE: call Supabase Edge Function slug "ai-usage"
        const u = new URL(`${API}/ai-usage`, window.location.origin);
        if (hotelId) u.searchParams.set("hotel_id", hotelId);

        const r = await fetch(u.toString(), { signal: ac.signal });
        if (!r.ok) {
          throw new Error(`Usage fetch failed (${r.status})`);
        }
        const j = await r.json();
        // Accept either {used_tokens, budget_tokens} or {data:{...}}
        const row = j?.data ?? j;
        setData({
          month_utc: row?.month_utc ?? undefined,
          used_tokens: Number(row?.used_tokens ?? 0),
          budget_tokens: Number(row?.budget_tokens ?? 200000),
        });
        setErr(null);
      } catch (e: any) {
        // graceful fallback demo values
        console.warn("[UsageMeter] Falling back to demo usage:", e);
        setData({
          month_utc: undefined,
          used_tokens: 0,
          budget_tokens: 200000,
        });
        setErr(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [hotelId]);

  const used = data?.used_tokens ?? 0;
  const budget = data?.budget_tokens || 1;
  const pct = Math.min(100, Math.round((used * 100) / budget));

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold">AI usage</div>
        {data?.month_utc && (
          <div className="text-xs text-gray-500">
            Month: {data.month_utc}
          </div>
        )}
      </div>

      <div
        className="h-2 w-full rounded bg-gray-200 overflow-hidden"
        aria-label="AI token usage"
      >
        <div
          className="h-full bg-blue-600"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>

      <div className="mt-2 text-sm text-gray-700">
        {loading
          ? "Loading…"
          : `${used.toLocaleString()} / ${budget.toLocaleString()} tokens (${pct}%)`}
      </div>

      {err && (
        <div className="mt-1 flex items-center gap-1 text-xs text-gray-500">
          <span aria-hidden="true">ⓘ</span>
          <span title={err}>
            Using demo AI usage numbers (usage API not connected yet).
          </span>
        </div>
      )}
    </section>
  );
}
