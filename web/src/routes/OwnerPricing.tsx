// web/src/routes/OwnerPricing.tsx
// VAiyu Pricing Module – occupancy overview + live evaluation + apply
// Dark theme aligned with OwnerHousekeeping.

import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  TrendingUp,
  Percent,
  BedDouble,
  Zap,
  CheckCircle,
  AlertTriangle,
  Clock,
  ArrowRight,
  ShieldAlert,
} from "lucide-react";
import {
  getHotelOccupancy,
  listPricingRules,
  evaluatePricingRules,
  applyPricing,
  getPricingSettings,
  upsertPricingSettings,
  type PricingSettings,
} from "../services/pricingService";
import { getMonthlyDiscountSummary } from "../services/rateService";
import { DISCOUNT_REASON_LABELS, type DiscountReason } from "../types/rate";
import type { PricingEvaluationResult, PricingCurrentRate } from "../types/pricing";
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

// Browser-local today as YYYY-MM-DD — never via toISOString() (that's UTC and
// can be off-by-one for staff using the app at night).
function todayLocalIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function OccupancyRing({ pct }: { pct: number }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const fill = Math.min(pct / 100, 1) * circ;
  const color = pct >= 80 ? "#10b981" : pct >= 50 ? "#f59e0b" : "#ef4444";

  return (
    <svg width={96} height={96} viewBox="0 0 96 96" className="shrink-0">
      <circle cx={48} cy={48} r={r} fill="none" stroke="#2a2d30" strokeWidth={10} />
      <circle
        cx={48}
        cy={48}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={10}
        strokeDasharray={`${fill} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 48 48)"
      />
      <text
        x={48}
        y={48}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={16}
        fontWeight={700}
        fill={color}
      >
        {pct.toFixed(0)}%
      </text>
    </svg>
  );
}

function GuardrailPanel({
  value,
  busy,
  onChange,
  title,
  description,
  defaultValue,
}: {
  value: number | null;
  busy: boolean;
  onChange: (next: number | null) => void;
  /** Optional override — defaults to the price-swing copy. */
  title?: string;
  description?: string;
  defaultValue?: number;
}) {
  const t = useOwnerT("owner-pricing");
  const enabled = value != null;
  const fallback = defaultValue ?? 25;
  // Local draft so the number field is responsive; commits on blur or Enter.
  const [draft, setDraft] = useState<string>(value != null ? String(value) : String(fallback));

  useEffect(() => {
    if (value != null) setDraft(String(value));
  }, [value]);

  function commitDraft() {
    const n = parseInt(draft, 10);
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(1, Math.min(100, n));
    if (clamped !== value) onChange(clamped);
  }

  return (
    <div className="flex items-start gap-4 flex-wrap">
      <div className="flex-1 min-w-[220px]">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-400" />
          {title ?? t("guardrailTitle", "Max price-swing guardrail")}
        </h3>
        <p className="text-xs text-slate-500 mt-1 max-w-lg">
          {description ??
            t("guardrailDesc", "In auto-apply mode the engine refuses to write a price that deviates from base by more than this cap — that swing gets flagged for manual review instead. Prevents a bad rule from silently 10×’ing the rate.")}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => onChange(enabled ? null : fallback)}
          disabled={busy}
          aria-pressed={enabled}
          aria-label={t("guardrailToggleAria", "Toggle {{name}}", { name: title ?? t("guardrailTitle", "Max price-swing guardrail") })}
          className={
            "relative inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-60 " +
            (enabled ? "bg-amber-500" : "bg-slate-600")
          }
        >
          <span
            className={
              "inline-block h-5 w-5 rounded-full bg-white shadow transform transition " +
              (enabled ? "translate-x-5" : "translate-x-0.5")
            }
          />
        </button>

        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={1}
            max={100}
            step={1}
            value={enabled ? draft : ""}
            disabled={!enabled || busy}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder={t("guardrailOff", "off")}
            className={
              "w-16 rounded-lg bg-[#0f1113] border border-white/10 px-2 py-1.5 text-sm text-white text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-400/50 disabled:opacity-50"
            }
            aria-label={t("guardrailThresholdAria", "Guardrail threshold (percent)")}
          />
          <span className="text-sm font-semibold text-slate-400">%</span>
        </div>
      </div>
    </div>
  );
}

export default function OwnerPricing() {
  const t = useOwnerT("owner-pricing");
  const tc = useOwnerCommonT();
  const ownerLocale = useOwnerLocale();
  const { slug } = useParams<{ slug: string }>();

  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [occupancy, setOccupancy] = useState<{ total: number; occupied: number; pct: number } | null>(null);
  const [discountSummary, setDiscountSummary] = useState<{
    total_amount: number;
    count: number;
    by_reason: Array<{ reason_code: string; amount: number; count: number }>;
  } | null>(null);
  const [basePrice, setBasePrice] = useState<string>("");
  const [stayDate, setStayDate] = useState<string>(todayLocalIso);
  const [evaluation, setEvaluation] = useState<PricingEvaluationResult | null>(null);
  const [currentRate, setCurrentRate] = useState<PricingCurrentRate | null>(null);

  const [applying, setApplying] = useState(false);
  const [applyNote, setApplyNote] = useState("");
  const [applySuccess, setApplySuccess] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const [settings, setSettings] = useState<PricingSettings>({
    auto_apply_enabled: false,
    recommend_only: true,
    max_delta_pct: 25,
    max_discount_pct: null,
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

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

      const monthIso = todayLocalIso().slice(0, 7);
      const [occ, rules, rateRow, pricingSettings, discounts] = await Promise.all([
        getHotelOccupancy(hotelRow.id),
        listPricingRules(hotelRow.id),
        supabase
          .from("pricing_current_rates")
          .select("*")
          .eq("hotel_id", hotelRow.id)
          .is("room_type_id", null)
          .maybeSingle()
          .then((r) => r.data as PricingCurrentRate | null),
        getPricingSettings(hotelRow.id),
        getMonthlyDiscountSummary(hotelRow.id, monthIso).catch(() => null),
      ]);

      setOccupancy(occ);
      setCurrentRate(rateRow);
      setSettings(pricingSettings);
      setDiscountSummary(discounts);

      const initialBase = rateRow?.base_price ?? 2000;
      setBasePrice(String(initialBase));

      if (rules.length > 0) {
        // First load uses today as stay date; user can change it and re-evaluate.
        setEvaluation(
          evaluatePricingRules(rules, occ.pct, initialBase, {
            stayDate: todayLocalIso(),
            maxDeltaPct: pricingSettings.max_delta_pct,
          }),
        );
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("loadFailed", "Failed to load pricing data."));
    } finally {
      setLoading(false);
    }
  }, [slug, t]);

  useEffect(() => {
    load();
  }, [load]);

  function recalculate() {
    const base = parseFloat(basePrice);
    if (isNaN(base) || base <= 0) return;
    if (!occupancy) return;

    const stay = stayDate || todayLocalIso();
    listPricingRules(hotel!.id).then((rules) => {
      setEvaluation(
        evaluatePricingRules(rules, occupancy.pct, base, {
          stayDate: stay,
          maxDeltaPct: settings.max_delta_pct,
        }),
      );
    });
  }

  async function saveDiscountCap(next: number | null) {
    if (!hotel) return;
    setSavingSettings(true);
    setSettingsError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error(t("notAuthenticated", "Not authenticated."));
      await upsertPricingSettings(hotel.id, user.id, { max_discount_pct: next });
      setSettings((s) => ({ ...s, max_discount_pct: next }));
    } catch (e: unknown) {
      setSettingsError(e instanceof Error ? e.message : t("saveDiscountCapFailed", "Failed to save discount cap."));
    } finally {
      setSavingSettings(false);
    }
  }

  async function saveGuardrail(next: number | null) {
    if (!hotel) return;
    setSavingSettings(true);
    setSettingsError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error(t("notAuthenticated", "Not authenticated."));
      await upsertPricingSettings(hotel.id, user.id, { max_delta_pct: next });
      const updatedSettings: PricingSettings = { ...settings, max_delta_pct: next };
      setSettings(updatedSettings);
      // Re-evaluate so the banner immediately reflects the new cap.
      if (evaluation) {
        const base = evaluation.base_price;
        if (occupancy && base > 0) {
          const rules = await listPricingRules(hotel.id);
          setEvaluation(
            evaluatePricingRules(rules, occupancy.pct, base, {
              stayDate: stayDate || todayLocalIso(),
              maxDeltaPct: next,
            }),
          );
        }
      }
    } catch (e: unknown) {
      setSettingsError(e instanceof Error ? e.message : t("saveGuardrailFailed", "Failed to save guardrail."));
    } finally {
      setSavingSettings(false);
    }
  }

  async function toggleSetting(key: "recommend_only" | "auto_apply_enabled") {
    if (!hotel) return;
    setSavingSettings(true);
    setSettingsError(null);
    const next = { ...settings, [key]: !settings[key] };
    // Mutually-exclusive: enabling auto-apply implies recommend_only=false
    if (key === "auto_apply_enabled" && next.auto_apply_enabled) {
      next.recommend_only = false;
    }
    if (key === "recommend_only" && next.recommend_only) {
      next.auto_apply_enabled = false;
    }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error(t("notAuthenticated", "Not authenticated."));
      await upsertPricingSettings(hotel.id, user.id, next);
      setSettings(next);
    } catch (e: unknown) {
      setSettingsError(e instanceof Error ? e.message : t("saveSettingFailed", "Failed to save setting."));
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleApply() {
    if (!hotel || !evaluation || !occupancy) return;
    setApplying(true);
    setApplyError(null);
    setApplySuccess(false);

    try {
      await applyPricing({
        hotelId: hotel.id,
        evaluation,
        roomTypeId: null,
        note: applyNote || null,
        source: "manual",
      });

      setApplySuccess(true);
      setApplyNote("");
      await load();
    } catch (e: unknown) {
      setApplyError(e instanceof Error ? e.message : t("applyFailed", "Apply failed."));
    } finally {
      setApplying(false);
    }
  }

  if (loading) return <DarkLoading message={t("loading", "Loading pricing data…")} />;
  if (error || !hotel) return <DarkErrorPanel message={error ?? t("hotelNotFound", "Hotel not found.")} />;

  const base = `/owner/${slug}`;
  const hasRecommendation = evaluation?.matched_rule != null;

  return (
    <OwnerDarkPage
      icon={TrendingUp}
      title={t("title", "Dynamic")}
      titleAccent={t("titleAccent", "Pricing")}
      accent="indigo"
      subtitle={t("subtitle", "Occupancy-based pricing for {{hotel}}", { hotel: hotel.name })}
      breadcrumbs={[
        { label: tc("nav.dashboard", "Dashboard"), to: base },
        { label: t("crumbDynamicPricing", "Dynamic Pricing") },
      ]}
      actions={
        <>
          <Link
            to={`${base}/pricing/calendar`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 px-3 py-2 text-sm font-bold text-white transition shadow-lg shadow-indigo-500/20"
          >
            {t("rateCalendar", "Rate Calendar")} <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <Link
            to={`${base}/pricing/plans`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 transition"
          >
            {t("ratePlans", "Rate Plans")} <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <Link
            to={`${base}/pricing/rules`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 transition"
          >
            {t("manageRules", "Manage Rules")} <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <Link
            to={`${base}/pricing/history`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 transition"
          >
            {t("history", "History")} <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </>
      }
    >
      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <DarkCard className="flex items-center gap-4">
          {occupancy && <OccupancyRing pct={occupancy.pct} />}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{t("kpiOccupancy", "Occupancy")}</p>
            <p className="text-2xl font-black text-white">{occupancy?.pct.toFixed(1)}%</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {t("kpiRooms", "{{occupied}} / {{total}} rooms", { occupied: occupancy?.occupied, total: occupancy?.total })}
            </p>
          </div>
        </DarkCard>

        <DarkCard>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
            <Zap className="w-3.5 h-3.5" /> {t("kpiActiveOverride", "Active Override")}
          </p>
          {currentRate ? (
            <>
              <p className="text-2xl font-black text-indigo-300 mt-1">
                {formatINR(currentRate.override_price)}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {t("kpiBaseApplied", "Base: {{base}} · Applied {{date}}", { base: formatINR(currentRate.base_price), date: new Date(currentRate.applied_at).toLocaleDateString(ownerLocale) })}
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-500 mt-2">{t("kpiNoOverride", "No override applied yet")}</p>
          )}
        </DarkCard>

        <DarkCard>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
            <BedDouble className="w-3.5 h-3.5" /> {t("kpiInventory", "Inventory")}
          </p>
          <p className="text-2xl font-black text-white mt-1">{occupancy?.total ?? "—"}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {t("kpiRoomsAvailable", "{{count}} rooms available", { count: (occupancy?.total ?? 0) - (occupancy?.occupied ?? 0) })}
          </p>
        </DarkCard>

        {/* Front-desk discounts granted this month — sourced from pricing_adjustments. */}
        <DarkCard>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
            <Percent className="w-3.5 h-3.5" /> {t("kpiDiscounts", "Discounts (this month)")}
          </p>
          {discountSummary && discountSummary.count > 0 ? (
            <>
              <p className="text-2xl font-black text-emerald-300 mt-1">
                −{formatINR(discountSummary.total_amount)}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {t("kpiApplications", "{{count}} applications", { count: discountSummary.count })}
                {discountSummary.by_reason[0] && (
                  <>
                    {" "}· {t("kpiTop", "top:")}{" "}
                    <span className="text-slate-400">
                      {t(`discountReason.${discountSummary.by_reason[0].reason_code}`, DISCOUNT_REASON_LABELS[
                        discountSummary.by_reason[0].reason_code as DiscountReason
                      ] ?? discountSummary.by_reason[0].reason_code)}
                    </span>
                  </>
                )}
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-500 mt-2">
              {t("kpiNoDiscounts", "No discounts applied yet this month")}
            </p>
          )}
        </DarkCard>
      </div>

      {/* Engine mode toggle */}
      <DarkCard>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-indigo-400" />
              {t("engineModeTitle", "Pricing Engine Mode")}
            </h2>
            <p
              className="text-xs text-slate-500 mt-1 max-w-xl"
              dangerouslySetInnerHTML={{
                __html: t(
                  "engineModeDesc",
                  'In <span class="text-slate-300 font-semibold">Recommend-only</span> mode the engine suggests a price but never writes. Switch to <span class="text-slate-300 font-semibold">Auto-apply</span> only once you trust the rules — the engine will then update live rates on its own.',
                ),
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => toggleSetting("recommend_only")}
              disabled={savingSettings || settings.recommend_only}
              className={
                "rounded-xl px-3 py-2 text-xs font-bold transition border " +
                (settings.recommend_only
                  ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-200"
                  : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10")
              }
            >
              {t("recommendOnly", "Recommend-only")}
            </button>
            <button
              onClick={() => toggleSetting("auto_apply_enabled")}
              disabled={savingSettings || settings.auto_apply_enabled}
              className={
                "rounded-xl px-3 py-2 text-xs font-bold transition border " +
                (settings.auto_apply_enabled
                  ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-200"
                  : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10")
              }
            >
              {t("autoApply", "Auto-apply")}
            </button>
          </div>
        </div>
        {settingsError && (
          <p className="mt-3 text-sm text-rose-300 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" />
            {settingsError}
          </p>
        )}

        {/* Guardrail: max price-swing cap for auto-apply */}
        <div className="mt-5 pt-5 border-t border-white/[0.05]">
          <GuardrailPanel
            value={settings.max_delta_pct}
            busy={savingSettings}
            onChange={saveGuardrail}
          />
        </div>

        {/* Server-side discount cap — caps any front-desk discretionary discount */}
        <div className="mt-5 pt-5 border-t border-white/[0.05]">
          <GuardrailPanel
            value={settings.max_discount_pct}
            busy={savingSettings}
            onChange={saveDiscountCap}
            title={t("discountCapTitle", "Max walk-in discount")}
            description={t("discountCapDesc", "Hard cap on how much percentage off a manager can give at walk-in. The server rejects any per-room discount above this — defense against a buggy client or a misclick. Recommended: 50% to start, tighten as you build trust.")}
            defaultValue={50}
          />
        </div>
      </DarkCard>

      {/* Pricing engine */}
      <DarkCard className="space-y-5">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <Percent className="w-4 h-4 text-indigo-400" />
          {t("priceEvaluation", "Price Evaluation")}
        </h2>

        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              {t("baseRackPrice", "Base / Rack Price (₹)")}
            </label>
            <input
              type="number"
              min={0}
              value={basePrice}
              onChange={(e) => setBasePrice(e.target.value)}
              className={darkInputCls + " w-36"}
              placeholder={t("basePricePlaceholder", "e.g. 2000")}
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              {t("stayDate", "Stay Date")}
            </label>
            <input
              type="date"
              value={stayDate}
              min={todayLocalIso()}
              onChange={(e) => setStayDate(e.target.value)}
              className={darkInputCls + " w-44"}
            />
          </div>
          <button
            onClick={recalculate}
            className="rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 px-4 py-2 text-sm font-semibold text-slate-100 transition"
          >
            {t("evaluate", "Evaluate")}
          </button>
        </div>

        {evaluation && (
          <div
            className={
              "rounded-xl border p-4 " +
              (hasRecommendation
                ? "border-indigo-500/30 bg-indigo-500/10"
                : "border-white/10 bg-white/[0.03]")
            }
          >
            <div className="flex items-start gap-3">
              {hasRecommendation ? (
                <CheckCircle className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm font-bold text-white">
                    {hasRecommendation ? t("ruleMatched", "Rule matched") : t("noRuleMatched", "No rule matched")}
                  </span>
                  {evaluation.matched_rule && (
                    <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-xs font-medium text-indigo-300">
                      {evaluation.matched_rule.rule_name}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-1">{evaluation.explanation}</p>

                {hasRecommendation && (
                  <div className="mt-3 flex items-center gap-6 flex-wrap">
                    <div>
                      <span className="text-xs text-slate-500">{t("evalBase", "Base")}</span>
                      <p className="text-lg font-semibold text-slate-200">
                        {formatINR(evaluation.base_price)}
                      </p>
                    </div>
                    <span className="text-slate-600 text-xl">→</span>
                    <div>
                      <span className="text-xs text-slate-500">{t("evalRecommended", "Recommended")}</span>
                      <p className="text-2xl font-black text-indigo-300">
                        {formatINR(evaluation.recommended_price)}
                      </p>
                    </div>
                    {evaluation.was_clamped && (
                      <span className="rounded-full bg-amber-500/20 text-amber-300 px-2 py-0.5 text-xs font-medium">
                        {t("clampedBy", "Clamped by {{reason}}", { reason: evaluation.clamp_reason })}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {evaluation?.guardrail.blocked && (
          <div
            role="alert"
            className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 flex items-start gap-3"
          >
            <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-bold text-amber-200">
                {t("guardrailEngaged", "Guardrail engaged — auto-apply will refuse this swing")}
              </p>
              <p className="text-amber-100/80 mt-1">
                {t("guardrailDeviateA", "Recommendation deviates from base by")}{" "}
                <span className="font-bold">{evaluation.guardrail.actual_delta_pct}%</span>{t("guardrailDeviateB", ", which exceeds the configured cap of")}{" "}
                <span className="font-bold">{evaluation.guardrail.max_delta_pct}%</span>. {t("guardrailDeviateC", "You can still apply it manually below after reviewing.")}
              </p>
            </div>
          </div>
        )}

        {evaluation && hasRecommendation && (
          <div className="border-t border-white/[0.05] pt-4 space-y-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                {t("noteOptional", "Note (optional)")}
              </label>
              <input
                type="text"
                value={applyNote}
                onChange={(e) => setApplyNote(e.target.value)}
                placeholder={t("notePlaceholder", "e.g. Weekend peak pricing")}
                className={darkInputCls + " max-w-sm"}
              />
            </div>
            <button
              onClick={handleApply}
              disabled={applying}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white transition disabled:opacity-60 shadow-lg shadow-indigo-500/20"
            >
              {applying ? (
                <>
                  <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
                  {t("applying", "Applying…")}
                </>
              ) : (
                <>{t("applyAmount", "Apply {{amount}}", { amount: formatINR(evaluation.recommended_price) })}</>
              )}
            </button>
            {applySuccess && (
              <p className="text-sm text-emerald-300 flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4" />
                {t("applySuccess", "Price override applied successfully.")}
              </p>
            )}
            {applyError && <p className="text-sm text-rose-300">{applyError}</p>}
          </div>
        )}

        {!evaluation && (
          <p className="text-sm text-slate-500 flex items-center gap-1.5">
            <Clock className="w-4 h-4" />
            {t("evalHint", "Enter a base price and click Evaluate to see the recommendation.")}
          </p>
        )}
      </DarkCard>

      {/* Quick links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link
          to={`${base}/pricing/calendar`}
          className="rounded-2xl bg-[#16181b] border border-indigo-500/30 p-5 hover:border-indigo-400/60 transition group shadow-lg"
        >
          <p className="font-bold text-white group-hover:text-indigo-300 transition">{t("rateCalendar", "Rate Calendar")}</p>
          <p className="text-xs text-slate-500 mt-1">
            {t("linkCalendarSub", "30-day grid view. Edit prices inline or in bulk.")}
          </p>
        </Link>
        <Link
          to={`${base}/pricing/plans`}
          className="rounded-2xl bg-[#16181b] border border-white/[0.06] p-5 hover:border-indigo-500/40 transition group shadow-lg"
        >
          <p className="font-bold text-white group-hover:text-indigo-300 transition">{t("ratePlans", "Rate Plans")}</p>
          <p className="text-xs text-slate-500 mt-1">
            {t("linkPlansSub", "Base prices, meal plans, seasonal rates, corporate tiers.")}
          </p>
        </Link>
        <Link
          to={`${base}/pricing/rules`}
          className="rounded-2xl bg-[#16181b] border border-white/[0.06] p-5 hover:border-indigo-500/40 transition group shadow-lg"
        >
          <p className="font-bold text-white group-hover:text-indigo-300 transition">{t("pricingRules", "Pricing Rules")}</p>
          <p className="text-xs text-slate-500 mt-1">
            {t("linkRulesSub", "Occupancy-based dynamic adjustments on top of rate plans.")}
          </p>
        </Link>
        <Link
          to={`${base}/pricing/history`}
          className="rounded-2xl bg-[#16181b] border border-white/[0.06] p-5 hover:border-indigo-500/40 transition group shadow-lg"
        >
          <p className="font-bold text-white group-hover:text-indigo-300 transition">{t("applyHistory", "Apply History")}</p>
          <p className="text-xs text-slate-500 mt-1">{t("linkHistorySub", "Full audit log of every price change.")}</p>
        </Link>
      </div>
    </OwnerDarkPage>
  );
}
