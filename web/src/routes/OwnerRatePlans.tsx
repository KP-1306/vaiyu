// web/src/routes/OwnerRatePlans.tsx
// VAiyu Phase 1 – Rate plans CRUD (BAR, Corporate, Peak Season, etc.)

import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  Plus,
  Pencil,
  Trash2,
  Layers,
  ChevronRight,
  Star,
  CircleDot,
} from "lucide-react";
import {
  listRatePlans,
  createRatePlan,
  createRatePlanWithPrices,
  updateRatePlan,
  deleteRatePlan,
} from "../services/rateService";
import { listRoomTypes } from "../services/pricingService";
import type { ChannelScope, MealCode, RatePlan, RatePlanFormData } from "../types/rate";
import { CHANNEL_SCOPE_LABELS, MEAL_CODE_LABELS } from "../types/rate";
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

type Hotel = { id: string; slug: string; name: string };

const EMPTY_FORM: RatePlanFormData = {
  name: "",
  plan_code: null,
  description: null,
  meal_code: "EP",
  cancellation_policy: null,
  refundable: true,
  channel_scope: "all",
  priority: 100,
  is_default: false,
  min_advance_days: null,
  max_advance_days: null,
};

export default function OwnerRatePlans() {
  const { slug } = useParams<{ slug: string }>();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [plans, setPlans] = useState<RatePlan[]>([]);
  const [roomTypes, setRoomTypes] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingUpdatedAt, setEditingUpdatedAt] = useState<string | null>(null);
  const [form, setForm] = useState<RatePlanFormData>(EMPTY_FORM);
  // Per-room-type prices captured during creation (only for first/default
  // plans — power users with multiple plans bypass this and use the
  // calendar / per-plan pricing screen).
  const [inlinePrices, setInlinePrices] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RatePlan | null>(null);
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
        setError(hErr?.message ?? "Hotel not found.");
        return;
      }
      setHotel(hotelRow as Hotel);
      const [p, rt] = await Promise.all([
        listRatePlans(hotelRow.id),
        listRoomTypes(hotelRow.id),
      ]);
      setPlans(p);
      setRoomTypes(rt);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditingId(null);
    setEditingUpdatedAt(null);
    setForm({ ...EMPTY_FORM, is_default: plans.length === 0 });
    setInlinePrices({});
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(plan: RatePlan) {
    setEditingId(plan.id);
    setEditingUpdatedAt(plan.updated_at);
    setInlinePrices({}); // editing path doesn't touch prices
    setForm({
      name: plan.name,
      plan_code: plan.plan_code,
      description: plan.description,
      meal_code: plan.meal_code,
      cancellation_policy: plan.cancellation_policy,
      refundable: plan.refundable,
      channel_scope: plan.channel_scope,
      priority: plan.priority,
      is_default: plan.is_default,
      min_advance_days: plan.min_advance_days,
      max_advance_days: plan.max_advance_days,
    });
    setFormError(null);
    setShowForm(true);
  }

  function validate(f: RatePlanFormData): string | null {
    if (!f.name.trim()) return "Plan name is required.";
    if (f.priority < 1) return "Priority must be 1 or greater.";
    if (f.plan_code && !/^[A-Z0-9_-]{2,16}$/.test(f.plan_code))
      return "Plan code: 2–16 chars, uppercase letters, digits, _ or -.";
    if (f.min_advance_days != null && f.min_advance_days < 0)
      return "Min advance days cannot be negative.";
    if (f.max_advance_days != null && f.max_advance_days < 0)
      return "Max advance days cannot be negative.";
    if (
      f.min_advance_days != null &&
      f.max_advance_days != null &&
      f.max_advance_days < f.min_advance_days
    )
      return "Max advance days must be ≥ min.";
    return null;
  }

  async function handleSave() {
    if (!hotel) return;
    const err = validate(form);
    if (err) {
      setFormError(err);
      return;
    }

    // Validate any non-empty inline price inputs.
    const priceRows: Array<{ room_type_id: string; price: number }> = [];
    for (const rt of roomTypes) {
      const raw = inlinePrices[rt.id];
      if (raw === undefined || raw.trim() === "") continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        setFormError(`Price for ${rt.name} must be 0 or greater.`);
        return;
      }
      if (n > 0) priceRows.push({ room_type_id: rt.id, price: n });
    }

    setSaving(true);
    setFormError(null);
    try {
      if (editingId) {
        await updateRatePlan(editingId, hotel.id, form, editingUpdatedAt ?? undefined);
      } else if (priceRows.length > 0) {
        // Create plan + prices in one shot, with rollback on partial failure.
        await createRatePlanWithPrices(hotel.id, form, priceRows);
      } else {
        await createRatePlan(hotel.id, form);
      }
      setShowForm(false);
      setEditingId(null);
      setEditingUpdatedAt(null);
      setInlinePrices({});
      await load();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setDeleteError(null);
    try {
      await deleteRatePlan(id);
      setPlans((prev) => prev.filter((p) => p.id !== id));
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e.message : "Delete failed.");
      throw e;
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return <DarkLoading message="Loading rate plans…" />;
  if (error || !hotel) return <DarkErrorPanel message={error ?? "Hotel not found."} />;

  const base = `/owner/${slug}`;

  return (
    <OwnerDarkPage
      icon={Layers}
      title="Rate"
      titleAccent="Plans"
      accent="indigo"
      subtitle={`${plans.length} plan${plans.length === 1 ? "" : "s"} · ${hotel.name}`}
      breadcrumbs={[
        { label: "Dashboard", to: base },
        { label: "Pricing", to: `${base}/pricing` },
        { label: "Rate Plans" },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <Link
            to={`${base}/pricing/calendar`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 text-sm font-semibold text-slate-200 transition"
          >
            Open Calendar <ChevronRight className="w-3.5 h-3.5" />
          </Link>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 px-4 py-2 text-sm font-bold text-white transition shadow-lg shadow-indigo-500/20"
          >
            <Plus className="w-4 h-4" /> Add Rate Plan
          </button>
        </div>
      }
    >
      {showForm && (
        <DarkModal
          title={editingId ? "Edit Rate Plan" : "New Rate Plan"}
          onClose={() => setShowForm(false)}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-[1fr_160px] gap-3">
              <DarkField label="Plan Name">
                <input
                  className={darkInputCls}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. BAR, Corporate, Peak Season"
                />
              </DarkField>
              <DarkField label="Plan Code" hint="Optional short code">
                <input
                  className={darkInputCls + " font-mono"}
                  value={form.plan_code ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      plan_code: e.target.value ? e.target.value.toUpperCase() : null,
                    })
                  }
                  placeholder="BAR"
                />
              </DarkField>
            </div>

            <DarkField label="Description" hint="Optional – shown to staff only">
              <input
                className={darkInputCls}
                value={form.description ?? ""}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value || null })
                }
                placeholder="Best available rate for direct bookings"
              />
            </DarkField>

            <div className="grid grid-cols-2 gap-3">
              <DarkField label="Meal Plan">
                <select
                  className={darkInputCls}
                  value={form.meal_code ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      meal_code: (e.target.value || null) as MealCode | null,
                    })
                  }
                >
                  <option value="">— None —</option>
                  {(Object.keys(MEAL_CODE_LABELS) as MealCode[]).map((k) => (
                    <option key={k} value={k}>
                      {MEAL_CODE_LABELS[k]}
                    </option>
                  ))}
                </select>
              </DarkField>
              <DarkField label="Channel">
                <select
                  className={darkInputCls}
                  value={form.channel_scope}
                  onChange={(e) =>
                    setForm({ ...form, channel_scope: e.target.value as ChannelScope })
                  }
                >
                  {(Object.keys(CHANNEL_SCOPE_LABELS) as ChannelScope[]).map((k) => (
                    <option key={k} value={k}>
                      {CHANNEL_SCOPE_LABELS[k]}
                    </option>
                  ))}
                </select>
              </DarkField>
            </div>

            <DarkField label="Cancellation Policy" hint="Shown on confirmation emails">
              <input
                className={darkInputCls}
                value={form.cancellation_policy ?? ""}
                onChange={(e) =>
                  setForm({ ...form, cancellation_policy: e.target.value || null })
                }
                placeholder="Free cancellation up to 24h before check-in"
              />
            </DarkField>

            <div className="grid grid-cols-3 gap-3">
              <DarkField label="Priority" hint="Higher wins on overlap">
                <input
                  className={darkInputCls}
                  type="number"
                  min={1}
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                />
              </DarkField>
              <DarkField label="Min Advance (days)" hint="Blank = no floor">
                <input
                  className={darkInputCls}
                  type="number"
                  min={0}
                  value={form.min_advance_days ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      min_advance_days: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </DarkField>
              <DarkField label="Max Advance (days)" hint="Blank = no ceiling">
                <input
                  className={darkInputCls}
                  type="number"
                  min={0}
                  value={form.max_advance_days ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      max_advance_days: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </DarkField>
            </div>

            <div className="flex flex-wrap gap-4 pt-2">
              <label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.refundable}
                  onChange={(e) => setForm({ ...form, refundable: e.target.checked })}
                  className="rounded accent-indigo-500"
                />
                Refundable
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_default}
                  onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
                  className="rounded accent-indigo-500"
                />
                Default plan
                <span className="text-xs text-slate-500">
                  (used when no other plan matches)
                </span>
              </label>
            </div>

            {/* Inline per-room-type pricing: only on create, only if room types exist.
                The plan has no room_type column — these inputs go to rate_plan_prices. */}
            {!editingId && roomTypes.length > 0 && (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3 mt-2">
                <div className="space-y-1">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                    Set base prices
                    <span className="ml-1 font-normal normal-case text-slate-500">
                      (optional — refine later in Calendar)
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Enter a per-night price for each room type under this plan.
                    Leave blank to skip and add prices on the Calendar.
                  </p>
                </div>
                <div className="space-y-2">
                  {roomTypes.map((rt) => (
                    <div
                      key={rt.id}
                      className="flex items-center gap-3 rounded-lg bg-white/[0.02] border border-white/[0.04] px-3 py-2"
                    >
                      <span className="flex-1 text-sm font-semibold text-slate-100">
                        {rt.name}
                      </span>
                      <span className="text-slate-500 text-sm">₹</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={inlinePrices[rt.id] ?? ""}
                        onChange={(e) =>
                          setInlinePrices((prev) => ({
                            ...prev,
                            [rt.id]: e.target.value,
                          }))
                        }
                        placeholder="—"
                        className="w-28 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-indigo-400/50"
                      />
                      <span className="text-[10px] uppercase tracking-wider text-slate-500">
                        /night
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {formError && <p className="mt-3 text-sm text-rose-300">{formError}</p>}

          <div className="mt-6 flex gap-3 justify-end">
            <button
              onClick={() => setShowForm(false)}
              className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-xl bg-indigo-500 hover:bg-indigo-600 px-5 py-2 text-sm font-bold text-white transition disabled:opacity-60 shadow-lg shadow-indigo-500/20"
            >
              {saving ? "Saving…" : editingId ? "Save Changes" : "Create Plan"}
            </button>
          </div>
        </DarkModal>
      )}

      {plans.length === 0 ? (
        <DarkCard className="text-center py-12 border-dashed border-2">
          <Layers className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="font-bold text-slate-200">No rate plans yet</p>
          <p className="text-sm text-slate-500 mt-1 mb-4">
            Start by creating a default BAR (Best Available Rate) plan. You can add
            corporate, seasonal, or OTA-specific plans later.
          </p>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 px-4 py-2 text-sm font-bold text-white transition shadow-lg shadow-indigo-500/20"
          >
            <Plus className="w-4 h-4" /> Create First Plan
          </button>
        </DarkCard>
      ) : (
        <DarkCard padded={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#1a1c1e] border-b border-white/[0.05]">
                <tr>
                  {["", "Plan", "Meal", "Channel", "Cancellation", "Priority", "Actions"].map(
                    (h, i) => (
                      <th
                        key={i}
                        className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {plans.map((plan) => (
                  <tr key={plan.id} className="hover:bg-white/[0.02] transition">
                    <td className="pl-4 py-3 w-8">
                      {plan.is_default ? (
                        <Star
                          className="w-4 h-4 text-amber-400 fill-amber-400"
                          aria-label="Default plan"
                        />
                      ) : (
                        <CircleDot className="w-4 h-4 text-slate-700" />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">{plan.name}</span>
                        {plan.plan_code && (
                          <span className="font-mono text-[11px] text-slate-500 bg-white/[0.04] rounded px-1.5 py-0.5">
                            {plan.plan_code}
                          </span>
                        )}
                        {!plan.refundable && (
                          <span className="rounded-full bg-rose-500/15 text-rose-300 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                            Non-refundable
                          </span>
                        )}
                      </div>
                      {plan.description && (
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {plan.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {plan.meal_code ? (
                        <span className="rounded-full bg-emerald-500/10 text-emerald-300 px-2 py-0.5 text-[11px] font-semibold">
                          {plan.meal_code}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs capitalize">
                      {plan.channel_scope === "all" ? "All" : plan.channel_scope}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs max-w-xs truncate">
                      {plan.cancellation_policy || (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {plan.priority}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`${base}/pricing/plans/${plan.id}`}
                          className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-semibold"
                        >
                          Prices <ChevronRight className="w-3 h-3" />
                        </Link>
                        <button
                          onClick={() => openEdit(plan)}
                          className="text-slate-400 hover:text-indigo-400 transition"
                          aria-label="Edit plan"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(plan)}
                          disabled={deletingId === plan.id}
                          className="text-slate-400 hover:text-rose-400 transition disabled:opacity-40"
                          aria-label="Delete plan"
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
          title="Delete rate plan"
          message={
            <>
              <p>
                Delete rate plan{" "}
                <span className="font-semibold text-white">
                  "{confirmDelete.name}"
                </span>
                ? All prices under this plan become inactive. Historical bookings
                referencing this plan stay intact.
              </p>
              {deleteError && <p className="mt-3 text-sm text-rose-300">{deleteError}</p>}
            </>
          }
          confirmLabel="Delete plan"
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
