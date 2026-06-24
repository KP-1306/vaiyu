// web/src/routes/OwnerPricingRules.tsx
// VAiyu Pricing Module – CRUD for pricing rules (dark theme)

import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, TrendingUp } from "lucide-react";
import {
  listPricingRules,
  createPricingRule,
  updatePricingRule,
  deletePricingRule,
  listRoomTypes,
} from "../services/pricingService";
import type { PricingDow, PricingRule, PricingRuleFormData } from "../types/pricing";
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

const EMPTY_FORM: PricingRuleFormData = {
  rule_name: "",
  active: true,
  scope_type: "property",
  room_type_id: null,
  occupancy_min_pct: 70,
  occupancy_max_pct: null,
  adjustment_type: "increase_pct",
  adjustment_value: 10,
  min_price: null,
  max_price: null,
  priority: 10,
  applicable_dow: null,
  season_start_mmdd: null,
  season_end_mmdd: null,
  lead_time_min_days: null,
  lead_time_max_days: null,
};

// Native <select> popups on Chromium ignore [color-scheme:dark] for the open menu;
// styling each <option> directly is the only reliable cross-browser dark-mode fix.
const darkOptionStyle = { backgroundColor: "#0e1014", color: "#fff" } as const;

const DOW_LABELS: { value: PricingDow; label: string }[] = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

// MMDD int (MM*100+DD) <-> "MM-DD" string for <input type="date"> (year-agnostic).
// Use current year for the display year so the calendar feels current (not 2001).
// Bump to next year if current year is a leap year, so Feb 29 still can't sneak in.
const DISPLAY_YEAR = (() => {
  const y = new Date().getFullYear();
  const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return isLeap ? y + 1 : y;
})();

function mmddToDateInput(mmdd: number | null): string {
  if (mmdd == null) return "";
  const mm = Math.floor(mmdd / 100);
  const dd = mmdd % 100;
  return `${DISPLAY_YEAR}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}
function dateInputToMmdd(s: string): number | null {
  if (!s) return null;
  const [, mm, dd] = s.split("-");
  if (!mm || !dd) return null;
  return Number(mm) * 100 + Number(dd);
}

function timeChip(rule: PricingRule, t: OwnerT): string | null {
  const parts: string[] = [];
  if (rule.applicable_dow && rule.applicable_dow.length > 0 && rule.applicable_dow.length < 7) {
    parts.push(rule.applicable_dow.map((d) => t(`dow.${DOW_LABELS[d].label}`, DOW_LABELS[d].label)).join("/"));
  }
  if (rule.season_start_mmdd != null && rule.season_end_mmdd != null) {
    const fmt = (m: number) =>
      `${String(Math.floor(m / 100)).padStart(2, "0")}-${String(m % 100).padStart(2, "0")}`;
    parts.push(`${fmt(rule.season_start_mmdd)}→${fmt(rule.season_end_mmdd)}`);
  }
  if (rule.lead_time_min_days != null || rule.lead_time_max_days != null) {
    const lo = rule.lead_time_min_days ?? 0;
    const hi = rule.lead_time_max_days ?? "∞";
    parts.push(t("leadChip", "lead {{lo}}–{{hi}}d", { lo, hi }));
  }
  return parts.length ? parts.join(" · ") : null;
}

function adjLabel(rule: PricingRule, t: OwnerT) {
  if (rule.adjustment_type === "increase_pct") return `+${rule.adjustment_value}%`;
  if (rule.adjustment_type === "decrease_pct") return `-${rule.adjustment_value}%`;
  return t("adjFixed", "Fixed {{amount}}", { amount: formatINR(rule.adjustment_value) });
}

function occupancyRange(rule: PricingRule) {
  return `${rule.occupancy_min_pct}% – ${
    rule.occupancy_max_pct != null ? rule.occupancy_max_pct + "%" : "∞"
  }`;
}

export default function OwnerPricingRules() {
  const t = useOwnerT("owner-pricing-rules");
  const tc = useOwnerCommonT();
  const { slug } = useParams<{ slug: string }>();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [roomTypes, setRoomTypes] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingUpdatedAt, setEditingUpdatedAt] = useState<string | null>(null);
  const [form, setForm] = useState<PricingRuleFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PricingRule | null>(null);
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

      const [r, rt] = await Promise.all([
        listPricingRules(hotelRow.id),
        listRoomTypes(hotelRow.id),
      ]);
      setRules(r);
      setRoomTypes(rt);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("loadFailed", "Failed to load."));
    } finally {
      setLoading(false);
    }
  }, [slug, t]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditingId(null);
    setEditingUpdatedAt(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(rule: PricingRule) {
    setEditingId(rule.id);
    setEditingUpdatedAt(rule.updated_at);
    setForm({
      rule_name: rule.rule_name,
      active: rule.active,
      scope_type: rule.scope_type,
      room_type_id: rule.room_type_id,
      occupancy_min_pct: rule.occupancy_min_pct,
      occupancy_max_pct: rule.occupancy_max_pct,
      adjustment_type: rule.adjustment_type,
      adjustment_value: rule.adjustment_value,
      min_price: rule.min_price,
      max_price: rule.max_price,
      priority: rule.priority,
      applicable_dow: rule.applicable_dow,
      season_start_mmdd: rule.season_start_mmdd,
      season_end_mmdd: rule.season_end_mmdd,
      lead_time_min_days: rule.lead_time_min_days,
      lead_time_max_days: rule.lead_time_max_days,
    });
    setFormError(null);
    setShowForm(true);
  }

  function validateForm(f: PricingRuleFormData): string | null {
    if (!f.rule_name.trim()) return t("vName", "Rule name is required.");
    if (f.adjustment_value <= 0) return t("vAdjValue", "Adjustment value must be greater than 0.");
    if (f.occupancy_min_pct < 0 || f.occupancy_min_pct > 100)
      return t("vMinOcc", "Min occupancy must be between 0 and 100.");
    if (f.occupancy_max_pct != null) {
      if (f.occupancy_max_pct < 0 || f.occupancy_max_pct > 100)
        return t("vMaxOcc", "Max occupancy must be between 0 and 100.");
      if (f.occupancy_max_pct <= f.occupancy_min_pct)
        return t("vMaxGtMin", "Max occupancy must be greater than min occupancy.");
    }
    if (f.min_price != null && f.min_price < 0) return t("vMinPriceNeg", "Min price cannot be negative.");
    if (f.max_price != null && f.max_price < 0) return t("vMaxPriceNeg", "Max price cannot be negative.");
    if (f.min_price != null && f.max_price != null && f.max_price < f.min_price)
      return t("vMaxPriceGteMin", "Max price must be greater than or equal to min price.");
    if (f.scope_type === "room_type" && !f.room_type_id)
      return t("vRoomType", "Pick a room type for room-type scoped rules.");
    const seasonStartSet = f.season_start_mmdd != null;
    const seasonEndSet = f.season_end_mmdd != null;
    if (seasonStartSet !== seasonEndSet)
      return t("vSeason", "Set both season start and end, or neither.");
    if (
      f.lead_time_min_days != null &&
      f.lead_time_max_days != null &&
      f.lead_time_max_days < f.lead_time_min_days
    )
      return t("vLeadTime", "Lead-time max must be greater than or equal to min.");
    if (f.priority < 1) return t("vPriority", "Priority must be 1 or greater.");
    return null;
  }

  async function handleSave() {
    if (!hotel) return;
    const err = validateForm(form);
    if (err) {
      setFormError(err);
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error(t("notAuthenticated", "Not authenticated."));

      if (editingId) {
        // Pass the original updated_at as the optimistic-concurrency token.
        await updatePricingRule(editingId, form, editingUpdatedAt ?? undefined);
      } else {
        await createPricingRule(hotel.id, user.id, form);
      }

      setShowForm(false);
      setEditingId(null);
      setEditingUpdatedAt(null);
      await load();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : t("saveFailed", "Save failed."));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(rule: PricingRule) {
    try {
      await updatePricingRule(rule.id, { active: !rule.active });
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, active: !r.active } : r)),
      );
    } catch {
      /* silent */
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setDeleteError(null);
    try {
      await deletePricingRule(id);
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e.message : t("deleteFailed", "Delete failed."));
      throw e;
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return <DarkLoading message={t("loading", "Loading rules…")} />;
  if (error || !hotel) return <DarkErrorPanel message={error ?? t("hotelNotFound", "Hotel not found.")} />;

  const base = `/owner/${slug}`;

  return (
    <OwnerDarkPage
      icon={TrendingUp}
      title={t("title", "Pricing")}
      titleAccent={t("titleAccent", "Rules")}
      accent="indigo"
      subtitle={`${t("rulesCount", "{{count}} rules", { count: rules.length })} · ${hotel.name}`}
      breadcrumbs={[
        { label: tc("nav.dashboard", "Dashboard"), to: base },
        { label: t("crumbPricing", "Pricing"), to: `${base}/pricing` },
        { label: t("crumbRules", "Rules") },
      ]}
      actions={
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 px-4 py-2 text-sm font-bold text-white transition shadow-lg shadow-indigo-500/20"
        >
          <Plus className="w-4 h-4" /> {t("addRule", "Add Rule")}
        </button>
      }
    >
      {showForm && (
        <DarkModal
          title={editingId ? t("editRule", "Edit Rule") : t("newRule", "New Pricing Rule")}
          onClose={() => setShowForm(false)}
        >
          <div className="space-y-4">
            <DarkField label={t("fieldRuleName", "Rule Name")}>
              <input
                className={darkInputCls}
                value={form.rule_name}
                onChange={(e) => setForm({ ...form, rule_name: e.target.value })}
                placeholder={t("ruleNamePlaceholder", "e.g. High-season surge")}
              />
            </DarkField>

            <div className="grid grid-cols-2 gap-3">
              <DarkField label={t("fieldMinOcc", "Min Occupancy (%)")}>
                <input
                  className={darkInputCls}
                  type="number"
                  min={0}
                  max={100}
                  value={form.occupancy_min_pct}
                  onChange={(e) => setForm({ ...form, occupancy_min_pct: Number(e.target.value) })}
                />
              </DarkField>
              <DarkField label={t("fieldMaxOcc", "Max Occupancy (%)")} hint={t("hintMaxOcc", "Blank = no upper limit")}>
                <input
                  className={darkInputCls}
                  type="number"
                  min={0}
                  max={100}
                  value={form.occupancy_max_pct ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      occupancy_max_pct: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </DarkField>
            </div>

            <DarkField label={t("fieldAdjType", "Adjustment Type")}>
              <select
                className={darkInputCls}
                value={form.adjustment_type}
                onChange={(e) =>
                  setForm({
                    ...form,
                    adjustment_type: e.target.value as PricingRuleFormData["adjustment_type"],
                  })
                }
              >
                <option value="increase_pct" style={darkOptionStyle}>{t("adjIncrease", "Increase by %")}</option>
                <option value="decrease_pct" style={darkOptionStyle}>{t("adjDecrease", "Decrease by %")}</option>
                <option value="set_fixed_price" style={darkOptionStyle}>{t("adjSetFixed", "Set Fixed Price (₹)")}</option>
              </select>
            </DarkField>

            <DarkField
              label={
                form.adjustment_type === "set_fixed_price"
                  ? t("fieldFixedPrice", "Fixed Price (₹)")
                  : t("fieldAdjValue", "Adjustment Value (%)")
              }
            >
              <input
                className={darkInputCls}
                type="number"
                min={0}
                value={form.adjustment_value}
                onChange={(e) => setForm({ ...form, adjustment_value: Number(e.target.value) })}
              />
            </DarkField>

            <div className="grid grid-cols-2 gap-3">
              <DarkField label={t("fieldMinPrice", "Min Price (₹)")} hint={t("hintMinPrice", "Optional floor")}>
                <input
                  className={darkInputCls}
                  type="number"
                  min={0}
                  value={form.min_price ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, min_price: e.target.value ? Number(e.target.value) : null })
                  }
                />
              </DarkField>
              <DarkField label={t("fieldMaxPrice", "Max Price (₹)")} hint={t("hintMaxPrice", "Optional ceiling")}>
                <input
                  className={darkInputCls}
                  type="number"
                  min={0}
                  value={form.max_price ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, max_price: e.target.value ? Number(e.target.value) : null })
                  }
                />
              </DarkField>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <DarkField label={t("fieldScope", "Scope")}>
                <select
                  className={darkInputCls}
                  value={form.scope_type}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      scope_type: e.target.value as "property" | "room_type",
                      room_type_id: null,
                    })
                  }
                >
                  <option value="property" style={darkOptionStyle}>{t("scopeWide", "Property-wide")}</option>
                  <option value="room_type" style={darkOptionStyle}>{t("scopeRoomType", "Room Type")}</option>
                </select>
              </DarkField>
              {form.scope_type === "room_type" && (
                <DarkField label={t("fieldRoomType", "Room Type")}>
                  <select
                    className={darkInputCls}
                    value={form.room_type_id ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, room_type_id: e.target.value || null })
                    }
                  >
                    <option value="" style={darkOptionStyle}>{t("selectPlaceholder", "Select…")}</option>
                    {roomTypes.map((rt) => (
                      <option key={rt.id} value={rt.id} style={darkOptionStyle}>
                        {rt.name}
                      </option>
                    ))}
                  </select>
                </DarkField>
              )}
            </div>

            <DarkField label={t("fieldPriority", "Priority")} hint={t("hintPriority", "Lower number = evaluated first")}>
              <input
                className={darkInputCls}
                type="number"
                min={1}
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
              />
            </DarkField>

            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {t("timeConstraints", "Time constraints")} <span className="font-normal normal-case text-slate-500">{t("optional", "(optional)")}</span>
              </div>

              <DarkField label={t("fieldDaysOfWeek", "Days of Week")} hint={t("hintDaysOfWeek", "Leave all unchecked to match every day.")}>
                <div className="flex flex-wrap gap-2">
                  {DOW_LABELS.map(({ value, label }) => {
                    const selected = form.applicable_dow?.includes(value) ?? false;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          const current = form.applicable_dow ?? [];
                          const next = selected
                            ? current.filter((d) => d !== value)
                            : [...current, value].sort((a, b) => a - b);
                          setForm({
                            ...form,
                            applicable_dow: next.length === 0 ? null : (next as PricingDow[]),
                          });
                        }}
                        className={
                          "rounded-lg px-2.5 py-1 text-xs font-semibold transition border " +
                          (selected
                            ? "border-indigo-500/50 bg-indigo-500/20 text-indigo-200"
                            : "border-white/10 bg-white/[0.02] text-slate-400 hover:text-slate-200")
                        }
                      >
                        {t(`dow.${label}`, label)}
                      </button>
                    );
                  })}
                </div>
              </DarkField>

              <div className="grid grid-cols-2 gap-3">
                <DarkField label={t("fieldSeasonStart", "Season Start")} hint={t("hintSeasonStart", "Year-agnostic (MM-DD)")}>
                  <input
                    className={darkInputCls}
                    type="date"
                    value={mmddToDateInput(form.season_start_mmdd)}
                    onChange={(e) =>
                      setForm({ ...form, season_start_mmdd: dateInputToMmdd(e.target.value) })
                    }
                  />
                </DarkField>
                <DarkField label={t("fieldSeasonEnd", "Season End")} hint={t("hintSeasonEnd", "Wraps across years if end < start")}>
                  <input
                    className={darkInputCls}
                    type="date"
                    value={mmddToDateInput(form.season_end_mmdd)}
                    onChange={(e) =>
                      setForm({ ...form, season_end_mmdd: dateInputToMmdd(e.target.value) })
                    }
                  />
                </DarkField>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <DarkField label={t("fieldLeadMin", "Lead-time Min (days)")} hint={t("hintLeadMin", "Days before stay; blank = no floor")}>
                  <input
                    className={darkInputCls}
                    type="number"
                    min={0}
                    value={form.lead_time_min_days ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        lead_time_min_days: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  />
                </DarkField>
                <DarkField label={t("fieldLeadMax", "Lead-time Max (days)")} hint={t("hintLeadMax", "Blank = no ceiling")}>
                  <input
                    className={darkInputCls}
                    type="number"
                    min={0}
                    value={form.lead_time_max_days ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        lead_time_max_days: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  />
                </DarkField>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
                className="rounded accent-indigo-500"
              />
              {t("active", "Active")}
            </label>
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
              {saving ? tc("actions.saving", "Saving…") : editingId ? t("saveChanges", "Save Changes") : t("createRule", "Create Rule")}
            </button>
          </div>
        </DarkModal>
      )}

      {rules.length === 0 ? (
        <DarkCard className="text-center py-12 border-dashed border-2">
          <TrendingUp className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="font-bold text-slate-200">{t("emptyTitle", "No pricing rules yet")}</p>
          <p className="text-sm text-slate-500 mt-1 mb-4">
            {t("emptyBody", "Create your first rule to automatically adjust prices based on occupancy.")}
          </p>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 px-4 py-2 text-sm font-bold text-white transition shadow-lg shadow-indigo-500/20"
          >
            <Plus className="w-4 h-4" /> {t("createFirst", "Create First Rule")}
          </button>
        </DarkCard>
      ) : (
        <DarkCard padded={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#1a1c1e] border-b border-white/[0.05]">
                <tr>
                  {[
                    { k: "priority", label: t("colPriority", "Priority") },
                    { k: "rule", label: t("colRule", "Rule") },
                    { k: "occRange", label: t("colOccRange", "Occupancy Range") },
                    { k: "adjustment", label: t("colAdjustment", "Adjustment") },
                    { k: "scope", label: t("colScope", "Scope") },
                    { k: "active", label: t("colActive", "Active") },
                    { k: "actions", label: t("colActions", "Actions") },
                  ].map(
                    (h) => (
                      <th
                        key={h.k}
                        className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400"
                      >
                        {h.label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {rules.map((rule) => (
                  <tr key={rule.id} className="hover:bg-white/[0.02] transition">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{rule.priority}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-white">{rule.rule_name}</div>
                      {timeChip(rule, t) && (
                        <div className="mt-0.5 text-[11px] text-slate-500">{timeChip(rule, t)}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-300 tabular-nums">{occupancyRange(rule)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-xs font-semibold " +
                          (rule.adjustment_type === "increase_pct"
                            ? "bg-emerald-500/15 text-emerald-300"
                            : rule.adjustment_type === "decrease_pct"
                            ? "bg-rose-500/15 text-rose-300"
                            : "bg-indigo-500/15 text-indigo-300")
                        }
                      >
                        {adjLabel(rule, t)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 capitalize">{t(`scopeType.${rule.scope_type}`, rule.scope_type)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleActive(rule)}
                        title={rule.active ? t("deactivate", "Deactivate") : t("activate", "Activate")}
                        className="text-slate-500 hover:text-indigo-400 transition"
                      >
                        {rule.active ? (
                          <ToggleRight className="w-5 h-5 text-indigo-400" />
                        ) : (
                          <ToggleLeft className="w-5 h-5" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(rule)}
                          className="text-slate-400 hover:text-indigo-400 transition"
                          aria-label={t("editRuleAria", "Edit rule")}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(rule)}
                          disabled={deletingId === rule.id}
                          className="text-slate-400 hover:text-rose-400 transition disabled:opacity-40"
                          aria-label={t("deleteRuleAria", "Delete rule")}
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
        </DarkCard>
      )}

      {confirmDelete && (
        <DarkConfirmModal
          title={t("deleteRuleTitle", "Delete pricing rule")}
          message={
            <>
              <p>
                {t("deleteMsgPrefix", "Delete rule")} <span className="font-semibold text-white">"{confirmDelete.rule_name}"</span>{t("deleteMsgSuffix", "? This cannot be undone. Historical change-log entries referencing this rule stay intact.")}
              </p>
              {deleteError && (
                <p className="mt-3 text-sm text-rose-300">{deleteError}</p>
              )}
            </>
          }
          confirmLabel={t("deleteRuleConfirm", "Delete rule")}
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
              /* stay open — error already surfaced in deleteError */
            }
          }}
        />
      )}
    </OwnerDarkPage>
  );
}
