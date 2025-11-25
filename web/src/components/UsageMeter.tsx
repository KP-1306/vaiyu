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
        // IMPORTANT: use existing "ai" function → /functions/v1/ai/usage
        const url = new URL(`${API}/ai/usage`, window.location.origin);
        if (hotelId) url.searchParams.set("hotel_id", hotelId);

        const res = await fetch(url.toString(), { signal: ac.signal });
        if (!res.ok) throw new Error(`Usage fetch failed (${res.status})`);

        const raw = await res.json();

        // Supported shapes:
        // 1) { used_tokens, budget_tokens, month_utc }
        // 2) { data: {...} }
        // 3) { summary: { used_tokens, budget_tokens, month_utc }, totals: { tokens: { total } } }
        const base = raw?.data ?? raw?.summary ?? raw;

        const fromSummary = Number(base?.used_tokens);
        const fromTotals = Number(
          raw?.totals?.tokens?.total ??
            (raw?.totals?.tokens?.input ?? 0) +
              (raw?.totals?.tokens?.output ?? 0),
        );

        const used_tokens =
          Number.isFinite(fromSummary) && fromSummary >= 0
            ? fromSummary
            : Number.isFinite(fromTotals) && fromTotals >= 0
            ? fromTotals
            : 0;

        const budget_tokens = Number(
          base?.budget_tokens ?? raw?.budget_tokens ?? 200_000,
        );

        const month_utc: string | undefined =
          base?.month_utc ?? raw?.month_utc ?? undefined;

        setData({ month_utc, used_tokens, budget_tokens });
        setErr(null);
      } catch (e: any) {
        console.warn("[UsageMeter] Falling back to demo usage:", e);
        setData({
          month_utc: undefined,
          used_tokens: 0,
          budget_tokens: 200_000,
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
