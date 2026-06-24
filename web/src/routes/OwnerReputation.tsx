// web/src/routes/OwnerReputation.tsx
// "Reputation Radar" – per-stay view that links ops friction (tickets) with reviews.
//
// Expects Supabase view:
//   owner_reputation_v0(
//     hotel_id,
//     booking_code,
//     guest_name,
//     check_in,
//     check_out,
//     stay_status,          -- 'upcoming' | 'active' | 'completed'
//     review_rating,        -- 1–5 or null
//     review_submitted_at,
//     tickets_total,
//     guest_tickets,
//     open_tickets,
//     risk_score,
//     risk_band             -- 'green' | 'amber' | 'red' (or similar)
//   )
//
// This screen:
//   - Shows summary tiles (at-risk active/upcoming, low-rating stays, avg rating 30d)
//   - Lets owner filter by stay status + risk band
//   - Surfaced as: /owner/:slug/reputation (route wiring done in App.tsx)

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useOwnerT, useOwnerCommonT, useOwnerLocale } from "../i18n/useOwnerT";

type Hotel = { id: string; name: string; slug: string };

type StayStatus = "upcoming" | "active" | "completed" | string;
type RiskBand = "green" | "amber" | "red" | "grey" | string;

type ReputationRow = {
  hotel_id: string;
  booking_code: string;
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
  stay_status: StayStatus;
  review_rating: number | null;
  review_submitted_at: string | null;
  tickets_total: number | null;
  guest_tickets: number | null;
  open_tickets: number | null;
  risk_score: number | null;
  risk_band: RiskBand;
};

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
};

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function riskBandClass(band: RiskBand): string {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium uppercase";
  switch (band) {
    case "red":
      return `${base} bg-rose-50 text-rose-700 ring-1 ring-rose-200`;
    case "amber":
      return `${base} bg-amber-50 text-amber-700 ring-1 ring-amber-200`;
    case "green":
      return `${base} bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200`;
    default:
      return `${base} bg-slate-50 text-slate-600 ring-1 ring-slate-200`;
  }
}

function statusBadgeClass(status: StayStatus): string {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium uppercase";
  switch (status) {
    case "active":
      return `${base} bg-blue-50 text-blue-700 ring-1 ring-blue-200`;
    case "upcoming":
      return `${base} bg-sky-50 text-sky-700 ring-1 ring-sky-200`;
    case "completed":
      return `${base} bg-slate-50 text-slate-700 ring-1 ring-slate-200`;
    default:
      return `${base} bg-slate-50 text-slate-600 ring-1 ring-slate-200`;
  }
}

function formatDateRange(checkIn: string | null, checkOut: string | null, locale: string): string {
  const dIn = parseDate(checkIn);
  const dOut = parseDate(checkOut);
  const opts = { day: "2-digit", month: "short" } as const;
  if (!dIn && !dOut) return "—";
  if (dIn && !dOut) return dIn.toLocaleDateString(locale, opts);
  if (!dIn && dOut) return dOut.toLocaleDateString(locale, opts);
  if (!dIn || !dOut) return "—";
  return `${dIn.toLocaleDateString(locale, opts)} → ${dOut.toLocaleDateString(locale, opts)}`;
}

export default function OwnerReputation() {
  const { slug } = useParams<{ slug: string }>();
  const t = useOwnerT("owner-reputation");
  const tc = useOwnerCommonT();
  const locale = useOwnerLocale();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [rows, setRows] = useState<ReputationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [fromDay, setFromDay] = useState<string>(() =>
    isoDay(addDays(new Date(), -60))
  );
  const [toDay, setToDay] = useState<string>(() =>
    isoDay(addDays(new Date(), 7))
  );
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "upcoming" | "completed">("all");
  const [riskFilter, setRiskFilter] = useState<"all" | "red" | "amber" | "green">("all");
  const [search, setSearch] = useState("");

  // Load hotel + reputation view
  useEffect(() => {
    let alive = true;

    (async () => {
      if (!slug) {
        setError(t("error.missingSlug", "Missing hotel identifier in URL."));
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
        setError(t("error.hotelLoad", "Failed to load hotel details."));
        setHotel(null);
        setRows([]);
        setLoading(false);
        return;
      }

      setHotel(h || null);
      const hotelId = h?.id;
      if (!hotelId) {
        setError(t("error.hotelNotFound", "Hotel not found for this slug."));
        setRows([]);
        setLoading(false);
        return;
      }

      const { data, error: repErr } = await supabase
        .from("owner_reputation_v0")
        .select(
          "hotel_id,booking_code,guest_name,check_in,check_out,stay_status,review_rating,review_submitted_at,tickets_total,guest_tickets,open_tickets,risk_score,risk_band"
        )
        .eq("hotel_id", hotelId)
        .gte("check_in", fromDay)
        .lte("check_in", toDay)
        .order("check_in", { ascending: true });

      if (!alive) return;

      if (repErr) {
        console.error(repErr);
        setError(t("error.dataLoad", "Failed to load reputation radar data."));
        setRows([]);
      } else {
        setRows((data || []) as ReputationRow[]);
      }

      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [slug, fromDay, toDay]);

  // KPI summary (last 30 days for reviews)
  const summary = useMemo(() => {
    const now = new Date();
    const cutoff30 = addDays(now, -30);

    let atRiskActive = 0;
    let atRiskUpcoming = 0;
    let lowRating30d = 0;
    let ratingSum = 0;
    let ratingCount = 0;

    for (const r of rows) {
      const risk = (r.risk_band || "").toLowerCase();
      const status = (r.stay_status || "").toLowerCase();

      if (status === "active" && risk && risk !== "green") atRiskActive += 1;
      if (status === "upcoming" && risk && risk !== "green") atRiskUpcoming += 1;

      const rating = r.review_rating;
      const submittedAt = parseDate(r.review_submitted_at);

      if (rating != null && submittedAt && submittedAt >= cutoff30) {
        ratingSum += rating;
        ratingCount += 1;
        if (rating <= 3) {
          lowRating30d += 1;
        }
      }
    }

    const avgRating30d =
      ratingCount > 0 ? ratingSum / ratingCount : undefined;

    return {
      atRiskActive,
      atRiskUpcoming,
      lowRating30d,
      avgRating30d,
    };
  }, [rows]);

  // Apply UI filters (status/risk/search)
  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all") {
        if ((r.stay_status || "").toLowerCase() !== statusFilter) {
          return false;
        }
      }
      if (riskFilter !== "all") {
        if ((r.risk_band || "").toLowerCase() !== riskFilter) {
          return false;
        }
      }
      if (term) {
        const guest = (r.guest_name || "").toLowerCase();
        const booking = (r.booking_code || "").toLowerCase();
        if (!guest.includes(term) && !booking.includes(term)) {
          return false;
        }
      }
      return true;
    });
  }, [rows, statusFilter, riskFilter, search]);

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-4">
      {/* Header */}
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t("title", "Reputation Radar")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("subtitle", "Turn reviews into an operational KPI. See at-risk stays and close the loop before guests leave unhappy.")}
            {hotel ? t("viewingData", " You’re viewing data for {{name}}.", { name: hotel.name }) : ""}
          </p>
        </div>
        {slug && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">{t("relatedViews", "Related views:")}</span>
            <Link
              to={`/owner/${encodeURIComponent(slug)}/revenue`}
              className="btn btn-light"
            >
              {t("revenueLink", "Revenue & occupancy")}
            </Link>
          </div>
        )}
      </header>

      {/* Filters */}
      <section className="rounded-xl border bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block mb-1 text-xs text-muted-foreground">
              {t("filters.fromCheckin", "From (check-in)")}
            </label>
            <input
              type="date"
              value={fromDay}
              onChange={(e) => setFromDay(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block mb-1 text-xs text-muted-foreground">
              {t("filters.toCheckin", "To (check-in)")}
            </label>
            <input
              type="date"
              value={toDay}
              onChange={(e) => setToDay(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            />
          </div>

          <div>
            <label className="block mb-1 text-xs text-muted-foreground">
              {t("filters.stayStatus", "Stay status")}
            </label>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as typeof statusFilter)
              }
              className="border rounded px-2 py-1 text-sm"
            >
              <option value="all">{t("all", "All")}</option>
              <option value="active">{t("status.active", "Active")}</option>
              <option value="upcoming">{t("status.upcoming", "Upcoming")}</option>
              <option value="completed">{t("status.completed", "Completed")}</option>
            </select>
          </div>

          <div>
            <label className="block mb-1 text-xs text-muted-foreground">
              {t("filters.riskBand", "Risk band")}
            </label>
            <select
              value={riskFilter}
              onChange={(e) =>
                setRiskFilter(e.target.value as typeof riskFilter)
              }
              className="border rounded px-2 py-1 text-sm"
            >
              <option value="all">{t("all", "All")}</option>
              <option value="red">{t("risk.red", "Red")}</option>
              <option value="amber">{t("risk.amber", "Amber")}</option>
              <option value="green">{t("risk.green", "Green")}</option>
            </select>
          </div>

          <div className="flex-1 min-w-[160px]">
            <label className="block mb-1 text-xs text-muted-foreground">
              {t("filters.searchLabel", "Search guest / booking")}
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("filters.searchPlaceholder", "e.g. Bisht / BK123")}
              className="w-full border rounded px-2 py-1 text-sm"
            />
          </div>
        </div>
      </section>

      {/* Summary tiles */}
      <section className="rounded-xl border bg-white p-4">
        {loading ? (
          <div className="text-sm text-muted-foreground">{t("state.loading", "Loading…")}</div>
        ) : error ? (
          <div className="text-sm text-red-500">{error}</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {t("state.noStaysPeriod", "No stays found for this period.")}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
              <div className="text-xs font-medium text-slate-600">
                {t("tiles.atRiskActive", "At-risk active stays")}
              </div>
              <div className="mt-1 text-2xl font-semibold">
                {summary.atRiskActive}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {t("tiles.atRiskActiveDesc", "Active guests who might be heading towards a bad review.")}
              </div>
            </div>

            <div className="rounded-lg border border-slate-100 bg-white px-4 py-3">
              <div className="text-xs font-medium text-slate-600">
                {t("tiles.atRiskUpcoming", "At-risk upcoming stays")}
              </div>
              <div className="mt-1 text-2xl font-semibold">
                {summary.atRiskUpcoming}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {t("tiles.atRiskUpcomingDesc", "New arrivals with early friction signals.")}
              </div>
            </div>

            <div className="rounded-lg border border-slate-100 bg-white px-4 py-3">
              <div className="text-xs font-medium text-slate-600">
                {t("tiles.lowRatings", "Low ratings (30 days)")}
              </div>
              <div className="mt-1 text-2xl font-semibold">
                {summary.lowRating30d}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {t("tiles.lowRatingsDesc", "Completed stays rated 3★ or below in the last 30 days.")}
              </div>
            </div>

            <div className="rounded-lg border border-slate-100 bg-white px-4 py-3">
              <div className="text-xs font-medium text-slate-600">
                {t("tiles.avgRating", "Avg rating (30 days)")}
              </div>
              <div className="mt-1 text-2xl font-semibold">
                {summary.avgRating30d == null
                  ? "—"
                  : `${summary.avgRating30d.toFixed(2)} ★`}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {t("tiles.avgRatingDesc", "Across all reviews received in the last month.")}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Table */}
      {!loading && !error && rows.length > 0 && (
        <section className="rounded-xl border bg-white p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-sm font-semibold">{t("table.heading", "Stays & risk detail")}</h2>
              <p className="text-xs text-muted-foreground">
                {t("table.subheading", "Each row is one stay. Work the red & amber rows first.")}
              </p>
            </div>
          </div>
          {filteredRows.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {t("state.noStaysFilter", "No stays match the current filters.")}
            </div>
          ) : (
            <div className="-mx-4 -mb-4 overflow-x-auto">
              <table className="min-w-full border-t text-xs">
                <thead className="bg-slate-50">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2">{t("table.colGuestBooking", "Guest / Booking")}</th>
                    <th className="px-4 py-2">{t("table.colStay", "Stay")}</th>
                    <th className="px-4 py-2">{t("table.colStatus", "Status")}</th>
                    <th className="px-4 py-2">{t("table.colRisk", "Risk")}</th>
                    <th className="px-4 py-2">{t("table.colTickets", "Tickets")}</th>
                    <th className="px-4 py-2">{t("table.colReview", "Review")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => (
                    <tr
                      key={`${r.booking_code}-${r.check_in}`}
                      className="border-t hover:bg-slate-50/60"
                    >
                      <td className="px-4 py-2 align-top">
                        <div className="font-medium text-slate-800">
                          {r.guest_name || tc("terms.guest", "Guest")}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {r.booking_code || "—"}
                        </div>
                      </td>
                      <td className="px-4 py-2 align-top">
                        <div className="text-xs text-slate-800">
                          {formatDateRange(r.check_in, r.check_out, locale)}
                        </div>
                      </td>
                      <td className="px-4 py-2 align-top">
                        <span className={statusBadgeClass(r.stay_status)}>
                          {t(`status.${String(r.stay_status || "unknown").toLowerCase()}`, String(r.stay_status || "unknown"))}
                        </span>
                      </td>
                      <td className="px-4 py-2 align-top">
                        <div className="flex flex-col gap-1">
                          <span className={riskBandClass(r.risk_band)}>
                            {r.risk_band
                              ? t(`risk.${String(r.risk_band).toLowerCase()}`, String(r.risk_band))
                              : t("risk.na", "N/A")}
                          </span>
                          {r.risk_score != null && (
                            <span className="text-[11px] text-slate-500">
                              {t("table.score", "Score {{score}}", { score: r.risk_score })}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 align-top">
                        <div className="text-xs text-slate-800">
                          {t("table.ticketsTotal", "{{count}} total", { count: r.tickets_total ?? 0 })}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {t("table.ticketsBreakdown", "{{open}} open · {{guest}} from guest", { open: r.open_tickets ?? 0, guest: r.guest_tickets ?? 0 })}
                        </div>
                      </td>
                      <td className="px-4 py-2 align-top">
                        <div className="text-xs text-slate-800">
                          {r.review_rating == null || Number.isNaN(r.review_rating)
                            ? t("table.noReview", "No review")
                            : `${r.review_rating.toFixed(1)} ★`}
                        </div>
                        {r.review_submitted_at && (
                          <div className="text-[11px] text-slate-500">
                            {parseDate(r.review_submitted_at)?.toLocaleDateString(locale, {
                              day: "2-digit",
                              month: "short",
                            })}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
