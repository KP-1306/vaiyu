// web/src/routes/OwnerRevenue.tsx — ADR, RevPAR, and Occupancy/Revenue overview
// Three routes in one file for convenience:
//   <Route path="/owner/:slug/revenue" element={<OwnerRevenue />} />
//   <Route path="/owner/:slug/revenue/adr" element={<OwnerADR />} />
//   <Route path="/owner/:slug/revenue/revpar" element={<OwnerRevPAR />} />
//
// Uses Supabase view (recommended):
//   owner_revenue_daily_v(hotel_id, day, rooms_available, rooms_sold, room_revenue)
//
//  - Occupancy (%) = rooms_sold / NULLIF(rooms_available,0)
//  - ADR          = room_revenue / NULLIF(rooms_sold,0)
//  - RevPAR       = room_revenue / NULLIF(rooms_available,0)
//
// The default /revenue page now shows:
//  - Summary tiles: Avg Occupancy, ADR, RevPAR, Total Room Revenue
//  - Two line charts: Occupancy over time, Revenue over time
//  - Quick links to ADR and RevPAR detailed views.

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
function computeOccupancyPct(r: Row) {
  const avail = r.rooms_available || 0;
  const sold = r.rooms_sold || 0;
  return avail > 0 ? (sold / avail) * 100 : undefined;
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

// ------------------------------- Overview Page (Occupancy + Revenue) --------
// Default export for /owner/:slug/revenue
export default function OwnerRevenue() {
  const { slug } = useParams<{ slug: string }>();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [fromDay, setFromDay] = useState<string>(() =>
    isoDay(addDays(new Date(), -30))
  );
  const [toDay, setToDay] = useState<string>(() => isoDay(new Date()));
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load hotel + daily view
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!slug) {
        setError("Missing hotel identifier in URL.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);

      const { data: h, error: hotelErr } = await supabase
        .from("hotels")
        .select("id,name,slug")
        .eq("slug", slug)
        .maybeSingle();

      if (!alive) return;

      if (hotelErr) {
        console.error(hotelErr);
        setError("Failed to load hotel details.");
        setHotel(null);
        setRows([]);
        setLoading(false);
        return;
      }

      setHotel(h || null);
      const hotelId = h?.id;
      if (!hotelId) {
        setError("Hotel not found for this slug.");
        setRows([]);
        setLoading(false);
        return;
      }

      const { data, error: revErr } = await supabase
        .from("owner_revenue_daily_v")
        .select("day,rooms_available,rooms_sold,room_revenue")
        .eq("hotel_id", hotelId)
        .gte("day", fromDay)
        .lte("day", toDay)
        .order("day", { ascending: true });

      if (!alive) return;

      if (revErr) {
        console.error(revErr);
        setError("Failed to load occupancy & revenue view.");
        setRows([]);
      } else {
        setRows(data || []);
      }

      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [slug, fromDay, toDay]);

  // Summary stats across the selected range
  const summary = useMemo(() => {
    if (!rows.length) {
      return {
        totalRevenue: 0,
        totalSold: 0,
        totalAvail: 0,
        avgOccupancy: undefined as number | undefined,
        adr: undefined as number | undefined,
        revpar: undefined as number | undefined,
        daysCount: 0,
      };
    }
    let totalRevenue = 0;
    let totalSold = 0;
    let totalAvail = 0;

    for (const r of rows) {
      const rev = r.room_revenue || 0;
      const sold = r.rooms_sold || 0;
      const avail = r.rooms_available || 0;
      totalRevenue += rev;
      totalSold += sold;
      totalAvail += avail;
    }

    const avgOccupancy =
      totalAvail > 0 ? (totalSold / totalAvail) * 100 : undefined;
    const adr =
      totalSold > 0 ? totalRevenue / totalSold : undefined;
    const revpar =
      totalAvail > 0 ? totalRevenue / totalAvail : undefined;

    return {
      totalRevenue,
      totalSold,
      totalAvail,
      avgOccupancy,
      adr,
      revpar,
      daysCount: rows.length,
    };
  }, [rows]);

  // Time series for charts
  const occupancySeries = useMemo(
    () =>
      rows.map((r) => ({
        day: r.day,
        occupancy: computeOccupancyPct(r),
      })),
    [rows]
  );

  const revenueSeries = useMemo(
    () =>
      rows.map((r) => ({
        day: r.day,
        roomRevenue: r.room_revenue || 0,
      })),
    [rows]
  );

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xl font-semibold">Revenue &amp; Occupancy</div>
          <p className="text-sm text-muted-foreground">
            {hotel
              ? `Control view for ${hotel.name}. Track occupancy, ADR, RevPAR and room revenue for the selected period.`
              : "Track occupancy, ADR, RevPAR and room revenue for the selected period."}
          </p>
        </div>
        {slug && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Deep dives:</span>
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
              to={`/owner/${encodeURIComponent(slug)}/pricing`}
              className="btn"
            >
              Open pricing
            </Link>
          </div>
        )}
      </header>

      {/* Filters */}
      <section className="rounded-xl border bg-white p-4">
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
          {summary.daysCount > 0 && (
            <p className="text-xs text-muted-foreground">
              Showing {summary.daysCount} day
              {summary.daysCount === 1 ? "" : "s"} of data.
            </p>
          )}
        </div>
      </section>

      {/* Status / summary tiles */}
      <section className="rounded-xl border bg-white p-4">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : error ? (
          <div className="text-sm text-red-500">{error}</div>
        ) : !rows.length ? (
          <div className="text-sm text-muted-foreground">
            No revenue/occupancy data for this period.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Avg Occupancy */}
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
              <div className="text-xs font-medium text-slate-600">
                Avg occupancy
              </div>
              <div className="mt-1 text-2xl font-semibold">
                {formatPct(summary.avgOccupancy)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                Based on rooms sold vs rooms available across the range.
              </div>
            </div>

            {/* ADR */}
            <div className="rounded-lg border border-slate-100 bg-white px-4 py-3">
              <div className="text-xs font-medium text-slate-600">ADR</div>
              <div className="mt-1 text-2xl font-semibold">
                {formatINR(summary.adr)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                Average rate for occupied rooms.
              </div>
            </div>

            {/* RevPAR */}
            <div className="rounded-lg border border-slate-100 bg-white px-4 py-3">
              <div className="text-xs font-medium text-slate-600">RevPAR</div>
              <div className="mt-1 text-2xl font-semibold">
                {formatINR(summary.revpar)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                Revenue per available room.
              </div>
            </div>

            {/* Total room revenue */}
            <div className="rounded-lg border border-slate-100 bg-white px-4 py-3">
              <div className="text-xs font-medium text-slate-600">
                Total room revenue
              </div>
              <div className="mt-1 text-2xl font-semibold">
                {formatINR(summary.totalRevenue)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                Across all completed nights in this range.
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Charts */}
      {!loading && !error && rows.length > 0 && (
        <section className="grid gap-4 lg:grid-cols-2">
          {/* Occupancy chart */}
          <div className="rounded-xl border bg-white p-4">
            <div className="mb-2">
              <h2 className="text-sm font-semibold">Occupancy over time</h2>
              <p className="text-xs text-muted-foreground">
                Rooms sold vs rooms available, day by day.
              </p>
            </div>
            {occupancySeries.length === 0 ? (
              <div className="text-sm text-muted-foreground">No data.</div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={occupancySeries}
                    margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 12 }}
                      minTickGap={28}
                    />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      formatter={(v) => formatPct(v as number)}
                      labelFormatter={(v) =>
                        new Date(v as string).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                        })
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="occupancy"
                      dot={false}
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Revenue chart */}
          <div className="rounded-xl border bg-white p-4">
            <div className="mb-2">
              <h2 className="text-sm font-semibold">Room revenue over time</h2>
              <p className="text-xs text-muted-foreground">
                Daily room revenue trend for the selected period.
              </p>
            </div>
            {revenueSeries.length === 0 ? (
              <div className="text-sm text-muted-foreground">No data.</div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={revenueSeries}
                    margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 12 }}
                      minTickGap={28}
                    />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip
                      formatter={(v) => formatINR(v as number)}
                      labelFormatter={(v) =>
                        new Date(v as string).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                        })
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="roomRevenue"
                      dot={false}
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
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
