// web/src/components/owner/InteraktPanel.tsx
//
// Per-hotel Interakt (WhatsApp BSP) controls. Renders alongside the
// legacy WhatsAppPanel inside OwnerSettings. Three concerns:
//   • Provider switch (META_DIRECT ↔ INTERAKT)
//   • Daily cost cap (0–1000 templates/day)
//   • 7-day delivery rate widget (read from v_hotel_whatsapp_health)
//
// In single-platform-account mode, the API key lives in Supabase secrets —
// the owner never sees it. They only flip the provider and set the cap.

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useOwnerT } from "../../i18n/useOwnerT";

type WhatsAppProvider = "META_DIRECT" | "INTERAKT";

type Props = {
  hotelId: string;
  whatsappEnabled: boolean;
  whatsappProvider: WhatsAppProvider;
  whatsappDailyCap: number;
  onChange: (next: {
    whatsapp_provider?: WhatsAppProvider;
    whatsapp_daily_cap?: number;
  }) => void;
};

interface HealthRow {
  hotel_id: string;
  whatsapp_enabled: boolean;
  whatsapp_provider: WhatsAppProvider;
  whatsapp_daily_cap: number;
  sent_today: number;
  queued_7d: number;
  sent_7d: number;
  failed_7d: number;
  delivered_7d: number;
  read_7d: number;
}

export default function InteraktPanel({
  hotelId,
  whatsappEnabled,
  whatsappProvider,
  whatsappDailyCap,
  onChange,
}: Props) {
  const t = useOwnerT("owner-settings");
  const [provider, setProvider] = useState<WhatsAppProvider>(whatsappProvider);
  const [dailyCap, setDailyCap] = useState<number>(whatsappDailyCap);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthRow | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(true);

  async function loadHealth() {
    setLoadingHealth(true);
    try {
      const { data, error } = await supabase
        .from("v_hotel_whatsapp_health")
        .select("*")
        .eq("hotel_id", hotelId)
        .maybeSingle();
      if (error) throw error;
      setHealth((data as HealthRow | null) ?? null);
    } catch {
      setHealth(null);
    } finally {
      setLoadingHealth(false);
    }
  }

  useEffect(() => {
    if (hotelId) loadHealth();
  }, [hotelId]);

  async function handleSave() {
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      const { error } = await supabase.rpc("set_hotel_whatsapp_settings", {
        p_hotel_id: hotelId,
        p_enabled: whatsappEnabled,           // unchanged here; the existing panel handles enable toggle
        p_provider: provider,
        p_daily_cap: dailyCap,
      });
      if (error) throw error;
      onChange({ whatsapp_provider: provider, whatsapp_daily_cap: dailyCap });
      setOk(t("interakt.saveOk", "Interakt settings saved."));
      void loadHealth();
    } catch (e: any) {
      setErr(e?.message ?? t("interakt.saveErr", "Failed to save Interakt settings."));
    } finally {
      setSaving(false);
    }
  }

  const deliveryRate =
    health && health.sent_7d > 0
      ? Math.round((health.delivered_7d / health.sent_7d) * 100)
      : null;

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-sky-500/10 p-2">
            <Sparkles className="h-5 w-5 text-sky-400" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">{t("interakt.title", "Interakt (WhatsApp BSP)")}</h3>
            <p className="text-xs text-white/60">
              {t("interakt.desc", "Approved templates via Interakt. Pre-checkin, check-out reminders, payment receipts, and inbound service requests.")}
            </p>
          </div>
        </div>
        {provider === "INTERAKT" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-3 py-1 text-xs font-medium text-sky-300">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t("interakt.routingViaInterakt", "Routing via Interakt")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-white/60">
            {t("interakt.metaDirect", "Meta Direct (legacy)")}
          </span>
        )}
      </div>

      {/* Provider switch */}
      <div>
        <span className="block text-xs font-medium text-white/70 mb-2">{t("interakt.providerLabel", "Provider")}</span>
        <div className="grid gap-2 sm:grid-cols-2">
          {(["META_DIRECT", "INTERAKT"] as WhatsAppProvider[]).map((p) => (
            <label
              key={p}
              className={`cursor-pointer rounded-lg border p-3 ${
                provider === p
                  ? "border-sky-400 bg-sky-500/10"
                  : "border-white/10 bg-black/20 hover:border-white/20"
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="wa-provider"
                  checked={provider === p}
                  onChange={() => setProvider(p)}
                  className="h-4 w-4 accent-sky-400"
                />
                <span className="text-sm font-medium text-white">
                  {p === "INTERAKT" ? t("interakt.providerInterakt", "Interakt") : t("interakt.providerMeta", "Meta Direct")}
                </span>
              </div>
              <p className="mt-1 ml-6 text-[11px] text-white/55">
                {p === "INTERAKT"
                  ? t("interakt.providerInteraktDesc", "Use approved templates routed via Interakt's BSP. Best for production.")
                  : t("interakt.providerMetaDesc", "Use Meta Cloud API directly. Free-text only; templates limited.")}
              </p>
            </label>
          ))}
        </div>
      </div>

      {/* Daily cap */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-white/70">
            {t("interakt.dailyCapLabel", "Daily template-send cap (per hotel)")}
          </span>
          <span className="text-sm font-semibold text-white">{t("interakt.dailyCapUnit", "{{count}}/day", { count: dailyCap })}</span>
        </div>
        <input
          type="range"
          min={0}
          max={1000}
          step={10}
          value={dailyCap}
          onChange={(e) => setDailyCap(Number(e.target.value))}
          className="w-full accent-sky-400"
        />
        <p className="mt-1 text-[11px] text-white/50">
          {t("interakt.dailyCapHint", "When the cap is hit, new WhatsApp notifications queue for the next day. 0 disables outbound WhatsApp.")}
        </p>
      </div>

      {/* Template wiring status — surfaces when no templates registered yet */}
      {provider === "INTERAKT" && health && health.queued_7d > 0 && health.sent_7d === 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              {t("interakt.templateNotWiredAlert", "{{count}} WhatsApp notifications queued in the last 7 days but 0 sent. Likely cause: Interakt templates not yet registered.", { count: health.queued_7d })}
            </div>
          </div>
        </div>
      )}

      {/* Delivery health */}
      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-white/70">
            <TrendingUp className="h-4 w-4" /> {t("interakt.health.title", "Last 7 days")}
          </span>
          <button
            type="button"
            onClick={loadHealth}
            disabled={loadingHealth}
            className="inline-flex items-center gap-1 rounded border border-white/10 px-2 py-0.5 text-[10px] text-white/70 hover:bg-white/5"
          >
            {loadingHealth ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {t("interakt.health.refresh", "Refresh")}
          </button>
        </div>
        {health ? (
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Stat label={t("interakt.health.sentToday", "Sent today")} value={health.sent_today} subtle={t("interakt.health.cap", "/ {{cap}} cap", { cap: health.whatsapp_daily_cap })} />
            <Stat label={t("interakt.health.queued7d", "Queued (7d)")} value={health.queued_7d} />
            <Stat label={t("interakt.health.sent7d", "Sent (7d)")} value={health.sent_7d} />
            <Stat
              label={t("interakt.health.deliveryRate", "Delivery rate")}
              value={deliveryRate === null ? "—" : `${deliveryRate}%`}
              tone={deliveryRate !== null && deliveryRate >= 90 ? "emerald" : deliveryRate !== null && deliveryRate >= 70 ? "amber" : "rose"}
            />
            <Stat label={t("interakt.health.failed7d", "Failed (7d)")} value={health.failed_7d} tone={health.failed_7d > 0 ? "rose" : "muted"} />
            <Stat label={t("interakt.health.delivered7d", "Delivered (7d)")} value={health.delivered_7d} />
            <Stat label={t("interakt.health.read7d", "Read (7d)")} value={health.read_7d} />
          </div>
        ) : (
          <p className="mt-2 text-xs text-white/50">{t("interakt.health.noData", "No data yet.")}</p>
        )}
      </div>

      {err && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{err}</span>
        </div>
      )}
      {ok && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{ok}</span>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? t("interakt.saving", "Saving…") : t("interakt.saveBtn", "Save Interakt settings")}
        </button>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  subtle,
  tone = "muted",
}: {
  label: string;
  value: string | number;
  subtle?: string;
  tone?: "muted" | "emerald" | "amber" | "rose";
}) {
  const toneClass =
    tone === "emerald" ? "text-emerald-300" :
    tone === "amber"   ? "text-amber-300"   :
    tone === "rose"    ? "text-rose-300"    :
                         "text-white";
  return (
    <div className="rounded border border-white/5 bg-black/30 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-white/50">{label}</div>
      <div className={`text-sm font-semibold ${toneClass}`}>
        {value}
        {subtle && <span className="ml-1 text-[10px] text-white/40">{subtle}</span>}
      </div>
    </div>
  );
}
