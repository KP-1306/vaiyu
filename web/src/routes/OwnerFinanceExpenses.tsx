// web/src/routes/OwnerFinanceExpenses.tsx
// VAiyu Finance Module – expense log (dark theme)

import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Receipt, Plus, Trash2, Filter } from "lucide-react";
import {
  listExpenses,
  createExpense,
  deleteExpense,
  listCategories,
  ensureCategoriesSeeded,
  currentYearMonth,
} from "../services/financeService";
import type { FinanceExpense, FinanceCategory, ExpenseFormData } from "../types/finance";
import { formatINR } from "../lib/currency";
import {
  OwnerDarkPage,
  DarkCard,
  DarkLoading,
  DarkErrorPanel,
  DarkModal,
  DarkConfirmModal,
  DarkField,
  darkInputCls,
} from "../components/owner/DarkShell";
import { useOwnerT, useOwnerCommonT, useOwnerLocale } from "../i18n/useOwnerT";

type Hotel = { id: string; slug: string; name: string };

// `value` is the stored logic code (never translated); `key` maps to the
// owner-expenses payMode display map, `label` is the English fallback.
const PAYMENT_MODES = [
  { value: "", key: "select", label: "Select…" },
  { value: "cash", key: "cash", label: "Cash" },
  { value: "upi", key: "upi", label: "UPI" },
  { value: "card", key: "card", label: "Card" },
  { value: "bank_transfer", key: "bank_transfer", label: "Bank Transfer" },
  { value: "cheque", key: "cheque", label: "Cheque" },
  { value: "other", key: "other", label: "Other" },
];

const EMPTY_FORM: ExpenseFormData = {
  expense_date: new Date().toISOString().slice(0, 10),
  category_id: "",
  amount: 0,
  description: "",
  vendor_name: "",
  payment_mode: "",
};

export default function OwnerFinanceExpenses() {
  const t = useOwnerT("owner-expenses");
  const tc = useOwnerCommonT();
  const ownerLocale = useOwnerLocale();
  const { slug } = useParams<{ slug: string }>();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [expenses, setExpenses] = useState<FinanceExpense[]>([]);
  const [categories, setCategories] = useState<FinanceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [monthFilter, setMonthFilter] = useState(currentYearMonth);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ExpenseFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<FinanceExpense | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
        setError(hErr?.message ?? t("hotelNotFound", "Hotel not found."));
        return;
      }
      setHotel(hotelRow as Hotel);

      await ensureCategoriesSeeded(hotelRow.id);
      const [exps, cats] = await Promise.all([
        listExpenses(hotelRow.id, monthFilter),
        listCategories(hotelRow.id),
      ]);

      setExpenses(exps);
      setCategories(cats);
      if (!form.category_id && cats.length > 0) {
        setForm((prev) => ({ ...prev, category_id: cats[0].id }));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("loadFailed", "Failed to load expenses."));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, monthFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAddExpense() {
    if (!hotel) return;
    if (!form.category_id) {
      setFormError(t("selectCategory", "Select a category."));
      return;
    }
    if (form.amount <= 0) {
      setFormError(t("amountPositive", "Amount must be positive."));
      return;
    }
    if (!form.description.trim()) {
      setFormError(t("descRequired", "Description is required."));
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error(t("notAuthenticated", "Not authenticated."));

      const created = await createExpense(hotel.id, user.id, form);
      setExpenses((prev) => [
        {
          ...created,
          finance_categories: categories.find((c) => c.id === form.category_id),
        } as FinanceExpense,
        ...prev,
      ]);
      setShowForm(false);
      setForm({ ...EMPTY_FORM, category_id: categories[0]?.id ?? "" });
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : t("saveFailed", "Failed to save expense."));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setDeleteError(null);
    try {
      await deleteExpense(id);
      setExpenses((prev) => prev.filter((e) => e.id !== id));
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e.message : t("deleteFailed", "Delete failed."));
      throw e;
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return <DarkLoading message={t("loading", "Loading expenses…")} />;
  if (error || !hotel) return <DarkErrorPanel message={error ?? t("hotelNotFound", "Hotel not found.")} />;

  const base = `/owner/${slug}`;
  const totalSpend = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <OwnerDarkPage
      icon={Receipt}
      title={t("title", "Operational")}
      titleAccent={t("titleAccent", "Expenses")}
      accent="violet"
      subtitle={t("subtitle", "{{count}} entries · {{total}} total", { count: expenses.length, total: formatINR(totalSpend) })}
      breadcrumbs={[
        { label: tc("nav.dashboard", "Dashboard"), to: base },
        { label: t("crumbFinance", "Finance"), to: `${base}/finance` },
        { label: t("crumbExpenses", "Expenses") },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <input
              type="month"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className={darkInputCls + " w-40"}
            />
          </div>
          <button
            onClick={() => {
              setShowForm(true);
              setFormError(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-violet-500 hover:bg-violet-600 px-4 py-2 text-sm font-bold text-white transition shadow-lg shadow-violet-500/20"
          >
            <Plus className="w-4 h-4" /> {t("addExpense", "Add Expense")}
          </button>
        </div>
      }
    >
      {showForm && (
        <DarkModal title={t("addExpense", "Add Expense")} onClose={() => setShowForm(false)}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <DarkField label={t("fieldDate", "Date")}>
                <input
                  type="date"
                  className={darkInputCls}
                  value={form.expense_date}
                  onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
                />
              </DarkField>
              <DarkField label={t("fieldCategory", "Category")}>
                <select
                  className={darkInputCls}
                  value={form.category_id}
                  onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </DarkField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <DarkField label={t("fieldAmount", "Amount (₹)")}>
                <input
                  type="number"
                  min={0}
                  className={darkInputCls}
                  value={form.amount || ""}
                  onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
                />
              </DarkField>
              <DarkField label={t("fieldPaymentMode", "Payment Mode")}>
                <select
                  className={darkInputCls}
                  value={form.payment_mode}
                  onChange={(e) => setForm({ ...form, payment_mode: e.target.value })}
                >
                  {PAYMENT_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {t(`payMode.${m.key}`, m.label)}
                    </option>
                  ))}
                </select>
              </DarkField>
            </div>
            <DarkField label={t("fieldDescription", "Description")}>
              <input
                type="text"
                className={darkInputCls}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder={t("descPlaceholder", "e.g. AC repair in room 204")}
              />
            </DarkField>
            <DarkField label={t("fieldVendor", "Vendor (optional)")}>
              <input
                type="text"
                className={darkInputCls}
                value={form.vendor_name}
                onChange={(e) => setForm({ ...form, vendor_name: e.target.value })}
                placeholder={t("vendorPlaceholder", "e.g. SunTech Services")}
              />
            </DarkField>
          </div>
          {formError && <p className="mt-3 text-sm text-rose-300">{formError}</p>}
          <div className="mt-6 flex gap-3 justify-end">
            <button
              onClick={() => setShowForm(false)}
              className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
            >
              {tc("actions.cancel", "Cancel")}
            </button>
            <button
              onClick={handleAddExpense}
              disabled={saving}
              className="rounded-xl bg-violet-500 hover:bg-violet-600 px-5 py-2 text-sm font-bold text-white disabled:opacity-60 shadow-lg shadow-violet-500/20"
            >
              {saving ? tc("actions.saving", "Saving…") : t("addExpense", "Add Expense")}
            </button>
          </div>
        </DarkModal>
      )}

      {expenses.length === 0 ? (
        <DarkCard className="text-center py-12 border-dashed border-2">
          <Receipt className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="font-bold text-slate-200">{t("emptyTitle", "No expenses this month")}</p>
          <p className="text-sm text-slate-500 mt-1 mb-4">
            {t("emptyBody", "Start logging operational expenses to track your spending.")}
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-violet-500 hover:bg-violet-600 px-4 py-2 text-sm font-bold text-white transition shadow-lg shadow-violet-500/20"
          >
            <Plus className="w-4 h-4" /> {t("addFirst", "Add First Expense")}
          </button>
        </DarkCard>
      ) : (
        <DarkCard padded={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#1a1c1e] border-b border-white/[0.05]">
                <tr>
                  {[
                    { k: "date", label: t("colDate", "Date") },
                    { k: "category", label: t("colCategory", "Category") },
                    { k: "description", label: t("colDescription", "Description") },
                    { k: "vendor", label: t("colVendor", "Vendor") },
                    { k: "mode", label: t("colMode", "Mode") },
                    { k: "amount", label: t("colAmount", "Amount") },
                    { k: "actions", label: "" },
                  ].map((h) => (
                    <th
                      key={h.k}
                      className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 whitespace-nowrap"
                    >
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {expenses.map((exp) => (
                  <tr key={exp.id} className="hover:bg-white/[0.02] transition">
                    <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                      {new Date(exp.expense_date).toLocaleDateString(ownerLocale, {
                        day: "2-digit",
                        month: "short",
                        year: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-violet-500/15 text-violet-300 px-2 py-0.5 text-xs font-semibold">
                        {exp.finance_categories?.name ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-200 max-w-xs truncate">{exp.description}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{exp.vendor_name ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-400 capitalize">
                      {exp.payment_mode ? t(`payMode.${exp.payment_mode}`, exp.payment_mode) : "—"}
                    </td>
                    <td className="px-4 py-3 font-bold text-white">{formatINR(exp.amount)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setConfirmDelete(exp)}
                        disabled={deletingId === exp.id}
                        className="text-slate-500 hover:text-rose-400 transition disabled:opacity-40"
                        aria-label={t("deleteExpense", "Delete expense")}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-[#1a1c1e] border-t border-white/[0.05]">
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-sm font-bold text-slate-300 text-right">
                    {t("total", "Total")}
                  </td>
                  <td className="px-4 py-3 font-black text-white">{formatINR(totalSpend)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </DarkCard>
      )}

      {confirmDelete && (
        <DarkConfirmModal
          title={t("deleteExpense", "Delete expense")}
          message={
            <>
              <p>
                {t("deleteMsgPrefix", "Delete expense")} <span className="font-semibold text-white">{formatINR(confirmDelete.amount)}</span>
                {confirmDelete.description ? ` — "${confirmDelete.description}"` : ""}
                {t("deleteMsgSuffix", "? This cannot be undone.")}
              </p>
              {deleteError && <p className="mt-3 text-sm text-rose-300">{deleteError}</p>}
            </>
          }
          confirmLabel={t("deleteExpense", "Delete expense")}
          variant="danger"
          busy={deletingId === confirmDelete.id}
          onCancel={() => {
            setConfirmDelete(null);
            setDeleteError(null);
          }}
          onConfirm={async () => {
            try {
              await handleDelete(confirmDelete.id);
              setConfirmDelete(null);
            } catch {
              /* stay open — error surfaced via deleteError */
            }
          }}
        />
      )}
    </OwnerDarkPage>
  );
}
