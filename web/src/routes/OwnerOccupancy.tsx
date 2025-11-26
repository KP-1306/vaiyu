// web/src/routes/OwnerOccupancy.tsx
// Owner Occupancy view (per property)
// Uses fetchOwnerOccupancy(slug) from lib/api
// UI: snapshot + 30-day history + simple "vs 30-day median" badge

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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
  fetchOwnerOccupancy,
  type OwnerOccupancyResponse,
} from "../lib/api";

// ----------------- helpers -----------------

function formatPercent(n?: number | null, digits = 1): string {
  if (n == null || isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function median(nums: number[]): number | undefined {
  const arr = nums
    .filter((n) => Number.isFinite(n))
    .slice()
    .sort((a, b) => a - b);
  if (!arr.length) return undefined;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 === 1
    ? arr[mid]
    : (arr[mid - 1] + arr[mid]) / 2;
}

type Tone = "green" | "amber" | "red" | "grey";

function badgeTone(t: Tone) {
  return {
    green: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    amber: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    red: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
    grey: "bg-slate-50 text-slate-600 ring-1 ring-slate-200",
  }[t];
}

/** Simple interpretation:
 *  - ≥ +3% vs median → green
 *  - within ±3%       → amber
 *  - worse than −3%   → red
 */
function occupancyTone(deltaPct: number | undefined): Tone {
  if (deltaPct == null || isNaN(deltaPct)) return "grey";
  if (deltaPct >= 3) return "green";
  if (deltaPct >= -3) return "amber";
  return "red";
}

// ----------------- component -----------------

export default function OwnerOccupancy() {
  const { slug } = useParams<{ slug: string }>();
  const nav = useNavigate();
  const [data, setData] = useState<OwnerOccupancyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!slug) {
        setError("Missing hotel slug in URL.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetchOwnerOccupancy(slug);
        if (!alive) return;
        setData(res);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Failed to load occupancy.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();

    return () => {
      alive = false;
    };
  }, [slug]);

  const snapshot = data?.snapshot ?? null;
  const history = data?.history ?? [];

  // Latest data point (often "today" or most recent date the backend sends)
  const latest = history.length ? history[history.length - 1] : null;

  // Median occupancy across the returned range (e.g. last 30 days)
  const medianOccupancy = useMemo(() => {
    const values = history
      .map((p) => p.occupancyPercent)
      .filter((n) => typeof n === "number") as number[];
    return median(values);
  }, [history]);

  const latestOcc = latest?.occupancyPercent;
  const deltaPct =
    latestOcc != null &&
    medianOccupancy != null &&
    medianOccupancy !== 0
      ? ((latestOcc - medianOccupancy) / medianOccupancy) * 100
      : undefined;
  const tone = occupancyTone(deltaPct);

  const chartData = history.map((p) => ({
    day: p.day,
    occupancy: p.occupancyPercent,
  }));

  // ------------- render -------------

  return (
    <main className="max-w-6xl mx-auto p-6">
      {/* Header + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <div className="text-2xl font-semibold">Occupancy</div>
          <p className="text-sm text-muted-foreground">
            Live view of how many rooms are filled. Uses the last 30 days
            to calculate a simple median baseline.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-light" onClick={() => nav(-1)}>
            ← Back
          </button>
          {slug && (
            <Link
              className="btn"
              to={`/owner/${encodeURIComponent(slug)}/revenue`}
            >
              Open revenue view
            </Link>
          )}
        </div>
      </div>

      {/* Snapshot */}
      <div className="rounded-xl border bg-white p-4 mb-4">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : error ? (
          <div className="text-sm text-rose-600">
            {error || "Something went wrong while loading occupancy."}
          </div>
        ) : !snapshot && !history.length ? (
          <div className="text-sm text-muted-foreground">
            No occupancy data available yet.
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs text-muted-foreground">Today</div>
              <div className="text-2xl font-semibold">
                {formatPercent(
                  snapshot?.occupancyPercent ?? latestOcc ?? null
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Share of rooms currently occupied.
              </p>
            </div>

            <div>
              <div className="text-xs text-muted-foreground">
                Rooms (occupied / total)
              </div>
              <div className="text-lg">
                {snapshot ? (
                  <>
                    {snapshot.occupiedRooms}{" "}
                    <span className="text-sm text-muted-foreground">
                      / {snapshot.roomsTotal ?? "—"}
                    </span>
                  </>
                ) : (
                  "—"
                )}
              </div>
            </div>

            <div>
              <div className="text-xs text-muted-foreground">
                30-day median
              </div>
              <div className="text-lg">
                {formatPercent(medianOccupancy ?? null)}
              </div>
            </div>

            <div>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${badgeTone(
                  tone
                )}`}
              >
                {deltaPct == null
                  ? "No trend yet"
                  : `${deltaPct > 0 ? "+" : ""}${Math.round(
                      deltaPct
                    )}% vs 30-day median`}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* History chart */}
      <div className="rounded-xl border bg-white p-4">
        <div className="flex items-start justify-between mb-2">
          <div>
            <h2 className="text-lg font-semibold">Occupancy – last 30 days</h2>
            <p className="text-sm text-muted-foreground">
              Each point is the daily occupancy percentage. Use this to spot
              weak periods or sudden drops.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading chart…</div>
        ) : !chartData.length ? (
          <div className="text-sm text-muted-foreground">
            No data to chart yet.
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
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
                  formatter={(v: any) => formatPercent(v as number, 1)}
                  labelFormatter={(label) => `Day: ${label}`}
                />
                <Line
                  type="monotone"
                  dataKey="occupancy"
                  dot={false}
                  strokeWidth={2}
                />
                {medianOccupancy != null && (
                  <ReferenceLine
                    y={medianOccupancy}
                    strokeDasharray="4 4"
                    label={{
                      position: "insideTopRight",
                      value: "30-day median",
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
