// web/src/routes/OwnerFinanceBudgets.tsx
// VAiyu Finance Module – monthly budget planner (dark theme)

import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Wallet, Save, CheckCircle } from "lucide-react";
import {
  listCategories,
  listBudgetPlans,
  upsertBudgetPlan,
  deleteBudgetPlan,
  ensureCategoriesSeeded,
  currentYearMonth,
} from "../services/financeService";
import type { FinanceCategory } from "../types/finance";
import {
  OwnerDarkPage,
  DarkCard,
  DarkLoading,
  DarkErrorPanel,
  darkInputCls,
} from "../components/owner/DarkShell";

type Hotel = { id: string; slug: string; name: string };
type BudgetRow = {
  category: FinanceCategory;
  amount: string;
  notes: string;
  /** True when a plan row exists in the DB for this category+month — a blanked
   *  amount must then DELETE the row, not be silently skipped on save. */
  hasSavedPlan: boolean;
};

export default function OwnerFinanceBudgets() {
  const { slug } = useParams<{ slug: string }>();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState(currentYearMonth);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    setSaveSuccess(false);

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
      const [categories, plans] = await Promise.all([
        listCategories(hotelRow.id),
        listBudgetPlans(hotelRow.id, month),
      ]);

      const planMap = new Map(plans.map((p) => [p.category_id, p]));

      setRows(
        categories.map((cat) => ({
          category: cat,
          amount: planMap.has(cat.id) ? String(planMap.get(cat.id)!.budget_amount) : "",
          notes: planMap.has(cat.id) ? (planMap.get(cat.id)!.notes ?? "") : "",
          hasSavedPlan: planMap.has(cat.id),
        })),
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load budget data.");
    } finally {
      setLoading(false);
    }
  }, [slug, month]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave() {
    if (!hotel) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated.");

      const toSave = rows.filter((r) => r.amount !== "" && !isNaN(Number(r.amount)));
      const toClear = rows.filter((r) => r.amount === "" && r.hasSavedPlan);
      if (toSave.length === 0 && toClear.length === 0) {
        setSaveError("Enter at least one budget amount to save.");
        return;
      }

      await Promise.all([
        ...toSave.map((r) =>
          upsertBudgetPlan(
            hotel.id,
            user.id,
            month,
            r.category.id,
            Number(r.amount),
            r.notes || null,
          ),
        ),
        ...toClear.map((r) => deleteBudgetPlan(hotel.id, month, r.category.id)),
      ]);

      const savedIds = new Set(toSave.map((r) => r.category.id));
      const clearedIds = new Set(toClear.map((r) => r.category.id));
      setRows((prev) =>
        prev.map((r) =>
          savedIds.has(r.category.id)
            ? { ...r, hasSavedPlan: true }
            : clearedIds.has(r.category.id)
              ? { ...r, notes: "", hasSavedPlan: false }
              : r,
        ),
      );
      setSaveSuccess(true);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function updateRow(catId: string, field: "amount" | "notes", value: string) {
    setRows((prev) =>
      prev.map((r) => (r.category.id === catId ? { ...r, [field]: value } : r)),
    );
    setSaveSuccess(false);
  }

  if (loading) return <DarkLoading message="Loading budgets…" />;
  if (error || !hotel) return <DarkErrorPanel message={error ?? "Hotel not found."} />;

  const base = `/owner/${slug}`;
  const totalBudget = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  return (
    <OwnerDarkPage
      icon={Wallet}
      title="Budget"
      titleAccent="Planner"
      accent="violet"
      subtitle="Set monthly operational budgets per category."
      breadcrumbs={[
        { label: "Dashboard", to: base },
        { label: "Finance", to: `${base}/finance` },
        { label: "Budgets" },
      ]}
      actions={
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className={darkInputCls + " w-40"}
        />
      }
    >
      <DarkCard padded={false} className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#1a1c1e] border-b border-white/[0.05]">
              <tr>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Category
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 w-48">
                  Budget (₹)
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Notes
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {rows.map((row) => (
                <tr key={row.category.id} className="hover:bg-white/[0.02] transition">
                  <td className="px-4 py-3">
                    <span className="font-semibold text-white">{row.category.name}</span>
                    {row.category.code && (
                      <span className="ml-2 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-slate-400">
                        {row.category.code}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min={0}
                      placeholder="0"
                      value={row.amount}
                      onChange={(e) => updateRow(row.category.id, "amount", e.target.value)}
                      className={darkInputCls}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      placeholder="Optional note"
                      value={row.notes}
                      onChange={(e) => updateRow(row.category.id, "notes", e.target.value)}
                      className={darkInputCls}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-[#1a1c1e] border-t border-white/[0.05]">
              <tr>
                <td className="px-4 py-3 text-sm font-bold text-slate-300">Total</td>
                <td className="px-4 py-3 text-sm font-black text-white">
                  ₹{totalBudget.toLocaleString("en-IN")}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </DarkCard>

      <div className="flex items-center gap-4 justify-between flex-wrap">
        <div>
          {saveSuccess && (
            <p className="text-sm text-emerald-300 flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4" /> Budgets saved successfully.
            </p>
          )}
          {saveError && <p className="text-sm text-rose-300">{saveError}</p>}
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-violet-500 hover:bg-violet-600 px-5 py-2.5 text-sm font-bold text-white transition disabled:opacity-60 shadow-lg shadow-violet-500/20"
        >
          {saving ? (
            <>
              <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
              Saving…
            </>
          ) : (
            <>
              <Save className="w-4 h-4" /> Save Budgets
            </>
          )}
        </button>
      </div>
    </OwnerDarkPage>
  );
}
