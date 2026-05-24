// web/src/routes/OwnerFinance.tsx
// VAiyu Finance Module – monthly overview (dark theme)

import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Plus,
  CheckCircle,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import {
  getFinanceSummary,
  ensureCategoriesSeeded,
  createManualRevenue,
  currentYearMonth,
} from "../services/financeService";
import type { FinanceSummary, CategoryBudgetStatus, RevenueFormData } from "../types/finance";
import { formatMoney } from "../lib/currency";
import {
  OwnerDarkPage,
  DarkCard,
  DarkKPI,
  DarkLoading,
  DarkErrorPanel,
  DarkModal,
  DarkField,
  darkInputCls,
} from "../components/owner/DarkShell";

type Hotel = { id: string; slug: string; name: string };

// Absolute value – this module prepends the sign manually in a few places.
function formatINR(n: number) {
  return formatMoney(Math.abs(n));
}

const STATUS_CONFIG: Record<
  CategoryBudgetStatus,
  { badge: string; label: string; icon: React.ElementType; bar: string }
> = {
  ok: {
    badge: "text-emerald-300 bg-emerald-500/15",
    label: "OK",
    icon: CheckCircle,
    bar: "bg-emerald-400",
  },
  near_limit: {
    badge: "text-amber-300 bg-amber-500/15",
    label: "Near Limit",
    icon: AlertTriangle,
    bar: "bg-amber-400",
  },
  exceeded: {
    badge: "text-rose-300 bg-rose-500/15",
    label: "Exceeded",
    icon: XCircle,
    bar: "bg-rose-400",
  },
};

export default function OwnerFinance() {
  const { slug } = useParams<{ slug: string }>();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState(currentYearMonth);

  const [showRevenueForm, setShowRevenueForm] = useState(false);
  const [revenueForm, setRevenueForm] = useState<RevenueFormData>({
    revenue_date: new Date().toISOString().slice(0, 10),
    revenue_type: "room",
    amount: 0,
    notes: "",
  });
  const [savingRevenue, setSavingRevenue] = useState(false);
  const [revenueError, setRevenueError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);

    try {
      const { data: hotelRow, error: hErr } = await supabase
        .from("hotels")
        .select("id, slug, name")
        .eq("slug", slug)
        .maybeSingle();

      if (hErr || !hotelRow) {
        setError(hErr?.message ?? "Hotel not found.");
        return;
      }
      setHotel(hotelRow as Hotel);

      await ensureCategoriesSeeded(hotelRow.id);
      const s = await getFinanceSummary(hotelRow.id, month);
      setSummary(s);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load finance data.");
    } finally {
      setLoading(false);
    }
  }, [slug, month]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAddRevenue() {
    if (!hotel) return;
    if (revenueForm.amount <= 0) {
      setRevenueError("Amount must be positive.");
      return;
    }

    setSavingRevenue(true);
    setRevenueError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated.");

      await createManualRevenue(hotel.id, user.id, revenueForm);
      setShowRevenueForm(false);
      await load();
    } catch (e: unknown) {
      setRevenueError(e instanceof Error ? e.message : "Failed to save revenue.");
    } finally {
      setSavingRevenue(false);
    }
  }

  if (loading) return <DarkLoading message="Loading finance data…" />;
  if (error || !hotel || !summary)
    return <DarkErrorPanel message={error ?? "Hotel not found."} />;

  const base = `/owner/${slug}`;
  const profitPositive = summary.operating_profit >= 0;
  const utilizationPct =
    summary.total_budget > 0 ? (summary.total_expense / summary.total_budget) * 100 : 0;

  return (
    <OwnerDarkPage
      icon={Wallet}
      title="Finance"
      titleAccent="Overview"
      accent="violet"
      subtitle={hotel.name}
      breadcrumbs={[{ label: "Dashboard", to: base }, { label: "Finance" }]}
      actions={
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className={darkInputCls + " w-40"}
          />
          <button
            onClick={() => setShowRevenueForm(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-violet-500 hover:bg-violet-600 px-4 py-2 text-sm font-bold text-white transition shadow-lg shadow-violet-500/20"
          >
            <Plus className="w-4 h-4" /> Log Revenue
          </button>
        </div>
      }
    >
      {showRevenueForm && (
        <DarkModal title="Log Revenue" onClose={() => setShowRevenueForm(false)} maxWidth="max-w-md">
          <div className="space-y-4">
            <DarkField label="Date">
              <input
                type="date"
                className={darkInputCls}
                value={revenueForm.revenue_date}
                onChange={(e) => setRevenueForm({ ...revenueForm, revenue_date: e.target.value })}
              />
            </DarkField>
            <DarkField label="Revenue Type">
              <select
                className={darkInputCls}
                value={revenueForm.revenue_type}
                onChange={(e) =>
                  setRevenueForm({
                    ...revenueForm,
                    revenue_type: e.target.value as RevenueFormData["revenue_type"],
                  })
                }
              >
                <option value="room">Room Revenue</option>
                <option value="f&b">F&B</option>
                <option value="events">Events</option>
                <option value="other">Other</option>
              </select>
            </DarkField>
            <DarkField label="Amount (₹)">
              <input
                type="number"
                min={0}
                className={darkInputCls}
                value={revenueForm.amount || ""}
                onChange={(e) => setRevenueForm({ ...revenueForm, amount: Number(e.target.value) })}
              />
            </DarkField>
            <DarkField label="Notes (optional)">
              <input
                type="text"
                className={darkInputCls}
                value={revenueForm.notes}
                onChange={(e) => setRevenueForm({ ...revenueForm, notes: e.target.value })}
              />
            </DarkField>
          </div>
          {revenueError && <p className="mt-3 text-sm text-rose-300">{revenueError}</p>}
          <div className="mt-6 flex gap-3 justify-end">
            <button
              onClick={() => setShowRevenueForm(false)}
              className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
            >
              Cancel
            </button>
            <button
              onClick={handleAddRevenue}
              disabled={savingRevenue}
              className="rounded-xl bg-violet-500 hover:bg-violet-600 px-5 py-2 text-sm font-bold text-white disabled:opacity-60 shadow-lg shadow-violet-500/20"
            >
              {savingRevenue ? "Saving…" : "Save"}
            </button>
          </div>
        </DarkModal>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <DarkKPI label="Total Budget" value={formatINR(summary.total_budget)} sub="this month" />
        <DarkKPI
          label="Total Spend"
          value={formatINR(summary.total_expense)}
          sub={`${utilizationPct.toFixed(0)}% of budget`}
          valueClass={
            summary.total_expense > summary.total_budget ? "text-rose-300" : "text-white"
          }
        />
        <DarkKPI
          label="Revenue"
          value={formatINR(summary.total_revenue)}
          sub="manually logged"
          valueClass="text-emerald-300"
        />
        <DarkKPI
          label="Operating Profit"
          value={(profitPositive ? "" : "-") + formatINR(summary.operating_profit)}
          sub="revenue minus expenses"
          valueClass={profitPositive ? "text-emerald-300" : "text-rose-300"}
          icon={profitPositive ? TrendingUp : TrendingDown}
        />
      </div>

      {/* Budget utilisation */}
      {summary.total_budget > 0 && (
        <DarkCard>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold text-slate-200">Budget Utilisation</span>
            <span className="text-sm font-bold text-slate-200">
              {formatINR(summary.total_expense)} / {formatINR(summary.total_budget)}
            </span>
          </div>
          <div className="h-3 w-full rounded-full bg-white/[0.05] overflow-hidden">
            <div
              className={
                "h-full rounded-full transition-all " +
                (summary.total_expense > summary.total_budget
                  ? "bg-rose-500"
                  : utilizationPct > 80
                  ? "bg-amber-400"
                  : "bg-emerald-500")
              }
              style={{ width: `${Math.min(utilizationPct, 100)}%` }}
            />
          </div>
        </DarkCard>
      )}

      {/* Category breakdown */}
      <DarkCard className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Category Breakdown</h2>
          <Link
            to={`${base}/finance/budgets`}
            className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1"
          >
            Edit Budgets <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        {summary.categories.filter((c) => c.budget_amount > 0 || c.actual_spend > 0).length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-4">
            No budget data for this month.{" "}
            <Link to={`${base}/finance/budgets`} className="text-violet-400 hover:text-violet-300">
              Set budgets
            </Link>
          </p>
        ) : (
          <div className="space-y-3">
            {summary.categories
              .filter((c) => c.budget_amount > 0 || c.actual_spend > 0)
              .sort((a, b) => b.utilization_pct - a.utilization_pct)
              .map((cat) => {
                const cfg = STATUS_CONFIG[cat.status];
                const Icon = cfg.icon;
                const barPct = Math.min(cat.utilization_pct, 100);
                return (
                  <div key={cat.category_id}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-200">
                          {cat.category_name}
                        </span>
                        <span
                          className={
                            "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold " +
                            cfg.badge
                          }
                        >
                          <Icon className="w-3 h-3" /> {cfg.label}
                        </span>
                      </div>
                      <span className="text-xs text-slate-400">
                        {formatINR(cat.actual_spend)}
                        {cat.budget_amount > 0 && ` / ${formatINR(cat.budget_amount)}`}
                      </span>
                    </div>
                    {cat.budget_amount > 0 && (
                      <div className="h-2 w-full rounded-full bg-white/[0.05] overflow-hidden">
                        <div
                          className={"h-full rounded-full " + cfg.bar}
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </DarkCard>

      {/* Quick links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          to={`${base}/finance/budgets`}
          className="rounded-2xl bg-[#16181b] border border-white/[0.06] p-5 hover:border-violet-500/40 transition group shadow-lg"
        >
          <p className="font-bold text-white group-hover:text-violet-300 transition">
            Budget Planner
          </p>
          <p className="text-xs text-slate-500 mt-1">Set monthly budgets per category.</p>
        </Link>
        <Link
          to={`${base}/finance/expenses`}
          className="rounded-2xl bg-[#16181b] border border-white/[0.06] p-5 hover:border-violet-500/40 transition group shadow-lg"
        >
          <p className="font-bold text-white group-hover:text-violet-300 transition">Expenses</p>
          <p className="text-xs text-slate-500 mt-1">Log and review operational expenses.</p>
        </Link>
      </div>
    </OwnerDarkPage>
  );
}
