// web/src/routes/OwnerRevenue.tsx — ADR & RevPAR (friendly, with charts)
// Three routes in one file for convenience:
//   <Route path="/owner/:slug/revenue" element={<OwnerRevenue />} />
//   <Route path="/owner/:slug/revenue/adr" element={<OwnerADR />} />
//   <Route path="/owner/:slug/revenue/revpar" element={<OwnerRevPAR />} />
// Uses Supabase views (recommended): owner_revenue_daily_v(hotel_id, day, rooms_available, rooms_sold, room_revenue)
//   ADR   = room_revenue / NULLIF(rooms_sold,0)
//   RevPAR= room_revenue / NULLIF(rooms_available,0)
// The UI compares selected range vs baseline (same weekday median across current window) and color-codes performance.
// Charts: recharts line charts (no custom colors hard-coded beyond defaults).

import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate, Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

// ------------------------------- Types --------------------------------------
type Hotel = { id: string; name: string; slug: string };
type Row = {
  day: string;
  rooms_available: number | null;
  rooms_sold: number | null;
  room_revenue: number | null;
};

// ------------------------------- Utils --------------------------------------
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
};
const formatINR = (n?: number | null) =>
  n == null || isNaN(n) ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`;

function badgeTone(t: "green" | "amber" | "red" | "grey") {
  return {
    green: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    amber: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    red: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
    grey: "bg-slate-50 text-slate-600 ring-1 ring-slate-200",
  }[t];
}

function adrTone(deltaPct: number | undefined): "green" | "amber" | "red" | "grey" {
  if (deltaPct == null || isNaN(deltaPct)) return "grey";
  if (deltaPct >= 5) return "green"; // ≥ +5% vs baseline
  if (deltaPct >= -5) return "amber"; // within ±5%
  return "red"; // worse than −5%
}
function revparTone(deltaPct: number | undefined): "green" | "amber" | "red" | "grey" {
  if (deltaPct == null || isNaN(deltaPct)) return "grey";
  if (deltaPct >= 0) return "green"; // ≥ baseline
  if (deltaPct >= -5) return "amber"; // within −5%
  return "red"; // worse than −5%
}

function weekdayKey(iso: string) {
  return new Date(iso).getUTCDay(); // 0-6
}

function median(nums: number[]): number | undefined {
  const a = nums
    .filter((n) => Number.isFinite(n))
    .slice()
    .sort((x, y) => x - y);
  if (a.length === 0) return undefined;
  const m = Math.floor(a.length / 2);
  return a.length % 2 === 1 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function computeADR(r: Row) {
  const sold = r.rooms_sold || 0;
  return sold > 0 ? (r.room_revenue || 0) / sold : undefined;
}
function computeRevPAR(r: Row) {
  const avail = r.rooms_available || 0;
  return avail > 0 ? (r.room_revenue || 0) / avail : undefined;
}

// ------------------------------- Shared header (currently unused, kept for future) ----
function SectionHeader({
  title,
  desc,
  action,
}: {
  title: string;
  desc?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {desc && <p className="text-sm text-muted-foreground">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

// ------------------------------- Index Page ---------------------------------
// Default export for /owner/:slug/revenue — simply sends owner to ADR for now.
export default function OwnerRevenue() {
  const { slug } = useParams<{ slug: string }>();

  if (!slug) {
    return (
      <main className="max-w-xl mx-auto p-6">
        <h1 className="text-xl font-semibold mb-2">Revenue</h1>
        <p className="text-sm text-muted-foreground">
          Choose a metric to view revenue performance.
        </p>
        <div className="mt-4 space-y-2">
          <div>
            <span className="font-semibold">ADR</span>{" "}
            <span className="text-sm text-muted-foreground">
              – Average daily rate for occupied rooms.
            </span>
          </div>
          <div>
            <span className="font-semibold">RevPAR</span>{" "}
            <span className="text-sm text-muted-foreground">
              – Revenue per available room.
            </span>
          </div>
        </div>
      </main>
    );
  }

  // For now, just redirect to ADR view to keep UX simple and avoid 404s.
  return <Navigate to={`/owner/${encodeURIComponent(slug)}/revenue/adr`} replace />;
}

// ------------------------------- ADR Page -----------------------------------
export function OwnerADR() {
  const { slug } = useParams();
  const nav = useNavigate();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [fromDay, setFromDay] = useState<string>(() =>
    isoDay(addDays(new Date(), -30))
  );
  const [toDay, setToDay] = useState<string>(() => isoDay(new Date()));
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!slug) {
        setLoading(false);
        return;
      }
      const { data: h } = await supabase
        .from("hotels")
        .select("id,name,slug")
        .eq("slug", slug)
        .maybeSingle();
      if (!alive) return;
      setHotel(h || null);
      const hotelId = h?.id;
      if (!hotelId) {
        setLoading(false);
        return;
      }
      // fetch revenue daily view
      const { data } = await supabase
        .from("owner_revenue_daily_v")
        .select("day,rooms_available,rooms_sold,room_revenue")
        .eq("hotel_id", hotelId)
        .gte("day", fromDay)
        .lte("day", toDay)
        .order("day", { ascending: true });
      if (!alive) return;
      setRows(data || []);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [slug, fromDay, toDay]);

  const series = useMemo(
    () =>
      rows.map((r) => ({
        day: r.day,
        adr: computeADR(r),
      })),
    [rows]
  );

  // Baseline: median ADR for the same weekday across current window (proxy for 8w baseline)
  const baselineByWd = useMemo(() => {
    const map: Record<number, number> = {};
    const grouped: Record<number, number[]> = {};
    for (const r of rows) {
      const wd = weekdayKey(r.day);
      const v = computeADR(r);
      if (v == null) continue;
      (grouped[wd] ||= []).push(v);
    }
    for (const wd in grouped) {
      const n = grouped[wd];
      const m = median(n);
      if (m != null) map[Number(wd)] = m;
    }
    return map;
  }, [rows]);

  const todayRow = series[series.length - 1];
  const todayBaseline = todayRow
    ? baselineByWd[weekdayKey(todayRow.day)]
    : undefined;
  const deltaPct =
    todayRow && todayRow.adr != null && todayBaseline != null
      ? ((todayRow.adr - todayBaseline) / todayBaseline) * 100
      : undefined;
  const tone = adrTone(deltaPct);

  return (
    <main className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-2xl font-semibold">ADR</div>
          <p className="text-sm text-muted-foreground">
            Average rate for occupied rooms. Aim to be above your baseline for
            the day of week.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-light" onClick={() => nav(-1)}>
            ← Back
          </button>
          <Link className="btn" to={`/owner/${slug}/pricing`}>
            Open pricing
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border bg-white p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              From
            </label>
            <input
              type="date"
              value={fromDay}
              onChange={(e) => setFromDay(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              To
            </label>
            <input
              type="date"
              value={toDay}
              onChange={(e) => setToDay(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            />
          </div>
        </div>
      </div>

      {/* KPI header */}
      <div className="rounded-xl border bg-white p-4 mb-4">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : series.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No revenue data for this period.
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs text-muted-foreground">Today</div>
              <div className="text-2xl font-semibold">
                {formatINR(todayRow?.adr as number | undefined)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">
                Baseline (same weekday)
              </div>
              <div className="text-lg">
                {formatINR(todayBaseline as number | undefined)}
              </div>
            </div>
            <div>
              <span
                className={`px-2 py-0.5 rounded-full text-xs ${badgeTone(
                  tone
                )}`}
              >
                {deltaPct == null
                  ? "N/A"
                  : `${deltaPct > 0 ? "+" : ""}${Math.round(
                      deltaPct
                    )}% vs baseline`}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="rounded-xl border bg-white p-4">
        <div className="flex items-start justify-between mb-2">
          <div>
            <h2 className="text-lg font-semibold">ADR over time</h2>
            <p className="text-sm text-muted-foreground">
              Track price trend across the selected dates. Use pricing to nudge
              soft days.
            </p>
          </div>
        </div>
        {series.length === 0 ? (
          <div className="text-sm text-muted-foreground">No data to chart.</div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={series}
                margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} minTickGap={28} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v) => formatINR(v as number)} />
                <Line
                  type="monotone"
                  dataKey="adr"
                  dot={false}
                  strokeWidth={2}
                />
                {todayBaseline != null && (
                  <ReferenceLine
                    y={todayBaseline}
                    strokeDasharray="4 4"
                    label={{
                      position: "insideTopRight",
                      value: "Baseline",
                    }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </main>
  );
}

// ------------------------------- RevPAR Page --------------------------------
export function OwnerRevPAR() {
  const { slug } = useParams();
  const nav = useNavigate();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [fromDay, setFromDay] = useState<string>(() =>
    isoDay(addDays(new Date(), -30))
  );
  const [toDay, setToDay] = useState<string>(() => isoDay(new Date()));
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!slug) {
        setLoading(false);
        return;
      }
      const { data: h } = await supabase
        .from("hotels")
        .select("id,name,slug")
        .eq("slug", slug)
        .maybeSingle();
      if (!alive) return;
      setHotel(h || null);
      const hotelId = h?.id;
      if (!hotelId) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("owner_revenue_daily_v")
        .select("day,rooms_available,rooms_sold,room_revenue")
        .eq("hotel_id", hotelId)
        .gte("day", fromDay)
        .lte("day", toDay)
        .order("day", { ascending: true });
      if (!alive) return;
      setRows(data || []);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [slug, fromDay, toDay]);

  const series = useMemo(
    () =>
      rows.map((r) => ({
        day: r.day,
        revpar: computeRevPAR(r),
      })),
    [rows]
  );

  // Baseline: median RevPAR for same weekday across current window (proxy for 8w baseline)
  const baselineByWd = useMemo(() => {
    const map: Record<number, number> = {};
    const grouped: Record<number, number[]> = {};
    for (const r of rows) {
      const wd = weekdayKey(r.day);
      const v = computeRevPAR(r);
      if (v == null) continue;
      (grouped[wd] ||= []).push(v);
    }
    for (const wd in grouped) {
      const m = median(grouped[wd]);
      if (m != null) map[Number(wd)] = m;
    }
    return map;
  }, [rows]);

  const todayRow = series[series.length - 1];
  const todayBaseline = todayRow
    ? baselineByWd[weekdayKey(todayRow.day)]
    : undefined;
  const deltaPct =
    todayRow && todayRow.revpar != null && todayBaseline != null
      ? ((todayRow.revpar - todayBaseline) / todayBaseline) * 100
      : undefined;
  const tone = revparTone(deltaPct);

  return (
    <main className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-2xl font-semibold">RevPAR</div>
          <p className="text-sm text-muted-foreground">
            Revenue per available room — the north star for yield. Higher than
            baseline is great.
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between mb-2">
        <div />
        <div className="flex items-center gap-2">
          <button className="btn btn-light" onClick={() => nav(-1)}>
            ← Back
          </button>
          <Link className="btn" to={`/owner/${slug}/pricing`}>
            Open pricing
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border bg-white p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              From
            </label>
            <input
              type="date"
              value={fromDay}
              onChange={(e) => setFromDay(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              To
            </label>
            <input
              type="date"
              value={toDay}
              onChange={(e) => setToDay(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            />
          </div>
        </div>
      </div>

      {/* KPI header */}
      <div className="rounded-xl border bg-white p-4 mb-4">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : series.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No revenue data for this period.
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs text-muted-foreground">Today</div>
              <div className="text-2xl font-semibold">
                {formatINR(todayRow?.revpar as number | undefined)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">
                Baseline (same weekday)
              </div>
              <div className="text-lg">
                {formatINR(todayBaseline as number | undefined)}
              </div>
            </div>
            <div>
              <span
                className={`px-2 py-0.5 rounded-full text-xs ${badgeTone(
                  tone
                )}`}
              >
                {deltaPct == null
                  ? "N/A"
                  : `${deltaPct > 0 ? "+" : ""}${Math.round(
                      deltaPct
                    )}% vs baseline`}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="rounded-xl border bg-white p-4">
        <div className="flex items-start justify-between mb-2">
          <div>
            <h2 className="text-lg font-semibold">RevPAR over time</h2>
            <p className="text-sm text-muted-foreground">
              Watch revenue per available room across the selected dates.
            </p>
          </div>
        </div>
        {series.length === 0 ? (
          <div className="text-sm text-muted-foreground">No data to chart.</div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={series}
                margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} minTickGap={28} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v) => formatINR(v as number)} />
                <Line
                  type="monotone"
                  dataKey="revpar"
                  dot={false}
                  strokeWidth={2}
                />
                {todayBaseline != null && (
                  <ReferenceLine
                    y={todayBaseline}
                    strokeDasharray="4 4"
                    label={{
                      position: "insideTopRight",
                      value: "Baseline",
                    }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </main>
  );
}
