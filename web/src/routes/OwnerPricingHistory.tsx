// web/src/routes/OwnerPricingHistory.tsx
// VAiyu Pricing Module – pricing change log / audit view (dark theme)

import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { History, ArrowRight, TrendingUp, TrendingDown, Minus, Download } from "lucide-react";
import Papa from "papaparse";
import type { PricingChangeLog } from "../types/pricing";
import { formatINR } from "../lib/currency";
import {
  OwnerDarkPage,
  DarkCard,
  DarkLoading,
  DarkErrorPanel,
  darkInputCls,
} from "../components/owner/DarkShell";
import { useOwnerT, useOwnerCommonT, useOwnerLocale } from "../i18n/useOwnerT";

type Hotel = { id: string; slug: string; name: string };

const PAGE_SIZE = 50;

export default function OwnerPricingHistory() {
  const t = useOwnerT("owner-pricing-history");
  const tc = useOwnerCommonT();
  const ownerLocale = useOwnerLocale();
  const { slug } = useParams<{ slug: string }>();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [logs, setLogs] = useState<PricingChangeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [monthFilter, setMonthFilter] = useState<string>(
    new Date().toISOString().slice(0, 7),
  );
  const [exporting, setExporting] = useState(false);

  const monthBounds = useCallback(() => {
    const monthStart = `${monthFilter}-01`;
    const end = new Date(
      new Date(monthStart).getFullYear(),
      new Date(monthStart).getMonth() + 1,
      0,
    )
      .toISOString()
      .slice(0, 10);
    return {
      startIso: `${monthStart}T00:00:00Z`,
      endIso: `${end}T23:59:59Z`,
    };
  }, [monthFilter]);

  const fetchPage = useCallback(
    async (
      hotelId: string,
      cursor: { applied_at: string; id: string } | null,
    ) => {
      const { startIso, endIso } = monthBounds();
      let q = supabase
        .from("pricing_change_log")
        .select("*")
        .eq("hotel_id", hotelId)
        .gte("applied_at", startIso)
        .lte("applied_at", endIso)
        // Composite ordering is mandatory for a strict keyset cursor — otherwise
        // rows sharing the boundary timestamp (common during bulk auto-apply
        // where many rows get the same `now()`) are silently lost at page edges.
        .order("applied_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE + 1); // +1 to detect more
      if (cursor) {
        q = q.or(
          `applied_at.lt.${cursor.applied_at},` +
            `and(applied_at.eq.${cursor.applied_at},id.lt.${cursor.id})`,
        );
      }
      const { data, error: lErr } = await q;
      if (lErr) throw lErr;
      const rows = (data ?? []) as PricingChangeLog[];
      const more = rows.length > PAGE_SIZE;
      return { rows: more ? rows.slice(0, PAGE_SIZE) : rows, more };
    },
    [monthBounds],
  );

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    setLogs([]);
    setHasMore(false);

    try {
      const { data: hotelRow, error: hErr } = await supabase
        .from("hotels")
        .select("id, slug, name")
        .eq("slug", slug)
        .maybeSingle();

      if (hErr || !hotelRow) {
        setError(hErr?.message ?? t("hotelNotFound", "Hotel not found."));
        return;
      }
      setHotel(hotelRow as Hotel);

      const { rows, more } = await fetchPage(hotelRow.id, null);
      setLogs(rows);
      setHasMore(more);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("loadFailed", "Failed to load history."));
    } finally {
      setLoading(false);
    }
  }, [slug, fetchPage, t]);

  const loadMore = useCallback(async () => {
    if (!hotel || logs.length === 0 || loadingMore) return;
    setLoadingMore(true);
    try {
      const last = logs[logs.length - 1];
      const { rows, more } = await fetchPage(hotel.id, {
        applied_at: last.applied_at,
        id: last.id,
      });
      setLogs((prev) => [...prev, ...rows]);
      setHasMore(more);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("loadMoreFailed", "Failed to load more."));
    } finally {
      setLoadingMore(false);
    }
  }, [hotel, logs, loadingMore, fetchPage, t]);

  // Export the full month (ignoring in-memory pagination) so a partial scroll
  // doesn't produce a partial CSV. We page server-side in chunks of 500 to
  // stay under PostgREST's default row cap, then stream to a single Blob.
  const exportCsv = useCallback(async () => {
    if (!hotel) return;
    setExporting(true);
    try {
      const { startIso, endIso } = monthBounds();
      const all: PricingChangeLog[] = [];
      const CHUNK = 500;
      let from = 0;
      while (true) {
        const { data, error: eErr } = await supabase
          .from("pricing_change_log")
          .select("*")
          .eq("hotel_id", hotel.id)
          .gte("applied_at", startIso)
          .lte("applied_at", endIso)
          .order("applied_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + CHUNK - 1);
        if (eErr) throw eErr;
        const rows = (data ?? []) as PricingChangeLog[];
        all.push(...rows);
        if (rows.length < CHUNK) break;
        from += CHUNK;
      }

      const csv = Papa.unparse(
        all.map((r) => ({
          applied_at: r.applied_at,
          occupancy_pct: r.occupancy_pct_at_time,
          base_price: r.base_price_at_time,
          previous_price: r.previous_price,
          new_price: r.new_price,
          adjustment_type: r.adjustment_type,
          adjustment_value: r.adjustment_value,
          was_clamped: r.was_clamped,
          clamp_reason: r.clamp_reason ?? "",
          matched_rule: r.matched_rule_name ?? "",
          room_type_id: r.room_type_id ?? "",
          explanation: r.explanation,
          note: r.note ?? "",
        })),
      );

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pricing-history-${hotel.slug}-${monthFilter}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("exportFailed", "Export failed."));
    } finally {
      setExporting(false);
    }
  }, [hotel, monthBounds, monthFilter, t]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <DarkLoading message={t("loading", "Loading history…")} />;
  if (error || !hotel) return <DarkErrorPanel message={error ?? t("hotelNotFound", "Hotel not found.")} />;

  const base = `/owner/${slug}`;

  return (
    <OwnerDarkPage
      icon={History}
      title={t("title", "Pricing")}
      titleAccent={t("titleAccent", "History")}
      accent="indigo"
      subtitle={t("subtitle", "{{count}}{{plus}} changes in {{month}}", { count: logs.length, plus: hasMore ? "+" : "", month: monthFilter })}
      breadcrumbs={[
        { label: tc("nav.dashboard", "Dashboard"), to: base },
        { label: t("crumbPricing", "Pricing"), to: `${base}/pricing` },
        { label: t("crumbHistory", "History") },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{t("month", "Month")}</label>
          <input
            type="month"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className={darkInputCls + " w-40"}
          />
          <button
            onClick={exportCsv}
            disabled={exporting || logs.length === 0}
            title={t("exportTitle", "Export all changes for this month to CSV")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 text-sm font-semibold text-slate-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            {exporting ? t("exporting", "Exporting…") : t("exportCsv", "Export CSV")}
          </button>
        </div>
      }
    >
      {logs.length === 0 ? (
        <DarkCard className="text-center py-12 border-dashed border-2">
          <History className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="font-bold text-slate-200">{t("emptyTitle", "No pricing changes this month")}</p>
          <p className="text-sm text-slate-500 mt-1">
            {t("emptyBody", "Apply a pricing recommendation to see it here.")}
          </p>
          <Link
            to={`${base}/pricing`}
            className="mt-4 inline-flex items-center gap-1 text-sm text-indigo-400 hover:text-indigo-300"
          >
            {t("goToPricing", "Go to Pricing Overview")} <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </DarkCard>
      ) : (
        <DarkCard padded={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#1a1c1e] border-b border-white/[0.05]">
                <tr>
                  {[
                    { k: "dt", label: t("colDateTime", "Date & Time") },
                    { k: "occ", label: t("colOccupancy", "Occupancy") },
                    { k: "base", label: t("colBasePrice", "Base Price") },
                    { k: "prev", label: t("colPrevious", "Previous") },
                    { k: "new", label: t("colNewPrice", "New Price") },
                    { k: "rule", label: t("colRule", "Rule") },
                    { k: "exp", label: t("colExplanation", "Explanation") },
                  ].map(
                    (h) => (
                      <th
                        key={h.k}
                        className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 whitespace-nowrap"
                      >
                        {h.label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {logs.map((log) => {
                  const delta = log.new_price - log.previous_price;
                  const DeltaIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
                  const deltaColor =
                    delta > 0 ? "text-emerald-400" : delta < 0 ? "text-rose-400" : "text-slate-400";

                  return (
                    <tr key={log.id} className="hover:bg-white/[0.02] transition">
                      <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                        {new Date(log.applied_at).toLocaleString(ownerLocale, {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-200">
                        {log.occupancy_pct_at_time.toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-slate-300">{formatINR(log.base_price_at_time)}</td>
                      <td className="px-4 py-3 text-slate-500 line-through">
                        {formatINR(log.previous_price)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`flex items-center gap-1 font-bold ${deltaColor}`}>
                          <DeltaIcon className="w-3.5 h-3.5" />
                          {formatINR(log.new_price)}
                        </span>
                        {log.was_clamped && (
                          <span className="text-xs text-amber-400">{t("clamped", "(clamped)")}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {log.matched_rule_name ? (
                          <span className="rounded-full bg-indigo-500/15 text-indigo-300 px-2 py-0.5 text-xs font-medium">
                            {log.matched_rule_name}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500">—</span>
                        )}
                      </td>
                      <td
                        className="px-4 py-3 text-xs text-slate-400 max-w-xs truncate"
                        title={log.explanation}
                      >
                        {log.explanation}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <div className="border-t border-white/[0.05] px-4 py-3 bg-[#1a1c1e] flex justify-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition disabled:opacity-60"
              >
                {loadingMore ? tc("state.loading", "Loading…") : t("loadMore", "Load more ({{size}})", { size: PAGE_SIZE })}
              </button>
            </div>
          )}
        </DarkCard>
      )}
    </OwnerDarkPage>
  );
}
