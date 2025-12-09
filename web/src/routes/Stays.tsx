import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

type StayRow = {
  id: string;
  hotel_id: string;
  hotel_name?: string | null;
  city?: string | null;
  cover_image_url?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  earned_paise?: number | null;
  review_status?: string | null;
};

type StayStatusKey = "upcoming" | "ongoing" | "completed" | "unknown";

// ---------- helpers ----------

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getStayYear(row: StayRow): number | null {
  const d = parseDate(row.check_in || row.check_out);
  return d ? d.getFullYear() : null;
}

function getStayStatus(row: StayRow, now = new Date()): StayStatusKey {
  const ci = parseDate(row.check_in);
  const co = parseDate(row.check_out);
  if (!ci && !co) return "unknown";

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (co && co < today) return "completed";
  if (ci && ci > today) return "upcoming";
  return "ongoing";
}

function getNights(row: StayRow): number | null {
  const ci = parseDate(row.check_in);
  const co = parseDate(row.check_out);
  if (!ci || !co) return null;
  const ms = co.getTime() - ci.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const nights = Math.round(ms / (1000 * 60 * 60 * 24));
  return nights > 0 ? nights : null;
}

function formatStayDates(row: StayRow): string {
  const ci = parseDate(row.check_in);
  const co = parseDate(row.check_out);

  if (!ci && !co) return "Dates to be updated";

  const baseOpts: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
  };

  if (ci && co) {
    const sameMonth =
      ci.getFullYear() === co.getFullYear() &&
      ci.getMonth() === co.getMonth();

    if (sameMonth) {
      const monthYear = ci.toLocaleDateString(undefined, {
        month: "short",
        year: "numeric",
      });
      return `${ci.getDate()}–${co.getDate()} ${monthYear}`;
    }

    const start = ci.toLocaleDateString(undefined, baseOpts);
    const end = co.toLocaleDateString(undefined, baseOpts);
    return `${start} → ${end}`;
  }

  const single = ci || co;
  return single!.toLocaleDateString(undefined, baseOpts);
}

// ---------- main page ----------

export default function Stays() {
  const [rows, setRows] = useState<StayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters / sorting (client-side)
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "upcoming" | "ongoing" | "completed"
  >("all");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<
    "newest" | "oldest" | "creditsHigh" | "creditsLow"
  >("newest");

  const hasRows = rows.length > 0;

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error } = await supabase
          .from("user_recent_stays")
          .select(
            "id, hotel_id, hotel_name, city, cover_image_url, check_in, check_out, earned_paise, review_status",
          )
          .order("check_in", { ascending: false });

        if (!alive) return;

        if (error) {
          console.error("[Stays] supabase error", error);
          setError(error.message || "Could not load your stays.");
          setRows([]);
          return;
        }

        setRows((data || []) as StayRow[]);
      } catch (e: any) {
        if (!alive) return;
        console.error("[Stays] unexpected error", e);
        setError(e?.message || "Could not load your stays.");
        setRows([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const summary = useMemo(() => {
    if (!hasRows) return null;

    let totalPaise = 0;
    let totalNights = 0;
    const now = new Date();

    let upcoming: { row: StayRow; ts: number } | null = null;
    let last: { row: StayRow; ts: number } | null = null;

    for (const r of rows) {
      totalPaise += r.earned_paise ?? 0;
      const nights = getNights(r);
      if (nights) totalNights += nights;

      const status = getStayStatus(r, now);
      const d = parseDate(r.check_in || r.check_out);
      const ts = d ? d.getTime() : null;

      if (status === "upcoming" && ts !== null) {
        if (!upcoming || ts < upcoming.ts) {
          upcoming = { row: r, ts };
        }
      }

      if ((status === "completed" || status === "ongoing") && ts !== null) {
        if (!last || ts > last.ts) {
          last = { row: r, ts };
        }
      }
    }

    return {
      totalCreditsPaise: totalPaise,
      stayCount: rows.length,
      totalNights,
      upcomingStay: upcoming?.row ?? null,
      lastStay: last?.row ?? null,
    };
  }, [rows, hasRows]);

  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    for (const r of rows) {
      const y = getStayYear(r);
      if (y) years.add(y);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [rows]);

  const cityOptions = useMemo(() => {
    const cities = new Set<string>();
    for (const r of rows) {
      const c = (r.city || "").trim();
      if (c) cities.add(c);
    }
    return Array.from(cities).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (!hasRows) return [];
    let list = [...rows];

    if (yearFilter !== "all") {
      list = list.filter((r) => String(getStayYear(r)) === yearFilter);
    }

    if (cityFilter !== "all") {
      list = list.filter(
        (r) =>
          (r.city || "").trim().toLowerCase() ===
          cityFilter.trim().toLowerCase(),
      );
    }

    if (statusFilter !== "all") {
      list = list.filter((r) => getStayStatus(r) === statusFilter);
    }

    const getSortDate = (r: StayRow) => {
      const d = parseDate(r.check_in || r.check_out);
      return d ? d.getTime() : 0;
    };

    list.sort((a, b) => {
      switch (sortBy) {
        case "oldest":
          return getSortDate(a) - getSortDate(b);
        case "creditsHigh":
          return (b.earned_paise ?? 0) - (a.earned_paise ?? 0);
        case "creditsLow":
          return (a.earned_paise ?? 0) - (b.earned_paise ?? 0);
        case "newest":
        default:
          return getSortDate(b) - getSortDate(a);
      }
    });

    return list;
  }, [rows, hasRows, yearFilter, cityFilter, statusFilter, sortBy]);

  const groupedSections = useMemo(() => {
    const groups: Record<string, StayRow[]> = {};
    for (const r of filteredRows) {
      const y = getStayYear(r);
      const label = y ? String(y) : "Dates pending";
      if (!groups[label]) groups[label] = [];
      groups[label].push(r);
    }

    return Object.entries(groups)
      .map(([label, items]) => {
        const sortKey = /^\d{4}$/.test(label) ? parseInt(label, 10) : -Infinity;
        return { label, sortKey, items };
      })
      .sort((a, b) => b.sortKey - a.sortKey);
  }, [filteredRows]);

  const filteredHasRows = filteredRows.length > 0;

  const resetFilters = () => {
    setYearFilter("all");
    setStatusFilter("all");
    setCityFilter("all");
    setSortBy("newest");
  };

  return (
    <main className="max-w-5xl mx-auto p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your stays</h1>
          <p className="text-sm text-gray-600 mt-1">
            View your past and upcoming stays at VAiyu partner hotels.
          </p>
        </div>
        <Link to="/guest" className="btn btn-light">
          Back to dashboard
        </Link>
      </div>

      {loading ? (
        <section className="mt-6 rounded-2xl border bg-white/90 shadow-sm p-6">
          <div className="h-4 w-40 bg-gray-200 rounded mb-4" />
          <div className="h-6 w-64 bg-gray-100 rounded mb-4" />
          <div className="h-24 w-full bg-gray-100 rounded" />
        </section>
      ) : error ? (
        <section className="mt-6 rounded-2xl border border-yellow-300 bg-yellow-50 p-4 text-sm">
          <p className="text-gray-800">{error}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-light"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
            <Link to="/guest" className="btn btn-light">
              Back to dashboard
            </Link>
          </div>
        </section>
      ) : !hasRows ? (
        <EmptyState />
      ) : (
        <>
          {/* Lifetime summary band */}
          {summary && (
            <section className="mt-6 rounded-2xl border bg-gradient-to-r from-slate-50 via-white to-slate-50 shadow-sm p-4 md:p-5 flex flex-wrap items-stretch gap-4">
              {/* Lifetime stats */}
              <div className="flex-1 min-w-[200px] space-y-1 text-xs text-gray-700">
                <div className="uppercase tracking-wide text-[10px] text-gray-500">
                  Lifetime with VAiyu
                </div>
                <div className="text-sm md:text-base font-semibold text-gray-900">
                  {summary.stayCount}{" "}
                  {summary.stayCount === 1 ? "stay" : "stays"} •{" "}
                  {summary.totalNights}{" "}
                  {summary.totalNights === 1 ? "night" : "nights"}
                </div>
                <p className="text-xs text-gray-600">
                  Every completed stay adds credits you can redeem at partner
                  hotels.
                </p>
              </div>

              {/* Next stay highlight */}
              <div className="min-w-[210px] max-w-xs rounded-xl bg-white/80 border border-slate-100 shadow-sm px-3 py-3 text-xs text-gray-700 flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-gray-800">Next stay</span>
                  {summary.upcomingStay && (
                    <span className="rounded-full bg-emerald-50 border border-emerald-100 text-[10px] text-emerald-700 px-2 py-0.5">
                      Upcoming
                    </span>
                  )}
                </div>

                {summary.upcomingStay ? (
                  <>
                    <div className="mt-1 text-sm font-medium truncate">
                      {summary.upcomingStay.hotel_name || "Partner hotel"}
                    </div>
                    <div className="text-xs text-gray-500">
                      {summary.upcomingStay.city || "Location coming soon"}
                    </div>
                    <div className="mt-1 text-xs text-gray-600">
                      {formatStayDates(summary.upcomingStay)}
                    </div>
                    <Link
                      to={`/stay/${encodeURIComponent(
                        summary.upcomingStay.id,
                      )}`}
                      state={{ stay: summary.upcomingStay }}
                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 hover:text-teal-800"
                    >
                      View stay details <span>→</span>
                    </Link>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-gray-600">
                    No upcoming stay yet. Book directly with your favourite
                    VAiyu property to earn more credits.
                  </p>
                )}
              </div>

              {/* Credits + last stay */}
              <div className="flex flex-col items-end justify-between min-w-[160px] gap-2 text-xs text-gray-600">
                <div className="text-right">
                  <div className="text-[11px] text-gray-500">Total credits</div>
                  <div className="mt-1 px-4 py-2 rounded-full bg-white shadow-sm border text-base font-semibold text-emerald-700">
                    ₹{(summary.totalCreditsPaise / 100).toFixed(2)}
                  </div>
                </div>
                {summary.lastStay && (
                  <div className="text-[11px] text-gray-500 text-right">
                    Last stayed at{" "}
                    <span className="font-medium text-gray-700">
                      {summary.lastStay.hotel_name || "a partner hotel"}
                    </span>{" "}
                    • {formatStayDates(summary.lastStay)}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Filters */}
          <section className="mt-4 rounded-2xl border bg-white/90 shadow-sm p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-3">
                <FilterSelect
                  label="Year"
                  value={yearFilter}
                  onChange={setYearFilter}
                  options={[
                    { value: "all", label: "All years" },
                    ...yearOptions.map((y) => ({
                      value: String(y),
                      label: String(y),
                    })),
                  ]}
                />

                <FilterSelect
                  label="Status"
                  value={statusFilter}
                  onChange={(v) =>
                    setStatusFilter(
                      v as "all" | "upcoming" | "ongoing" | "completed",
                    )
                  }
                  options={[
                    { value: "all", label: "All statuses" },
                    { value: "upcoming", label: "Upcoming" },
                    { value: "ongoing", label: "Ongoing" },
                    { value: "completed", label: "Completed" },
                  ]}
                />

                <FilterSelect
                  label="Location"
                  value={cityFilter}
                  onChange={setCityFilter}
                  options={[
                    { value: "all", label: "All locations" },
                    ...cityOptions.map((c) => ({
                      value: c,
                      label: c,
                    })),
                  ]}
                />
              </div>

              <div className="flex items-center gap-3">
                <FilterSelect
                  label="Sort by"
                  value={sortBy}
                  onChange={(v) =>
                    setSortBy(
                      v as "newest" | "oldest" | "creditsHigh" | "creditsLow",
                    )
                  }
                  options={[
                    { value: "newest", label: "Newest first" },
                    { value: "oldest", label: "Oldest first" },
                    { value: "creditsHigh", label: "Highest credits" },
                    { value: "creditsLow", label: "Lowest credits" },
                  ]}
                />
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-xs text-gray-500 hover:text-gray-700 underline-offset-2 hover:underline"
                >
                  Clear filters
                </button>
              </div>
            </div>
            <div className="mt-3 text-xs text-gray-500">
              Showing {filteredRows.length} of {rows.length} stays.
            </div>
          </section>

          {/* grouped stays by year */}
          {filteredHasRows ? (
            <div className="mt-5 space-y-6">
              {groupedSections.map((section) => (
                <section key={section.label} className="space-y-3">
                  <h2 className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
                    {section.label}
                  </h2>
                  <div className="space-y-3">
                    {section.items.map((r) => (
                      <StayCard key={r.id} row={r} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <section className="mt-6 rounded-2xl border bg-white/90 shadow-sm p-8 text-center text-sm text-gray-700">
              <p>No stays match the filters you&apos;ve selected.</p>
              <button
                type="button"
                onClick={resetFilters}
                className="mt-3 btn btn-light"
              >
                Clear filters
              </button>
            </section>
          )}
        </>
      )}
    </main>
  );
}

// ---------- tiny filter select component ----------

type FilterSelectOption = { value: string; label: string };

function FilterSelect(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: FilterSelectOption[];
}) {
  const { label, value, onChange, options } = props;
  return (
    <label className="text-xs font-medium text-gray-600 flex flex-col gap-1">
      <span>{label}</span>
      <select
        className="select min-w-[140px] text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---------- individual stay card ----------

function StayCard({ row }: { row: StayRow }) {
  const {
    id,
    hotel_name,
    city,
    cover_image_url,
    earned_paise,
    review_status,
  } = row;

  const status = getStayStatus(row);
  const nights = getNights(row);
  const datesLabel = formatStayDates(row);
  const creditsRupees = ((earned_paise ?? 0) / 100).toFixed(2);

  const statusConfig: Record<
    StayStatusKey,
    { label: string; className: string }
  > = {
    upcoming: {
      label: "Upcoming",
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    ongoing: {
      label: "Ongoing",
      className: "bg-sky-50 text-sky-700 border-sky-200",
    },
    completed: {
      label: "Completed",
      className: "bg-slate-50 text-slate-700 border-slate-200",
    },
    unknown: {
      label: "",
      className: "hidden",
    },
  };

  const statusStyles = statusConfig[status];

  return (
    <Link
      to={`/stay/${encodeURIComponent(id)}`}
      state={{ stay: row }}
      className="group flex flex-col sm:flex-row gap-4 rounded-2xl border bg-white/90 hover:bg-slate-50 hover:shadow-md transition-all overflow-hidden"
    >
      <div className="sm:w-44 h-32 sm:h-28 flex-shrink-0 rounded-xl overflow-hidden bg-gray-100 relative">
        {cover_image_url ? (
          <img
            src={cover_image_url}
            alt={hotel_name || "Hotel image"}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200 flex items-center justify-center text-[10px] text-gray-500">
            VAiyu stay
          </div>
        )}
      </div>

      <div className="flex-1 py-3 pr-4 flex flex-col justify-between">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate">
              {hotel_name || "Partner hotel"}
            </div>
            <div className="mt-0.5 text-xs text-gray-500">
              {city || "Location coming soon"}
            </div>
          </div>
          {statusStyles.label && (
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusStyles.className}`}
            >
              {statusStyles.label}
            </span>
          )}
        </div>

        <div className="mt-3 grid gap-1 text-xs text-gray-600 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)]">
          <div>
            <div className="font-medium text-gray-700">{datesLabel}</div>
            {nights && (
              <div className="text-[11px] text-gray-500">
                {nights} {nights === 1 ? "night" : "nights"}
              </div>
            )}
          </div>
          <div className="sm:text-right">
            <div className="text-gray-500 text-[11px]">Credits earned</div>
            <div className="text-sm font-semibold text-emerald-700">
              ₹{creditsRupees}
            </div>
            {review_status && (
              <div className="mt-1 inline-flex items-center rounded-full border border-gray-200 px-2 py-0.5 bg-gray-50 text-[10px] text-gray-600">
                Review: {review_status}
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-[11px] text-teal-700">
          <span className="inline-flex items-center gap-1 font-medium">
            View stay details
            <span className="transition-transform group-hover:translate-x-0.5">
              →
            </span>
          </span>
          <span className="text-[10px] text-gray-400">
            Tap to open services, food, chat & rewards
          </span>
        </div>
      </div>
    </Link>
  );
}

// ---------- no-stays empty state ----------

function EmptyState() {
  return (
    <section className="mt-6 rounded-2xl border bg-white/90 shadow-sm p-8 text-center">
      <p className="text-gray-700 text-sm">
        No stays yet. Your trips will appear here after your first visit to a
        VAiyu partner hotel.
      </p>
      <div className="mt-4">
        <Link to="/guest" className="btn btn-light">
          Back to dashboard
        </Link>
      </div>
    </section>
  );
}
