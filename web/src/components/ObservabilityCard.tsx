// web/src/components/ObservabilityCard.tsx
import { useEffect, useMemo, useState } from "react";
import { Activity } from "lucide-react";
import { supabase } from "../lib/supabase";

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

        // The obs endpoint is platform-admin-gated — send the caller's Supabase JWT.
        const { data: { session } } = await supabase.auth.getSession();
        const headers: HeadersInit = session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {};

        const [a, b] = await Promise.all([
          fetch("/api/obs/v_api_24h", { headers }).then(x => x.ok ? x.json() : Promise.reject(x.status)),
          fetch("/api/obs/v_api_top_fns_24h", { headers }).then(x => x.ok ? x.json() : Promise.reject(x.status)),
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
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="rounded-lg bg-sky-500/10 p-1.5 ring-1 ring-sky-500/20">
          <Activity className="h-4 w-4 text-sky-300" />
        </div>
        <span className="text-xs font-semibold uppercase tracking-wider text-white/60">
          System Health · 24h
        </span>
      </div>

      {loading ? (
        <div className="mt-3 space-y-2">
          <div className="h-4 rounded bg-white/[0.06] animate-pulse" />
          <div className="h-4 rounded bg-white/[0.06] animate-pulse" />
          <div className="h-4 rounded bg-white/[0.06] animate-pulse" />
        </div>
      ) : err ? (
        <div className="mt-3 text-sm text-amber-300">{err}</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Metric label="Calls (24h)" value={totals.calls.toLocaleString()} />
            <Metric label="Avg latency" value={`${totals.avg} ms`} />
            <Metric label="Errors (4xx/5xx)" value={totals.errors.toLocaleString()} />
          </div>

          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wider text-white/50 mb-1.5">Top Functions</div>
            <ul className="text-sm space-y-1">
              {topFns?.length
                ? topFns.map((r) => (
                    <li key={r.fn} className="flex justify-between text-white/80">
                      <span className="truncate">{r.fn}</span>
                      <span className="shrink-0 tabular-nums text-white/60">{r.calls} · {r.avg_ms}ms</span>
                    </li>
                  ))
                : <li className="text-white/40">No data</li>}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="text-[11px] text-white/50">{label}</div>
      <div className="text-lg font-semibold text-white tabular-nums">{value}</div>
    </div>
  );
}
