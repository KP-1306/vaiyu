// web/src/routes/OwnerRevenue.tsx — ADR, RevPAR, and Revenue overview
// Three routes in one file for convenience:
//   <Route path="/owner/:slug/revenue" element={<OwnerRevenue />} />
//   <Route path="/owner/:slug/revenue/adr" element={<OwnerADR />} />
//   <Route path="/owner/:slug/revenue/revpar" element={<OwnerRevPAR />} />
//
// Overview uses backend endpoint via lib/api:
//   fetchOwnerRevenue(slug, range)
//     -> { hotelSlug, range, summary, series[] }
//
//   summary: { totalRevenue, roomRevenue, fnbRevenue, avgDailyRevenue }
//   series:  { day, totalRevenue, roomRevenue, fnbRevenue }
//
// ADR / RevPAR views continue to use Supabase view:
//   owner_revenue_daily_v(hotel_id, day, rooms_available, rooms_sold, room_revenue)
//
//  - Occupancy (%) = rooms_sold / NULLIF(rooms_available,0)
//  - ADR          = room_revenue / NULLIF(rooms_sold,0)
//  - RevPAR       = room_revenue / NULLIF(rooms_available,0)

import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
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
import {
  type OwnerRevenueResponse,
} from "../lib/api";

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

const formatPct = (n?: number | null) =>
  n == null || isNaN(n) ? "—" : `${n.toFixed(1)}%`;

function badgeTone(t: "green" | "amber" | "red" | "grey") {
  return {
    green: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30",
    amber: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
    red: "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30",
    grey: "bg-white/10 text-slate-300 ring-1 ring-white/15",
  }[t];
}

function adrTone(
  deltaPct: number | undefined
): "green" | "amber" | "red" | "grey" {
  if (deltaPct == null || isNaN(deltaPct)) return "grey";
  if (deltaPct >= 5) return "green"; // ≥ +5% vs baseline
  if (deltaPct >= -5) return "amber"; // within ±5%
  return "red"; // worse than −5%
}
function revparTone(
  deltaPct: number | undefined
): "green" | "amber" | "red" | "grey" {
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
function computeOccupancyPct(r: Row) {
  const avail = r.rooms_available || 0;
  const sold = r.rooms_sold || 0;
  return avail > 0 ? (sold / avail) * 100 : undefined;
}

function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });
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
        {desc && <p className="text-sm text-slate-400">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

// ============================================================================
// Overview Page (Revenue overview)
// Default export for /owner/:slug/revenue
// Reads the folio-backed owner_revenue_daily_v view (single source of truth).
// ============================================================================
export default function OwnerRevenue() {
  const { slug } = useParams<{ slug: string }>();
  const nav = useNavigate();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [range, setRange] = useState<"7d" | "30d" | "90d">("30d");
  const [data, setData] = useState<OwnerRevenueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!slug) {
        setError("Missing hotel identifier in URL.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // Hotel header (Supabase, same as earlier behaviour)
        const { data: h, error: hotelErr } = await supabase
          .from("hotels")
          .select("id,name,slug")
          .eq("slug", slug)
          .maybeSingle();

        if (!alive) return;

        if (hotelErr) {
          console.error(hotelErr);
        }
        setHotel(h || null);

        const emptySummary = {
          totalRevenue: 0,
          roomRevenue: 0,
          fnbRevenue: 0,
          avgDailyRevenue: 0,
        };

        if (!h?.id) {
          setData({ hotelSlug: slug, range, summary: emptySummary, series: [] });
          return;
        }

        // Revenue from the folio-backed view owner_revenue_daily_v — the single
        // source of truth (same view ADR/RevPAR read). No legacy backend.
        const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
        const to = new Date();
        const from = addDays(to, -(days - 1));
        const { data: rows, error: revErr } = await supabase
          .from("owner_revenue_daily_v")
          .select("day,room_revenue,fnb_revenue,total_revenue")
          .eq("hotel_id", h.id)
          .gte("day", isoDay(from))
          .lte("day", isoDay(to))
          .order("day", { ascending: true });

        if (!alive) return;
        if (revErr) throw revErr;

        const series = (rows ?? []).map((r: any) => ({
          day: r.day as string,
          totalRevenue: Number(r.total_revenue) || 0,
          roomRevenue: Number(r.room_revenue) || 0,
          fnbRevenue: Number(r.fnb_revenue) || 0,
        }));
        const sum = (k: "totalRevenue" | "roomRevenue" | "fnbRevenue") =>
          series.reduce((acc, p) => acc + (p[k] || 0), 0);
        const totalRevenue = sum("totalRevenue");

        setData({
          hotelSlug: slug,
          range,
          summary: {
            totalRevenue,
            roomRevenue: sum("roomRevenue"),
            fnbRevenue: sum("fnbRevenue"),
            avgDailyRevenue: days > 0 ? totalRevenue / days : 0,
          },
          series,
        });
      } catch (e: any) {
        if (!alive) return;
        console.error(e);
        setError(e?.message || "Failed to load revenue view.");
        setData(null);
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [slug, range]);

  const summary = data?.summary;
  const series = data?.series ?? [];

  const chartData = series.map((p) => ({
    day: p.day,
    totalRevenue: p.totalRevenue ?? 0,
    roomRevenue: p.roomRevenue ?? 0,
    fnbRevenue: p.fnbRevenue ?? 0,
  }));

  const ranges: { value: "7d" | "30d" | "90d"; label: string }[] = [
    { value: "7d", label: "7 days" },
    { value: "30d", label: "30 days" },
    { value: "90d", label: "90 days" },
  ];

  return (
    <main className="min-h-screen bg-[#0f1113] text-white">
     <div className="max-w-6xl mx-auto p-6 space-y-4">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xl font-semibold">Revenue overview</div>
          <p className="text-sm text-slate-400">
            {hotel
              ? `Control view for ${hotel.name}. Track room and F&B revenue over time.`
              : "Track room and F&B revenue over time for this property."}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {/* Range selector */}
          <div className="inline-flex items-center rounded-full bg-white/10 p-0.5 text-xs">
            {ranges.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setRange(r.value)}
                className={`px-3 py-1 rounded-full transition ${
                  range === r.value
                    ? "bg-white/15 text-white"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Deep links */}
          {slug && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-400">Deep dives:</span>
              <Link
                to={`/owner/${encodeURIComponent(slug)}/revenue/adr`}
                className="btn btn-light"
              >
                ADR
              </Link>
              <Link
                to={`/owner/${encodeURIComponent(slug)}/revenue/revpar`}
                className="btn btn-light"
              >
                RevPAR
              </Link>
              <Link
                to={`/owner/${encodeURIComponent(slug)}/occupancy`}
                className="btn btn-light"
              >
                Occupancy
              </Link>
              <Link
                to={`/owner/${encodeURIComponent(slug)}/pricing`}
                className="btn"
              >
                Open pricing
              </Link>
            </div>
          )}
        </div>
      </header>

      {/* Status / KPIs */}
      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        {loading ? (
          <div className="text-sm text-slate-400">Loading…</div>
        ) : error ? (
          <div className="text-sm text-rose-400">{error}</div>
        ) : !summary ? (
          <div className="text-sm text-slate-400">
            No revenue data available for this range.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Total revenue */}
            <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
              <div className="text-xs font-medium text-slate-300">
                Total revenue
              </div>
              <div className="mt-1 text-2xl font-semibold">
                {formatINR(summary.totalRevenue)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                Room + F&amp;B for the selected period.
              </div>
            </div>

            {/* Room revenue */}
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
              <div className="text-xs font-medium text-slate-300">
                Room revenue
              </div>
              <div className="mt-1 text-2xl font-semibold">
                {formatINR(summary.roomRevenue)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                Core occupancy-driven revenue.
              </div>
            </div>

            {/* F&B revenue */}
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
              <div className="text-xs font-medium text-slate-300">
                F&amp;B revenue
              </div>
              <div className="mt-1 text-2xl font-semibold">
                {formatINR(summary.fnbRevenue)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                Upsell from restaurant, room service, café, etc.
              </div>
            </div>

            {/* Avg daily revenue */}
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
              <div className="text-xs font-medium text-slate-300">
                Avg revenue / day
              </div>
              <div className="mt-1 text-2xl font-semibold">
                {formatINR(summary.avgDailyRevenue)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                Simple daily average for this range.
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Charts */}
      {!loading && !error && chartData.length > 0 && (
        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h2 className="text-sm font-semibold">
                Revenue breakdown over time
              </h2>
              <p className="text-xs text-slate-400">
                Total vs Room vs F&amp;B revenue for the selected window.
              </p>
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 12, fill: "#94a3b8" }}
                  minTickGap={28}
                  tickFormatter={formatShortDate}
                />
                <YAxis tick={{ fontSize: 12, fill: "#94a3b8" }} />
                <Tooltip
                  formatter={(v) => formatINR(v as number)}
                  labelFormatter={(v) => `Day: ${formatShortDate(v as string)}`}
                  contentStyle={{ background: "#16181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#fff" }}
                  labelStyle={{ color: "#94a3b8" }}
                />
                <Line
                  type="monotone"
                  dataKey="totalRevenue"
                  name="Total"
                  dot={false}
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="roomRevenue"
                  name="Room"
                  dot={false}
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="fnbRevenue"
                  name="F&B"
                  dot={false}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
     </div>
    </main>
  );
}

// ============================================================================
// ADR Page (unchanged logic, Supabase-based)
// ============================================================================
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
    <main className="min-h-screen bg-[#0f1113] text-white">
     <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-2xl font-semibold">ADR</div>
          <p className="text-sm text-slate-400">
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
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              From
            </label>
            <input
              type="date"
              value={fromDay}
              onChange={(e) => setFromDay(e.target.value)}
              className="border border-white/10 bg-white/5 text-white rounded px-2 py-1 text-sm [color-scheme:dark]"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              To
            </label>
            <input
              type="date"
              value={toDay}
              onChange={(e) => setToDay(e.target.value)}
              className="border border-white/10 bg-white/5 text-white rounded px-2 py-1 text-sm [color-scheme:dark]"
            />
          </div>
        </div>
      </div>

      {/* KPI header */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-4">
        {loading ? (
          <div className="text-sm text-slate-400">Loading…</div>
        ) : series.length === 0 ? (
          <div className="text-sm text-slate-400">
            No revenue data for this period.
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs text-slate-400">Today</div>
              <div className="text-2xl font-semibold">
                {formatINR(todayRow?.adr as number | undefined)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">
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
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-start justify-between mb-2">
          <div>
            <h2 className="text-lg font-semibold">ADR over time</h2>
            <p className="text-sm text-slate-400">
              Track price trend across the selected dates. Use pricing to nudge
              soft days.
            </p>
          </div>
        </div>
        {series.length === 0 ? (
          <div className="text-sm text-slate-400">No data to chart.</div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={series}
                margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: "#94a3b8" }} minTickGap={28} />
                <YAxis tick={{ fontSize: 12, fill: "#94a3b8" }} />
                <Tooltip formatter={(v) => formatINR(v as number)} contentStyle={{ background: "#16181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#fff" }} labelStyle={{ color: "#94a3b8" }} />
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
     </div>
    </main>
  );
}

// ============================================================================
// RevPAR Page (unchanged logic, Supabase-based)
// ============================================================================
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
    <main className="min-h-screen bg-[#0f1113] text-white">
     <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-2xl font-semibold">RevPAR</div>
          <p className="text-sm text-slate-400">
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
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              From
            </label>
            <input
              type="date"
              value={fromDay}
              onChange={(e) => setFromDay(e.target.value)}
              className="border border-white/10 bg-white/5 text-white rounded px-2 py-1 text-sm [color-scheme:dark]"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              To
            </label>
            <input
              type="date"
              value={toDay}
              onChange={(e) => setToDay(e.target.value)}
              className="border border-white/10 bg-white/5 text-white rounded px-2 py-1 text-sm [color-scheme:dark]"
            />
          </div>
        </div>
      </div>

      {/* KPI header */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-4">
        {loading ? (
          <div className="text-sm text-slate-400">Loading…</div>
        ) : series.length === 0 ? (
          <div className="text-sm text-slate-400">
            No revenue data for this period.
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs text-slate-400">Today</div>
              <div className="text-2xl font-semibold">
                {formatINR(todayRow?.revpar as number | undefined)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">
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
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-start justify-between mb-2">
          <div>
            <h2 className="text-lg font-semibold">RevPAR over time</h2>
            <p className="text-sm text-slate-400">
              Watch revenue per available room across the selected dates.
            </p>
          </div>
        </div>
        {series.length === 0 ? (
          <div className="text-sm text-slate-400">No data to chart.</div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={series}
                margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: "#94a3b8" }} minTickGap={28} />
                <YAxis tick={{ fontSize: 12, fill: "#94a3b8" }} />
                <Tooltip formatter={(v) => formatINR(v as number)} contentStyle={{ background: "#16181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#fff" }} labelStyle={{ color: "#94a3b8" }} />
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
     </div>
    </main>
  );
}
