// web/src/routes/OwnerRatePlanPricing.tsx
// VAiyu Phase 1 – Per-plan pricing editor: room type × date/dow → price.

import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  IndianRupee,
  CalendarDays,
} from "lucide-react";
import {
  listPlanPrices,
  upsertPlanPrice,
  deletePlanPrice,
} from "../services/rateService";
import { listRoomTypes } from "../services/pricingService";
import type { RatePlan, RatePlanPrice, RatePlanPriceFormData } from "../types/rate";
import { DOW_ALL_DAYS, DOW_LABELS, DOW_WEEKDAYS, DOW_WEEKENDS } from "../types/rate";
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
import { useOwnerT, useOwnerCommonT, type OwnerT } from "../i18n/useOwnerT";

type Hotel = { id: string; slug: string; name: string };

const EMPTY_FORM = (planId: string): RatePlanPriceFormData => ({
  rate_plan_id: planId,
  room_type_id: "",
  price: 0,
  valid_from: null,
  valid_to: null,
  dow_mask: DOW_ALL_DAYS,
  priority: 100,
  notes: null,
});

// Render dow_mask as a short chip label: "All", "Mon–Fri", "Sat+Sun", or "Mon Wed Fri".
function dowLabel(mask: number, t: OwnerT): string {
  if (mask === DOW_ALL_DAYS) return t("dowAllDays", "All days");
  if (mask === DOW_WEEKDAYS) return t("dowWeekdays", "Weekdays");
  if (mask === DOW_WEEKENDS) return t("dowWeekends", "Weekends");
  const selected = DOW_LABELS.filter(({ bit }) => (mask & bit) > 0).map((d) => t(`dow.${d.short}`, d.short));
  return selected.length ? selected.join(" ") : "—";
}

function validityLabel(p: RatePlanPrice, t: OwnerT): string {
  if (!p.valid_from && !p.valid_to) return t("validAlways", "Always");
  if (p.valid_from && !p.valid_to) return t("validFrom", "From {{date}}", { date: p.valid_from });
  if (!p.valid_from && p.valid_to) return t("validUntil", "Until {{date}}", { date: p.valid_to });
  return t("validRange", "{{from}} → {{to}}", { from: p.valid_from, to: p.valid_to });
}

export default function OwnerRatePlanPricing() {
  const t = useOwnerT("owner-rateplan-pricing");
  const tc = useOwnerCommonT();
  const { slug, planId } = useParams<{ slug: string; planId: string }>();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [plan, setPlan] = useState<RatePlan | null>(null);
  const [roomTypes, setRoomTypes] = useState<{ id: string; name: string }[]>([]);
  const [prices, setPrices] = useState<RatePlanPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RatePlanPriceFormData>(EMPTY_FORM(planId ?? ""));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RatePlanPrice | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!slug || !planId) return;
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

      const { data: planRow, error: pErr } = await supabase
        .from("rate_plans")
        .select("*")
        .eq("id", planId)
        .eq("hotel_id", hotelRow.id)
        .is("deleted_at", null)
        .maybeSingle();
      if (pErr || !planRow) {
        setError(pErr?.message ?? t("planNotFound", "Rate plan not found."));
        return;
      }
      setPlan(planRow as RatePlan);

      const [rt, pp] = await Promise.all([
        listRoomTypes(hotelRow.id),
        listPlanPrices(hotelRow.id, planId),
      ]);
      setRoomTypes(rt);
      setPrices(pp);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("loadFailed", "Failed to load."));
    } finally {
      setLoading(false);
    }
  }, [slug, planId, t]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate(roomTypeId?: string) {
    if (!planId) return;
    setEditingId(null);
    setForm({
      ...EMPTY_FORM(planId),
      room_type_id: roomTypeId ?? (roomTypes[0]?.id ?? ""),
    });
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(row: RatePlanPrice) {
    setEditingId(row.id);
    setForm({
      rate_plan_id: row.rate_plan_id,
      room_type_id: row.room_type_id,
      price: Number(row.price),
      valid_from: row.valid_from,
      valid_to: row.valid_to,
      dow_mask: row.dow_mask,
      priority: row.priority,
      notes: row.notes,
    });
    setFormError(null);
    setShowForm(true);
  }

  function validate(f: RatePlanPriceFormData): string | null {
    if (!f.room_type_id) return t("vRoomType", "Pick a room type.");
    if (!(f.price >= 0)) return t("vPrice", "Price must be 0 or greater.");
    if (f.dow_mask < 1 || f.dow_mask > 127) return t("vDow", "Pick at least one day of the week.");
    if (f.valid_from && f.valid_to && f.valid_to < f.valid_from)
      return t("vValidOrder", "Valid-to must be on or after valid-from.");
    if (f.priority < 1) return t("vPriority", "Priority must be 1 or greater.");
    return null;
  }

  async function handleSave() {
    if (!hotel || !planId) return;
    const err = validate(form);
    if (err) {
      setFormError(err);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await upsertPlanPrice(
        hotel.id,
        editingId ? { ...form, id: editingId } : form,
      );
      setShowForm(false);
      setEditingId(null);
      await load();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : t("saveFailed", "Save failed."));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setDeleteError(null);
    try {
      await deletePlanPrice(id);
      setPrices((prev) => prev.filter((p) => p.id !== id));
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e.message : t("deleteFailed", "Delete failed."));
      throw e;
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return <DarkLoading message={t("loading", "Loading prices…")} />;
  if (error || !hotel || !plan)
    return <DarkErrorPanel message={error ?? t("planNotFound", "Rate plan not found.")} />;

  const base = `/owner/${slug}`;
  const pricesByRoomType: Record<string, RatePlanPrice[]> = {};
  for (const p of prices) {
    (pricesByRoomType[p.room_type_id] ||= []).push(p);
  }

  return (
    <OwnerDarkPage
      icon={IndianRupee}
      title={plan.name}
      titleAccent={t("titleAccent", "Prices")}
      accent="indigo"
      subtitle={`${t("priceRows", "{{count}} price rows", { count: prices.length })} · ${t("roomTypesCount", "{{count}} room types", { count: roomTypes.length })}`}
      breadcrumbs={[
        { label: tc("nav.dashboard", "Dashboard"), to: base },
        { label: t("crumbPricing", "Pricing"), to: `${base}/pricing` },
        { label: t("crumbRatePlans", "Rate Plans"), to: `${base}/pricing/plans` },
        { label: plan.name },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <Link
            to={`${base}/pricing/plans`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 text-sm font-semibold text-slate-200 transition"
          >
            <ArrowLeft className="w-4 h-4" /> {t("plansBtn", "Plans")}
          </Link>
          <button
            onClick={() => openCreate()}
            disabled={roomTypes.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 px-4 py-2 text-sm font-bold text-white transition shadow-lg shadow-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" /> {t("addPrice", "Add Price")}
          </button>
        </div>
      }
    >
      {showForm && (
        <DarkModal
          title={editingId ? t("editPrice", "Edit Price") : t("newPrice", "New Price")}
          onClose={() => setShowForm(false)}
        >
          <div className="space-y-4">
            <DarkField label={t("fieldRoomType", "Room Type")}>
              <select
                className={darkInputCls}
                value={form.room_type_id}
                onChange={(e) => setForm({ ...form, room_type_id: e.target.value })}
              >
                <option value="">{t("selectPlaceholder", "Select…")}</option>
                {roomTypes.map((rt) => (
                  <option key={rt.id} value={rt.id}>
                    {rt.name}
                  </option>
                ))}
              </select>
            </DarkField>

            <DarkField label={t("fieldPrice", "Price (₹ per night)")}>
              <input
                className={darkInputCls}
                type="number"
                min={0}
                step={1}
                value={form.price}
                onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
              />
            </DarkField>

            <div className="grid grid-cols-2 gap-3">
              <DarkField label={t("fieldValidFrom", "Valid From")} hint={t("hintValidFrom", "Blank = no start bound")}>
                <input
                  className={darkInputCls}
                  type="date"
                  value={form.valid_from ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, valid_from: e.target.value || null })
                  }
                />
              </DarkField>
              <DarkField label={t("fieldValidTo", "Valid To")} hint={t("hintValidTo", "Blank = evergreen")}>
                <input
                  className={darkInputCls}
                  type="date"
                  value={form.valid_to ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, valid_to: e.target.value || null })
                  }
                />
              </DarkField>
            </div>

            <DarkField
              label={t("fieldDaysOfWeek", "Days of Week")}
              hint={t("hintDaysOfWeek", "Pick the days this price applies to")}
            >
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {DOW_LABELS.map(({ bit, short }) => {
                    const selected = (form.dow_mask & bit) > 0;
                    return (
                      <button
                        key={bit}
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            dow_mask: selected
                              ? form.dow_mask & ~bit
                              : form.dow_mask | bit,
                          })
                        }
                        className={
                          "rounded-lg px-2.5 py-1 text-xs font-semibold transition border " +
                          (selected
                            ? "border-indigo-500/50 bg-indigo-500/20 text-indigo-200"
                            : "border-white/10 bg-white/[0.02] text-slate-400 hover:text-slate-200")
                        }
                      >
                        {t(`dow.${short}`, short)}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, dow_mask: DOW_ALL_DAYS })}
                    className="text-slate-500 hover:text-indigo-300 font-semibold uppercase tracking-wider"
                  >
                    {t("quickAll", "All")}
                  </button>
                  <span className="text-slate-700">·</span>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, dow_mask: DOW_WEEKDAYS })}
                    className="text-slate-500 hover:text-indigo-300 font-semibold uppercase tracking-wider"
                  >
                    {t("dowWeekdays", "Weekdays")}
                  </button>
                  <span className="text-slate-700">·</span>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, dow_mask: DOW_WEEKENDS })}
                    className="text-slate-500 hover:text-indigo-300 font-semibold uppercase tracking-wider"
                  >
                    {t("dowWeekends", "Weekends")}
                  </button>
                </div>
              </div>
            </DarkField>

            <div className="grid grid-cols-2 gap-3">
              <DarkField label={t("fieldPriority", "Priority")} hint={t("hintPriority", "Higher wins on overlap")}>
                <input
                  className={darkInputCls}
                  type="number"
                  min={1}
                  value={form.priority}
                  onChange={(e) =>
                    setForm({ ...form, priority: Number(e.target.value) })
                  }
                />
              </DarkField>
              <DarkField label={t("fieldNotes", "Notes")} hint={t("hintNotes", "Internal reminder")}>
                <input
                  className={darkInputCls}
                  value={form.notes ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, notes: e.target.value || null })
                  }
                  placeholder={t("notesPlaceholder", "e.g. Diwali peak")}
                />
              </DarkField>
            </div>
          </div>

          {formError && <p className="mt-3 text-sm text-rose-300">{formError}</p>}

          <div className="mt-6 flex gap-3 justify-end">
            <button
              onClick={() => setShowForm(false)}
              className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition"
            >
              {tc("actions.cancel", "Cancel")}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-xl bg-indigo-500 hover:bg-indigo-600 px-5 py-2 text-sm font-bold text-white transition disabled:opacity-60 shadow-lg shadow-indigo-500/20"
            >
              {saving ? tc("actions.saving", "Saving…") : editingId ? t("saveChanges", "Save Changes") : t("createPrice", "Create Price")}
            </button>
          </div>
        </DarkModal>
      )}

      {roomTypes.length === 0 ? (
        <DarkCard className="text-center py-12 border-dashed border-2">
          <CalendarDays className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="font-bold text-slate-200">{t("noRoomTypes", "No room types configured")}</p>
          <p className="text-sm text-slate-500 mt-1">
            {t("noRoomTypesBody", "Add room types during hotel setup before setting prices.")}
          </p>
        </DarkCard>
      ) : (
        <div className="space-y-4">
          {roomTypes.map((rt) => {
            const rows = pricesByRoomType[rt.id] ?? [];
            return (
              <DarkCard key={rt.id} padded={false} className="overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-[#1a1c1e] border-b border-white/[0.05]">
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-white">{rt.name}</span>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      {t("pricesCount", "{{count}} prices", { count: rows.length })}
                    </span>
                  </div>
                  <button
                    onClick={() => openCreate(rt.id)}
                    className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-semibold"
                  >
                    <Plus className="w-3.5 h-3.5" /> {t("addPriceSmall", "Add price")}
                  </button>
                </div>

                {rows.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-slate-500">
                    {t("noPricesConfigured", "No prices configured. Add one to start selling this room type.")}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-[#151719] border-b border-white/[0.04]">
                        <tr>
                          {[
                            { k: "price", label: t("colPrice", "Price") },
                            { k: "validity", label: t("colValidity", "Validity") },
                            { k: "days", label: t("colDays", "Days") },
                            { k: "priority", label: t("colPriority", "Priority") },
                            { k: "notes", label: t("colNotes", "Notes") },
                            { k: "actions", label: "" },
                          ].map(
                            (h) => (
                              <th
                                key={h.k}
                                className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500"
                              >
                                {h.label}
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.04]">
                        {rows.map((row) => (
                          <tr key={row.id} className="hover:bg-white/[0.02] transition">
                            <td className="px-4 py-3 font-semibold text-white">
                              {formatINR(Number(row.price))}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-400">
                              {validityLabel(row, t)}
                            </td>
                            <td className="px-4 py-3">
                              <span className="rounded-full bg-white/[0.04] text-slate-300 px-2 py-0.5 text-[11px] font-semibold">
                                {dowLabel(row.dow_mask, t)}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-slate-500">
                              {row.priority}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate">
                              {row.notes || "—"}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => openEdit(row)}
                                  className="text-slate-400 hover:text-indigo-400 transition"
                                  aria-label={t("editPriceAria", "Edit price")}
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => setConfirmDelete(row)}
                                  disabled={deletingId === row.id}
                                  className="text-slate-400 hover:text-rose-400 transition disabled:opacity-40"
                                  aria-label={t("deletePriceAria", "Delete price")}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </DarkCard>
            );
          })}
        </div>
      )}

      {confirmDelete && (
        <DarkConfirmModal
          title={t("deletePriceTitle", "Delete price")}
          message={
            <>
              <p>
                {t("deleteMsgPrefix", "Delete this")}{" "}
                <span className="font-semibold text-white">
                  {formatINR(Number(confirmDelete.price))}
                </span>{" "}
                {t("deleteMsgSuffix", "price row? Active bookings keep their locked-in rate.")}
              </p>
              {deleteError && (
                <p className="mt-3 text-sm text-rose-300">{deleteError}</p>
              )}
            </>
          }
          confirmLabel={tc("actions.delete", "Delete")}
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
              /* stay open */
            }
          }}
        />
      )}
    </OwnerDarkPage>
  );
}
