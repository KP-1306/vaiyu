// web/src/components/ObservabilityCard.tsx
import { useEffect, useMemo, useState } from "react";

type Row24h = { hour_bucket: string; calls: number; avg_ms: number; err_4xx: number; err_5xx: number };
type TopFn = { fn: string; calls: number; avg_ms: number };

export default function ObservabilityCard() {
  const [series, setSeries] = useState<Row24h[] | null>(null);
  const [topFns, setTopFns] = useState<TopFn[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        setLoading(true);
        setErr(null);

        const [a, b] = await Promise.all([
          fetch("/api/obs/v_api_24h").then(x => x.ok ? x.json() : Promise.reject(x.status)),
          fetch("/api/obs/v_api_top_fns_24h").then(x => x.ok ? x.json() : Promise.reject(x.status)),
        ]);

        if (!cancel) {
          setSeries(Array.isArray(a) ? a : []);
          setTopFns(Array.isArray(b) ? b : []);
        }
      } catch {
        if (!cancel) setErr("Observability data unavailable.");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, []);

  const totals = useMemo(() => {
    if (!series?.length) return { calls: 0, avg: 0, errors: 0 };
    const calls = series.reduce((n, r) => n + (Number(r.calls) || 0), 0);
    const avg = Math.round(series.reduce((n, r) => n + (Number(r.avg_ms) || 0), 0) / series.length);
    const errors = series.reduce((n, r) => n + (Number(r.err_4xx) || 0) + (Number(r.err_5xx) || 0), 0);
    return { calls, avg, errors };
  }, [series]);

  return (
    <div className="p-4 rounded-2xl shadow bg-white">
      <div className="text-lg font-semibold">System Health (24h)</div>

      {loading ? (
        <div className="mt-3 space-y-2">
          <div className="h-4 rounded bg-gray-100 animate-pulse" />
          <div className="h-4 rounded bg-gray-100 animate-pulse" />
          <div className="h-4 rounded bg-gray-100 animate-pulse" />
        </div>
      ) : err ? (
        <div className="mt-3 text-sm text-amber-700">{err}</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mt-3">
            <Metric label="Calls (24h)" value={totals.calls.toLocaleString()} />
            <Metric label="Avg latency" value={`${totals.avg} ms`} />
            <Metric label="Errors (4xx/5xx)" value={totals.errors.toLocaleString()} />
          </div>

          <div className="mt-4">
            <div className="text-sm opacity-70 mb-1">Top Functions</div>
            <ul className="text-sm space-y-1">
              {topFns?.length
                ? topFns.map((r) => (
                    <li key={r.fn} className="flex justify-between">
                      <span className="truncate">{r.fn}</span>
                      <span className="shrink-0">{r.calls} · {r.avg_ms}ms</span>
                    </li>
                  ))
                : <li className="opacity-70">No data</li>}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl p-3 shadow-sm bg-gray-50">
      <div className="text-xs opacity-70">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}
