// web/src/components/owner/WhatsAppPanel.tsx
//
// Per-hotel WhatsApp notification configuration. Owner enters their Meta
// WhatsApp Business `phone_number_id` and toggles the channel on. The
// platform-level WHATSAPP_TOKEN (Meta Graph API access token) lives in
// Supabase secrets and is shared across all hotels — Meta's BSP model
// supports many phone_number_ids under one app.
//
// Used inside OwnerSettings, next to the Razorpay panel.

import { useState } from "react";
import {
    MessageCircle,
    CheckCircle2,
    AlertTriangle,
    Loader2,
    Save,
    ExternalLink,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useOwnerT } from "../../i18n/useOwnerT";

type Props = {
    hotelId: string;
    waPhoneNumberId: string | null;
    waDisplayNumber: string | null;
    whatsappEnabled: boolean;
    /** Called after save so the parent can refresh local state. */
    onChange: (next: {
        wa_phone_number_id?: string | null;
        wa_display_number?: string | null;
        whatsapp_enabled?: boolean;
    }) => void;
};

export default function WhatsAppPanel({
    hotelId,
    waPhoneNumberId,
    waDisplayNumber,
    whatsappEnabled,
    onChange,
}: Props) {
    const t = useOwnerT("owner-settings");
    const [phoneNumberId, setPhoneNumberId] = useState(waPhoneNumberId ?? "");
    const [displayNumber, setDisplayNumber] = useState(waDisplayNumber ?? "");
    const [enabled, setEnabled] = useState(whatsappEnabled);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [ok, setOk] = useState<string | null>(null);

    const configured = !!waPhoneNumberId && whatsappEnabled;

    async function handleSave() {
        setSaving(true);
        setErr(null);
        setOk(null);
        try {
            const trimmedPhoneId = phoneNumberId.trim() || null;
            const trimmedDisplay = displayNumber.trim() || null;

            // Cannot enable without a phone_number_id.
            if (enabled && !trimmedPhoneId) {
                throw new Error(t("wa.noPhoneError", "Enter the Meta phone_number_id before enabling."));
            }

            const { error } = await supabase
                .from("hotels")
                .update({
                    wa_phone_number_id: trimmedPhoneId,
                    wa_display_number: trimmedDisplay,
                    whatsapp_enabled: enabled,
                })
                .eq("id", hotelId);

            if (error) throw error;

            onChange({
                wa_phone_number_id: trimmedPhoneId,
                wa_display_number: trimmedDisplay,
                whatsapp_enabled: enabled,
            });
            setOk(t("wa.saveOk", "WhatsApp settings saved."));
        } catch (e: any) {
            setErr(e?.message ?? t("wa.saveErr", "Failed to save WhatsApp settings."));
        } finally {
            setSaving(false);
        }
    }

    return (
        <section className="rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-emerald-500/10 p-2">
                        <MessageCircle className="h-5 w-5 text-emerald-400" />
                    </div>
                    <div>
                        <h3 className="text-base font-semibold text-white">{t("wa.title", "WhatsApp notifications")}</h3>
                        <p className="text-xs text-white/60">
                            {t("wa.desc", "Send pre-checkin reminders, confirmations and updates to guests on WhatsApp.")}
                        </p>
                    </div>
                </div>
                {configured ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {t("wa.active", "Active")}
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-white/60">
                        {t("wa.notConfigured", "Not configured")}
                    </span>
                )}
            </div>

            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs text-white/70 space-y-1">
                <p>
                    {t("wa.infoHintPre", "Get these values from your")}{" "}
                    <a
                        href="https://business.facebook.com/wa/manage/phone-numbers/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-emerald-300 hover:underline"
                    >
                        {t("wa.infoHintLink", "Meta WhatsApp Manager")}
                        <ExternalLink className="h-3 w-3" />
                    </a>{" "}
                    {t("wa.infoHintPost", "after the platform admin adds your number to the VAiyu Business App.")}
                </p>
                <p className="text-white/50">
                    {t("wa.tokenNote", "The Graph API access token is stored centrally — you don't need to provide it.")}
                </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                    <span className="block text-xs font-medium text-white/70 mb-1">
                        {t("wa.phoneNumberIdLabel", "Phone Number ID")} <span className="text-red-400">*</span>
                    </span>
                    <input
                        type="text"
                        value={phoneNumberId}
                        onChange={(e) => setPhoneNumberId(e.target.value)}
                        placeholder="e.g. 105954772345678"
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-400 focus:outline-none"
                    />
                    <span className="mt-1 block text-[11px] text-white/50">
                        {t("wa.phoneNumberIdHint", "Numeric ID Meta assigns to your business number.")}
                    </span>
                </label>

                <label className="block">
                    <span className="block text-xs font-medium text-white/70 mb-1">{t("wa.displayNumberLabel", "Display Number")}</span>
                    <input
                        type="text"
                        value={displayNumber}
                        onChange={(e) => setDisplayNumber(e.target.value)}
                        placeholder="+91 98765 43210"
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-400 focus:outline-none"
                    />
                    <span className="mt-1 block text-[11px] text-white/50">
                        {t("wa.displayNumberHint", "Shown to guests on QR posters and wa.me links.")}
                    </span>
                </label>
            </div>

            <label className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 cursor-pointer">
                <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-white/20 bg-black/40 text-emerald-500 focus:ring-emerald-400"
                />
                <div className="flex-1">
                    <div className="text-sm font-medium text-white">{t("wa.enableLabel", "Enable WhatsApp channel")}</div>
                    <div className="text-xs text-white/60">
                        {t("wa.enableDesc", "When off, all WhatsApp messages for this hotel are skipped (email/SMS fallbacks still run).")}
                    </div>
                </div>
            </label>

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
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {saving ? t("wa.saving", "Saving…") : t("wa.saveBtn", "Save WhatsApp settings")}
                </button>
            </div>
        </section>
    );
}
