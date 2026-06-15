// web/src/routes/OwnerRateCalendar.tsx
// VAiyu Phase 1 – Rate Calendar: spreadsheet view of room types × next N days.
// Client-side price resolver mirrors the SQL `get_effective_room_price`
// function so the grid renders without round-tripping per cell.

import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Pencil,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
  listRatePlans,
  listPlanPrices,
  upsertPlanPrice,
  deletePlanPrice,
  listRestrictions,
  upsertRestriction,
  deleteRestriction,
} from "../services/rateService";
import { listRoomTypes } from "../services/pricingService";
import type { RatePlan, RatePlanPrice, RateRestriction } from "../types/rate";
import { DOW_ALL_DAYS, DOW_LABELS, DOW_WEEKDAYS, DOW_WEEKENDS } from "../types/rate";
import { Ban, ShieldAlert, Clock } from "lucide-react";
import { formatINR } from "../lib/currency";
import {
  OwnerDarkPage,
  DarkCard,
  DarkLoading,
  DarkErrorPanel,
  DarkModal,
  DarkField,
  darkInputCls,
} from "../components/owner/DarkShell";

type Hotel = { id: string; slug: string; name: string };
type RoomType = { id: string; name: string };

const WINDOW_DAYS = 30;
// Bulk-edit "apply as" options map to rate_plan_prices.priority levels.
// Higher priority wins in the effective-price resolver.
const PRIORITY_OVERRIDE = 200;
const PRIORITY_BASE = 100;

// ─── Calendar helpers ──────────────────────────────────────

// Format Date → "YYYY-MM-DD" using LOCAL time. The whole calendar is
// date-only (no hours); stay out of UTC so "today" matches the user's wall
// clock.
function fmtYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d: Date, n: number): Date {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n);
  return nd;
}

// Apply effective-price logic client-side. Mirrors
// public.get_effective_room_price — pricing_current_rates overrides (handled
// server-side) aren't shown on the calendar because this screen edits the
// base-rate layer; the engine's dynamic layer sits on top and is visualized
// separately on OwnerPricing.
function resolveCellPrice(
  rows: RatePlanPrice[],
  roomTypeId: string,
  date: Date,
): { price: number; row: RatePlanPrice } | null {
  const ymd = fmtYmd(date);
  const dowBit = 1 << date.getDay(); // JS: 0=Sun matches our bit 0.

  let best: RatePlanPrice | null = null;
  for (const r of rows) {
    if (r.room_type_id !== roomTypeId) continue;
    if (r.valid_from && r.valid_from > ymd) continue;
    if (r.valid_to && r.valid_to < ymd) continue;
    if ((r.dow_mask & dowBit) === 0) continue;
    if (!best) {
      best = r;
      continue;
    }
    // priority DESC, then updated_at DESC — matches SQL ORDER BY in the
    // resolver function.
    if (r.priority > best.priority) best = r;
    else if (r.priority === best.priority && r.updated_at > best.updated_at) best = r;
  }
  return best ? { price: Number(best.price), row: best } : null;
}

// ─── Component ─────────────────────────────────────────────

export default function OwnerRateCalendar() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [plans, setPlans] = useState<RatePlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [prices, setPrices] = useState<RatePlanPrice[]>([]);
  // Restrictions are plan-agnostic (rate_restrictions.rate_plan_id is NULL
  // on rows set from the calendar), so we load them once per date window.
  const [restrictions, setRestrictions] = useState<RateRestriction[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Anchor date = leftmost visible column. Default = today.
  const todayYmd = fmtYmd(new Date());
  const [anchorYmd, setAnchorYmd] = useState<string>(
    searchParams.get("start") || todayYmd,
  );

  // Popover state (single-cell edit) — both price + restrictions live here.
  const [editingCell, setEditingCell] = useState<
    | {
        roomTypeId: string;
        date: string;
        existing: RatePlanPrice | null;
        restriction: RateRestriction | null;
      }
    | null
  >(null);
  const [cellPriceInput, setCellPriceInput] = useState<string>("");
  const [cellMinLos, setCellMinLos] = useState<string>("");
  const [cellStopSell, setCellStopSell] = useState<boolean>(false);
  const [cellCta, setCellCta] = useState<boolean>(false);
  const [cellCtd, setCellCtd] = useState<boolean>(false);
  const [cellSaving, setCellSaving] = useState(false);
  const [cellError, setCellError] = useState<string | null>(null);

  // Bulk edit state
  const [showBulk, setShowBulk] = useState(false);
  const [bulkFrom, setBulkFrom] = useState<string>(todayYmd);
  const [bulkTo, setBulkTo] = useState<string>(fmtYmd(addDays(new Date(), 6)));
  const [bulkRoomTypes, setBulkRoomTypes] = useState<Set<string>>(new Set());
  const [bulkPrice, setBulkPrice] = useState<string>("");
  const [bulkDowMask, setBulkDowMask] = useState<number>(DOW_ALL_DAYS);
  const [bulkPriority, setBulkPriority] = useState<number>(PRIORITY_BASE);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // ─── Initial load ────────────────────────────────────────
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

      const [rt, pls] = await Promise.all([
        listRoomTypes(hotelRow.id),
        listRatePlans(hotelRow.id),
      ]);
      setRoomTypes(rt);
      setPlans(pls);

      // Pick initial plan: from URL, else default, else first.
      const urlPlan = searchParams.get("plan");
      const defaultPlan = pls.find((p) => p.is_default)?.id;
      const pick = urlPlan && pls.some((p) => p.id === urlPlan)
        ? urlPlan
        : defaultPlan ?? pls[0]?.id ?? "";
      setSelectedPlanId(pick);

      // Fetch restrictions for the visible window (plus a little headroom so
      // scrolling forward doesn't briefly show stale state before reload).
      const windowEnd = fmtYmd(
        addDays(parseYmd(searchParams.get("start") || todayYmd), WINDOW_DAYS * 2),
      );
      const [pp, rr] = await Promise.all([
        pick ? listPlanPrices(hotelRow.id, pick) : Promise.resolve([]),
        listRestrictions(hotelRow.id, searchParams.get("start") || todayYmd, windowEnd),
      ]);
      setPrices(pp);
      setRestrictions(rr);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [slug, searchParams, todayYmd]);

  useEffect(() => {
    load();
  }, [load]);

  // Reload prices (and restrictions) without a full page load.
  const reloadPrices = useCallback(
    async (planId: string) => {
      if (!hotel) return;
      setReloading(true);
      try {
        const windowEnd = fmtYmd(addDays(parseYmd(anchorYmd), WINDOW_DAYS * 2));
        const [pp, rr] = await Promise.all([
          planId ? listPlanPrices(hotel.id, planId) : Promise.resolve([]),
          listRestrictions(hotel.id, anchorYmd, windowEnd),
        ]);
        setPrices(pp);
        setRestrictions(rr);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to reload.");
      } finally {
        setReloading(false);
      }
    },
    [hotel, anchorYmd],
  );

  function handlePlanChange(nextId: string) {
    setSelectedPlanId(nextId);
    const next = new URLSearchParams(searchParams);
    next.set("plan", nextId);
    setSearchParams(next, { replace: true });
    reloadPrices(nextId);
  }

  function shiftAnchor(deltaDays: number) {
    const next = fmtYmd(addDays(parseYmd(anchorYmd), deltaDays));
    setAnchorYmd(next);
    const sp = new URLSearchParams(searchParams);
    sp.set("start", next);
    setSearchParams(sp, { replace: true });
  }

  // ─── Derived: visible dates + price grid ─────────────────
  const visibleDates = useMemo(() => {
    const start = parseYmd(anchorYmd);
    return Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(start, i));
  }, [anchorYmd]);

  const priceGrid = useMemo(() => {
    // Map: roomTypeId → ymd → resolved cell
    const out: Record<string, Record<string, { price: number; row: RatePlanPrice } | null>> = {};
    for (const rt of roomTypes) {
      out[rt.id] = {};
      for (const d of visibleDates) {
        out[rt.id][fmtYmd(d)] = resolveCellPrice(prices, rt.id, d);
      }
    }
    return out;
  }, [roomTypes, visibleDates, prices]);

  // Price band thresholds per room type (low/mid/high colouring).
  const priceBands = useMemo(() => {
    const bands: Record<string, { min: number; max: number }> = {};
    for (const rt of roomTypes) {
      const values: number[] = [];
      for (const d of visibleDates) {
        const c = priceGrid[rt.id]?.[fmtYmd(d)];
        if (c) values.push(c.price);
      }
      if (values.length === 0) continue;
      values.sort((a, b) => a - b);
      bands[rt.id] = { min: values[0], max: values[values.length - 1] };
    }
    return bands;
  }, [roomTypes, visibleDates, priceGrid]);

  // Restriction lookup for a (room_type, date). Prefers per-room-type rows
  // over property-wide (room_type_id IS NULL) rows when both exist.
  function lookupRestriction(
    roomTypeId: string,
    date: string,
  ): RateRestriction | null {
    const perType = restrictions.find(
      (r) => r.room_type_id === roomTypeId && r.date === date,
    );
    if (perType) return perType;
    const propertyWide = restrictions.find(
      (r) => r.room_type_id === null && r.date === date,
    );
    return propertyWide ?? null;
  }

  // ─── Cell click → popover ────────────────────────────────
  function openCellEditor(roomTypeId: string, date: string) {
    const existing = priceGrid[roomTypeId]?.[date];
    const r = lookupRestriction(roomTypeId, date);
    setEditingCell({
      roomTypeId,
      date,
      existing: existing?.row ?? null,
      restriction: r,
    });
    setCellPriceInput(existing ? String(existing.price) : "");
    setCellMinLos(r?.min_los != null ? String(r.min_los) : "");
    setCellStopSell(!!r?.stop_sell);
    setCellCta(!!r?.closed_to_arrival);
    setCellCtd(!!r?.closed_to_departure);
    setCellError(null);
  }

  function closeCellEditor() {
    setEditingCell(null);
    setCellError(null);
  }

  async function saveCellPrice() {
    if (!editingCell || !hotel) return;

    // Price is optional — the editor also manages restrictions. Only validate
    // the price field when the user typed something into it.
    const priceTouched = cellPriceInput.trim() !== "";
    const price = priceTouched ? Number(cellPriceInput) : null;
    if (priceTouched && (!(price! >= 0) || Number.isNaN(price))) {
      setCellError("Price must be 0 or greater.");
      return;
    }
    const minLosParsed = cellMinLos.trim() === "" ? null : Number(cellMinLos);
    if (minLosParsed != null && (!(minLosParsed >= 1) || Number.isNaN(minLosParsed))) {
      setCellError("Min LOS must be 1 or greater.");
      return;
    }

    setCellSaving(true);
    setCellError(null);
    try {
      const { roomTypeId, date, existing, restriction } = editingCell;

      // ── Price upsert (only if price changed / was explicitly typed) ──
      if (priceTouched && price != null && selectedPlanId) {
        const isSingleDayRow =
          existing &&
          existing.valid_from === date &&
          existing.valid_to === date;

        if (isSingleDayRow) {
          await upsertPlanPrice(hotel.id, {
            id: existing.id,
            rate_plan_id: existing.rate_plan_id,
            room_type_id: existing.room_type_id,
            price,
            valid_from: existing.valid_from,
            valid_to: existing.valid_to,
            dow_mask: existing.dow_mask,
            priority: existing.priority,
            notes: existing.notes,
          });
        } else {
          await upsertPlanPrice(hotel.id, {
            rate_plan_id: selectedPlanId,
            room_type_id: roomTypeId,
            price,
            valid_from: date,
            valid_to: date,
            dow_mask: DOW_ALL_DAYS,
            priority: PRIORITY_OVERRIDE,
            notes: "Calendar cell override",
          });
        }
      }

      // ── Restriction upsert / delete ──
      // If all restriction fields are empty/false and a row exists → delete.
      // Otherwise upsert.
      const hasAnyRestriction =
        minLosParsed != null || cellStopSell || cellCta || cellCtd;
      if (!hasAnyRestriction && restriction) {
        await deleteRestriction(restriction.id);
      } else if (hasAnyRestriction) {
        await upsertRestriction(hotel.id, {
          id: restriction?.id,
          rate_plan_id: null, // plan-agnostic from the calendar
          room_type_id: roomTypeId,
          date,
          min_los: minLosParsed,
          max_los: null,
          closed_to_arrival: cellCta,
          closed_to_departure: cellCtd,
          stop_sell: cellStopSell,
        });
      }

      closeCellEditor();
      await reloadPrices(selectedPlanId);
    } catch (e: unknown) {
      setCellError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setCellSaving(false);
    }
  }

  async function deleteCellOverride() {
    if (!editingCell?.existing || !selectedPlanId) return;
    setCellSaving(true);
    setCellError(null);
    try {
      await deletePlanPrice(editingCell.existing.id);
      closeCellEditor();
      await reloadPrices(selectedPlanId);
    } catch (e: unknown) {
      setCellError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setCellSaving(false);
    }
  }

  // ─── Bulk edit ───────────────────────────────────────────
  function openBulk() {
    setBulkFrom(anchorYmd);
    setBulkTo(fmtYmd(addDays(parseYmd(anchorYmd), 6)));
    setBulkRoomTypes(new Set(roomTypes.map((r) => r.id)));
    setBulkPrice("");
    setBulkDowMask(DOW_ALL_DAYS);
    setBulkPriority(PRIORITY_BASE);
    setBulkError(null);
    setShowBulk(true);
  }

  async function submitBulk() {
    if (!hotel || !selectedPlanId) return;
    const price = Number(bulkPrice);
    if (!(price >= 0) || Number.isNaN(price)) {
      setBulkError("Price must be 0 or greater.");
      return;
    }
    if (bulkRoomTypes.size === 0) {
      setBulkError("Pick at least one room type.");
      return;
    }
    if (bulkFrom > bulkTo) {
      setBulkError("End date must be on or after start.");
      return;
    }
    if (bulkDowMask < 1) {
      setBulkError("Pick at least one day of the week.");
      return;
    }
    setBulkSaving(true);
    setBulkError(null);
    try {
      await Promise.all(
        Array.from(bulkRoomTypes).map((rtId) =>
          upsertPlanPrice(hotel.id, {
            rate_plan_id: selectedPlanId,
            room_type_id: rtId,
            price,
            valid_from: bulkFrom,
            valid_to: bulkTo,
            dow_mask: bulkDowMask,
            priority: bulkPriority,
            notes: "Bulk calendar edit",
          }),
        ),
      );
      setShowBulk(false);
      await reloadPrices(selectedPlanId);
    } catch (e: unknown) {
      setBulkError(e instanceof Error ? e.message : "Bulk save failed.");
    } finally {
      setBulkSaving(false);
    }
  }

  // ─── Render ──────────────────────────────────────────────
  if (loading) return <DarkLoading message="Loading calendar…" />;
  if (error || !hotel) return <DarkErrorPanel message={error ?? "Hotel not found."} />;

  const base = `/owner/${slug}`;
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;

  return (
    <OwnerDarkPage
      icon={CalendarDays}
      title="Rate"
      titleAccent="Calendar"
      accent="indigo"
      subtitle={
        selectedPlan
          ? `${selectedPlan.name} · ${roomTypes.length} room types × ${WINDOW_DAYS} days`
          : `${roomTypes.length} room types × ${WINDOW_DAYS} days`
      }
      breadcrumbs={[
        { label: "Dashboard", to: base },
        { label: "Pricing", to: `${base}/pricing` },
        { label: "Rate Calendar" },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <select
            value={selectedPlanId}
            onChange={(e) => handlePlanChange(e.target.value)}
            className={darkInputCls + " !py-2 !px-3 !text-sm min-w-[180px]"}
            disabled={plans.length === 0}
          >
            {plans.length === 0 ? (
              <option value="">— No rate plans —</option>
            ) : (
              plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.is_default ? " (default)" : ""}
                </option>
              ))
            )}
          </select>
          <button
            onClick={openBulk}
            disabled={!selectedPlanId || roomTypes.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 px-4 py-2 text-sm font-bold text-white transition shadow-lg shadow-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Pencil className="w-4 h-4" /> Bulk Edit
          </button>
        </div>
      }
    >
      {/* Empty-state short-circuits */}
      {plans.length === 0 ? (
        <DarkCard className="text-center py-12 border-dashed border-2">
          <CalendarDays className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="font-bold text-slate-200">No rate plans yet</p>
          <p className="text-sm text-slate-500 mt-1 mb-4">
            Create a rate plan first, then set prices on the calendar.
          </p>
          <Link
            to={`${base}/pricing/plans`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 px-4 py-2 text-sm font-bold text-white transition shadow-lg shadow-indigo-500/20"
          >
            Create Rate Plan <ArrowRight className="w-4 h-4" />
          </Link>
        </DarkCard>
      ) : roomTypes.length === 0 ? (
        <DarkCard className="text-center py-12 border-dashed border-2">
          <CalendarDays className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="font-bold text-slate-200">No room types configured</p>
          <p className="text-sm text-slate-500 mt-1">
            Add room types during hotel setup before pricing.
          </p>
        </DarkCard>
      ) : (
        <>
          {/* Navigation bar: date window */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => shiftAnchor(-WINDOW_DAYS)}
                className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 p-2 transition"
                aria-label="Previous window"
              >
                <ArrowLeft className="w-4 h-4 text-slate-300" />
              </button>
              <input
                type="date"
                value={anchorYmd}
                onChange={(e) => {
                  setAnchorYmd(e.target.value);
                  const sp = new URLSearchParams(searchParams);
                  sp.set("start", e.target.value);
                  setSearchParams(sp, { replace: true });
                }}
                className={darkInputCls + " !py-2 !px-3 !text-sm w-44"}
              />
              <button
                onClick={() => shiftAnchor(WINDOW_DAYS)}
                className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 p-2 transition"
                aria-label="Next window"
              >
                <ArrowRight className="w-4 h-4 text-slate-300" />
              </button>
              <button
                onClick={() => {
                  setAnchorYmd(todayYmd);
                  const sp = new URLSearchParams(searchParams);
                  sp.set("start", todayYmd);
                  setSearchParams(sp, { replace: true });
                }}
                className="ml-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 text-xs font-semibold text-slate-300 transition"
              >
                Today
              </button>
            </div>
            {reloading && (
              <span className="text-xs text-slate-500 animate-pulse">
                Refreshing…
              </span>
            )}
          </div>

          {/* The grid */}
          <DarkCard padded={false} className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-20 bg-[#1a1c1e] border-b border-r border-white/[0.06] text-left px-3 py-2 min-w-[160px] text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Room Type
                    </th>
                    {visibleDates.map((d) => {
                      const ymd = fmtYmd(d);
                      const dow = d.getDay();
                      const isWeekend = dow === 0 || dow === 6;
                      const isToday = ymd === todayYmd;
                      return (
                        <th
                          key={ymd}
                          className={
                            "border-b border-white/[0.06] px-2 py-2 text-center min-w-[70px] text-[11px] font-bold tracking-wider " +
                            (isToday
                              ? "bg-indigo-500/15 text-indigo-200"
                              : isWeekend
                              ? "bg-white/[0.03] text-amber-300/70"
                              : "bg-[#1a1c1e] text-slate-400")
                          }
                        >
                          <div className="text-[10px] uppercase">
                            {d.toLocaleDateString(undefined, { weekday: "short" })}
                          </div>
                          <div className="text-sm font-black">{d.getDate()}</div>
                          <div className="text-[9px] text-slate-500 uppercase">
                            {d.toLocaleDateString(undefined, { month: "short" })}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {roomTypes.map((rt) => {
                    const band = priceBands[rt.id];
                    return (
                      <tr key={rt.id}>
                        <td className="sticky left-0 z-10 bg-[#16181b] border-b border-r border-white/[0.06] px-3 py-2 font-semibold text-white whitespace-nowrap">
                          {rt.name}
                        </td>
                        {visibleDates.map((d) => {
                          const ymd = fmtYmd(d);
                          const dow = d.getDay();
                          const isWeekend = dow === 0 || dow === 6;
                          const isToday = ymd === todayYmd;
                          const cell = priceGrid[rt.id]?.[ymd];

                          // Band colour within the room type's visible range.
                          let bandCls = "";
                          if (cell && band && band.max > band.min) {
                            const rel = (cell.price - band.min) / (band.max - band.min);
                            if (rel > 0.66) bandCls = "text-emerald-300";
                            else if (rel < 0.34) bandCls = "text-rose-300";
                            else bandCls = "text-slate-200";
                          } else if (cell) {
                            bandCls = "text-slate-200";
                          }

                          const isOverride =
                            cell?.row &&
                            cell.row.valid_from === ymd &&
                            cell.row.valid_to === ymd;

                          const restriction = lookupRestriction(rt.id, ymd);
                          const hasStopSell = restriction?.stop_sell;
                          const hasCta = restriction?.closed_to_arrival;
                          const hasMinLos =
                            restriction?.min_los != null && restriction.min_los > 1;

                          return (
                            <td
                              key={ymd}
                              onClick={() => openCellEditor(rt.id, ymd)}
                              className={
                                "group border-b border-white/[0.04] text-center py-2 cursor-pointer hover:bg-indigo-500/10 transition relative " +
                                (hasStopSell
                                  ? "bg-rose-500/[0.08]"
                                  : isToday
                                  ? "bg-indigo-500/[0.06]"
                                  : isWeekend
                                  ? "bg-white/[0.015]"
                                  : "")
                              }
                            >
                              {cell ? (
                                <span
                                  className={
                                    "font-semibold text-sm " +
                                    (hasStopSell ? "line-through text-slate-600" : bandCls)
                                  }
                                >
                                  {formatINR(cell.price)}
                                </span>
                              ) : (
                                <span className="text-slate-700 text-xs">—</span>
                              )}
                              {/* Badge overlays: priority left→right */}
                              <div className="absolute top-1 right-1 flex gap-0.5">
                                {isOverride && (
                                  <span
                                    title="One-day override"
                                    className="w-1.5 h-1.5 rounded-full bg-amber-400"
                                  />
                                )}
                                {hasStopSell && (
                                  <span title="Stop-sell" className="text-rose-400">
                                    <Ban className="w-3 h-3" />
                                  </span>
                                )}
                                {!hasStopSell && hasCta && (
                                  <span title="Closed to arrival" className="text-amber-400">
                                    <ShieldAlert className="w-3 h-3" />
                                  </span>
                                )}
                                {!hasStopSell && hasMinLos && (
                                  <span
                                    title={`Min ${restriction!.min_los} nights`}
                                    className="text-sky-400 text-[9px] font-black leading-none"
                                  >
                                    {restriction!.min_los}N
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-4 px-4 py-2 border-t border-white/[0.05] bg-[#1a1c1e] text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400" /> Override
              </span>
              <span className="flex items-center gap-1.5 text-rose-400">
                <Ban className="w-3 h-3" /> Stop-sell
              </span>
              <span className="flex items-center gap-1.5 text-amber-400">
                <ShieldAlert className="w-3 h-3" /> Closed to arrival
              </span>
              <span className="flex items-center gap-1.5 text-sky-400">
                <span className="text-[10px] font-black">2N</span> Min stay
              </span>
              <span className="text-slate-600 normal-case">
                Click any cell to edit price & restrictions.
              </span>
            </div>
          </DarkCard>
        </>
      )}

      {/* ─── Cell editor (modal) — price + restrictions ── */}
      {editingCell && (
        <DarkModal
          title={`${
            roomTypes.find((r) => r.id === editingCell.roomTypeId)?.name ?? "Room"
          } · ${editingCell.date}`}
          onClose={closeCellEditor}
        >
          <div className="space-y-5">
            {/* Price section */}
            <div className="space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Price
              </div>
              <DarkField label="Price (₹ per night)" hint="Leave blank to keep current">
                <input
                  autoFocus
                  type="number"
                  min={0}
                  step={1}
                  value={cellPriceInput}
                  onChange={(e) => setCellPriceInput(e.target.value)}
                  className={darkInputCls}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveCellPrice();
                    if (e.key === "Escape") closeCellEditor();
                  }}
                />
              </DarkField>
              {editingCell.existing ? (
                <p className="text-xs text-slate-500">
                  Current row: {editingCell.existing.valid_from ?? "∞"} →{" "}
                  {editingCell.existing.valid_to ?? "∞"} · priority{" "}
                  {editingCell.existing.priority}
                  {editingCell.existing.notes
                    ? ` · ${editingCell.existing.notes}`
                    : ""}
                </p>
              ) : (
                <p className="text-xs text-slate-500">
                  A new price will be saved as a one-day override at priority{" "}
                  {PRIORITY_OVERRIDE}.
                </p>
              )}
            </div>

            {/* Restrictions section */}
            <div className="space-y-3 pt-4 border-t border-white/[0.06]">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                Restrictions
              </div>

              <DarkField
                label="Minimum stay (nights)"
                hint="Guests checking in this day must stay at least this many nights"
              >
                <input
                  type="number"
                  min={1}
                  value={cellMinLos}
                  onChange={(e) => setCellMinLos(e.target.value)}
                  className={darkInputCls}
                  placeholder="e.g. 2"
                />
              </DarkField>

              <div className="grid grid-cols-1 gap-2">
                <label
                  className={
                    "flex items-start gap-3 rounded-xl border border-white/[0.06] p-3 cursor-pointer transition " +
                    (cellStopSell
                      ? "bg-rose-500/10 border-rose-500/30"
                      : "bg-white/[0.02] hover:bg-white/[0.04]")
                  }
                >
                  <input
                    type="checkbox"
                    checked={cellStopSell}
                    onChange={(e) => setCellStopSell(e.target.checked)}
                    className="mt-0.5 rounded accent-rose-500"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Ban className="w-3.5 h-3.5 text-rose-400" />
                      <span className="font-semibold text-sm text-slate-100">
                        Stop-sell
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Hide this room type from walk-in availability on this date
                      (renovation, group blocks, overbooking cap).
                    </p>
                  </div>
                </label>

                <label
                  className={
                    "flex items-start gap-3 rounded-xl border border-white/[0.06] p-3 cursor-pointer transition " +
                    (cellCta
                      ? "bg-amber-500/10 border-amber-500/30"
                      : "bg-white/[0.02] hover:bg-white/[0.04]")
                  }
                >
                  <input
                    type="checkbox"
                    checked={cellCta}
                    onChange={(e) => setCellCta(e.target.checked)}
                    className="mt-0.5 rounded accent-amber-500"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                      <span className="font-semibold text-sm text-slate-100">
                        Closed to arrival
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Can't check-in on this date. Mid-stay guests are fine.
                    </p>
                  </div>
                </label>

                <label
                  className={
                    "flex items-start gap-3 rounded-xl border border-white/[0.06] p-3 cursor-pointer transition " +
                    (cellCtd
                      ? "bg-amber-500/10 border-amber-500/30"
                      : "bg-white/[0.02] hover:bg-white/[0.04]")
                  }
                >
                  <input
                    type="checkbox"
                    checked={cellCtd}
                    onChange={(e) => setCellCtd(e.target.checked)}
                    className="mt-0.5 rounded accent-amber-500"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                      <span className="font-semibold text-sm text-slate-100">
                        Closed to departure
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Guests can't check-out on this date — force an extra
                      night.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {cellError && <p className="text-sm text-rose-300">{cellError}</p>}
          </div>

          <div className="mt-6 flex gap-3 justify-between">
            <div>
              {editingCell.existing &&
                editingCell.existing.valid_from === editingCell.date &&
                editingCell.existing.valid_to === editingCell.date && (
                  <button
                    onClick={deleteCellOverride}
                    disabled={cellSaving}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 px-3 py-2 text-sm font-semibold text-rose-300 transition disabled:opacity-40"
                  >
                    <Trash2 className="w-4 h-4" /> Remove override
                  </button>
                )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={closeCellEditor}
                className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={saveCellPrice}
                disabled={cellSaving}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 px-5 py-2 text-sm font-bold text-white transition disabled:opacity-60 shadow-lg shadow-indigo-500/20"
              >
                <Save className="w-4 h-4" />
                {cellSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </DarkModal>
      )}

      {/* ─── Bulk edit modal ────────────────────────────────── */}
      {showBulk && (
        <DarkModal title="Bulk edit prices" onClose={() => setShowBulk(false)}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <DarkField label="From">
                <input
                  type="date"
                  value={bulkFrom}
                  onChange={(e) => setBulkFrom(e.target.value)}
                  className={darkInputCls}
                />
              </DarkField>
              <DarkField label="To">
                <input
                  type="date"
                  value={bulkTo}
                  onChange={(e) => setBulkTo(e.target.value)}
                  className={darkInputCls}
                />
              </DarkField>
            </div>

            <DarkField
              label="Room Types"
              hint={`${bulkRoomTypes.size} of ${roomTypes.length} selected`}
            >
              <div className="flex flex-wrap gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setBulkRoomTypes(new Set(roomTypes.map((r) => r.id)))}
                  className="text-[11px] text-slate-500 hover:text-indigo-300 font-semibold uppercase tracking-wider"
                >
                  All
                </button>
                <span className="text-slate-700">·</span>
                <button
                  type="button"
                  onClick={() => setBulkRoomTypes(new Set())}
                  className="text-[11px] text-slate-500 hover:text-indigo-300 font-semibold uppercase tracking-wider"
                >
                  None
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {roomTypes.map((rt) => {
                  const selected = bulkRoomTypes.has(rt.id);
                  return (
                    <button
                      key={rt.id}
                      type="button"
                      onClick={() => {
                        const next = new Set(bulkRoomTypes);
                        if (selected) next.delete(rt.id);
                        else next.add(rt.id);
                        setBulkRoomTypes(next);
                      }}
                      className={
                        "rounded-lg px-3 py-1.5 text-xs font-semibold transition border " +
                        (selected
                          ? "border-indigo-500/50 bg-indigo-500/20 text-indigo-200"
                          : "border-white/10 bg-white/[0.02] text-slate-400 hover:text-slate-200")
                      }
                    >
                      {rt.name}
                    </button>
                  );
                })}
              </div>
            </DarkField>

            <DarkField label="Days of Week">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {DOW_LABELS.map(({ bit, short }) => {
                    const selected = (bulkDowMask & bit) > 0;
                    return (
                      <button
                        key={bit}
                        type="button"
                        onClick={() =>
                          setBulkDowMask(
                            selected ? bulkDowMask & ~bit : bulkDowMask | bit,
                          )
                        }
                        className={
                          "rounded-lg px-2.5 py-1 text-xs font-semibold transition border " +
                          (selected
                            ? "border-indigo-500/50 bg-indigo-500/20 text-indigo-200"
                            : "border-white/10 bg-white/[0.02] text-slate-400 hover:text-slate-200")
                        }
                      >
                        {short}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setBulkDowMask(DOW_ALL_DAYS)}
                    className="text-slate-500 hover:text-indigo-300 font-semibold uppercase tracking-wider"
                  >
                    All
                  </button>
                  <span className="text-slate-700">·</span>
                  <button
                    type="button"
                    onClick={() => setBulkDowMask(DOW_WEEKDAYS)}
                    className="text-slate-500 hover:text-indigo-300 font-semibold uppercase tracking-wider"
                  >
                    Weekdays
                  </button>
                  <span className="text-slate-700">·</span>
                  <button
                    type="button"
                    onClick={() => setBulkDowMask(DOW_WEEKENDS)}
                    className="text-slate-500 hover:text-indigo-300 font-semibold uppercase tracking-wider"
                  >
                    Weekends
                  </button>
                </div>
              </div>
            </DarkField>

            <div className="grid grid-cols-2 gap-3">
              <DarkField label="Price (₹ per night)">
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={bulkPrice}
                  onChange={(e) => setBulkPrice(e.target.value)}
                  className={darkInputCls}
                  placeholder="e.g. 5500"
                />
              </DarkField>
              <DarkField label="Priority" hint="100 = base · 200 = override">
                <input
                  type="number"
                  min={1}
                  value={bulkPriority}
                  onChange={(e) => setBulkPriority(Number(e.target.value))}
                  className={darkInputCls}
                />
              </DarkField>
            </div>

            {bulkError && <p className="text-sm text-rose-300">{bulkError}</p>}

            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-slate-400">
              This creates one rate row per selected room type covering{" "}
              <span className="text-slate-200 font-semibold">{bulkFrom}</span> →{" "}
              <span className="text-slate-200 font-semibold">{bulkTo}</span> on
              the picked weekdays. Higher-priority rows already on the calendar
              still win.
            </div>
          </div>

          <div className="mt-6 flex gap-3 justify-end">
            <button
              onClick={() => setShowBulk(false)}
              className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition"
            >
              <X className="w-4 h-4 inline -mt-0.5" /> Cancel
            </button>
            <button
              onClick={submitBulk}
              disabled={bulkSaving}
              className="rounded-xl bg-indigo-500 hover:bg-indigo-600 px-5 py-2 text-sm font-bold text-white transition disabled:opacity-60 shadow-lg shadow-indigo-500/20"
            >
              {bulkSaving ? "Saving…" : `Apply to ${bulkRoomTypes.size} room types`}
            </button>
          </div>
        </DarkModal>
      )}
    </OwnerDarkPage>
  );
}
