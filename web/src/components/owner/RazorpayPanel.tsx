// web/src/components/owner/RazorpayPanel.tsx
//
// Per-hotel Online Payments configuration panel. Three modes:
//   NONE   — cash only; online buttons hidden across the app.
//   DIRECT — hotel uses their own Razorpay account. Funds settle to the
//            hotel's bank; vaiyu never holds the money. Available today.
//   ROUTE  — platform-managed Linked Account split via Route. Locked until
//            Razorpay activates Route on the platform account.
//
// When ROUTE_ENABLED flips to true (after Razorpay approval), the Route
// radio becomes selectable and the existing Route subsection renders.
// The Route Edge Functions and onboarding code are already in place and
// untouched — this is purely a UI gate.
//
// Used inside OwnerSettings.

import { useState } from "react";
import {
    CreditCard,
    CheckCircle2,
    AlertTriangle,
    Loader2,
    Trash2,
    Save,
    ExternalLink,
    Eye,
    EyeOff,
    Copy,
    Lock,
    ShieldCheck,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import {
    setDirectCredentials,
    clearDirectCredentials,
    RazorpayServiceError,
} from "../../services/razorpayDirectService";

// Flip to `true` once Razorpay activates Route on the platform account.
// All Route plumbing (Edge Functions, onboarding flow, fee config) is
// already built — only this gate keeps it hidden.
const ROUTE_ENABLED = false;

type Mode = "NONE" | "DIRECT" | "ROUTE";

type Props = {
    hotelId: string;
    /** Current mode for this hotel. */
    razorpayMode: Mode;
    /** Public key_id, if DIRECT is configured. */
    razorpayDirectKeyId: string | null;
    /** Configured account_id for Route, if Route is set up. */
    razorpayAccountId: string | null;
    platformFeePct: number | null;
    /** Called after any DB write so the parent can refresh its hotel state. */
    onChange: (next: {
        razorpay_mode?: Mode;
        razorpay_direct_key_id?: string | null;
        razorpay_account_id?: string | null;
        razorpay_platform_fee_pct?: number | null;
    }) => void;
    /** Route's "Connect with Razorpay" handler. Only invoked when ROUTE_ENABLED. */
    onLaunchOnboarding?: () => Promise<void> | void;
};

export default function RazorpayPanel({
    hotelId,
    razorpayMode,
    razorpayDirectKeyId,
    razorpayAccountId,
    platformFeePct,
    onChange,
    onLaunchOnboarding,
}: Props) {
    return (
        <section className="rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-5">
            <Header mode={razorpayMode} />

            <ModePicker
                mode={razorpayMode}
                onPick={async (next) => {
                    if (next === razorpayMode) return;
                    // Switching to NONE from DIRECT requires clearing credentials.
                    // Switching to DIRECT shows the form (no immediate write until
                    // credentials are entered). ROUTE is locked behind ROUTE_ENABLED.
                    if (next === "NONE" && razorpayMode === "DIRECT") {
                        // handled in DirectSection's Disconnect button
                        return;
                    }
                    onChange({ razorpay_mode: next });
                }}
            />

            {/* Mode-specific subsections */}
            {razorpayMode === "DIRECT" || (razorpayMode !== "ROUTE" && razorpayDirectKeyId) ? (
                <DirectSection
                    hotelId={hotelId}
                    currentKeyId={razorpayDirectKeyId}
                    isActive={razorpayMode === "DIRECT"}
                    onSaved={(keyId) => {
                        onChange({ razorpay_mode: "DIRECT", razorpay_direct_key_id: keyId });
                    }}
                    onCleared={() => {
                        onChange({ razorpay_mode: "NONE", razorpay_direct_key_id: null });
                    }}
                />
            ) : null}

            {ROUTE_ENABLED && razorpayMode === "ROUTE" && (
                <RouteSection
                    hotelId={hotelId}
                    razorpayAccountId={razorpayAccountId}
                    platformFeePct={platformFeePct}
                    onChange={(p) => onChange(p)}
                    onLaunchOnboarding={onLaunchOnboarding}
                />
            )}

            {razorpayMode === "NONE" && (
                <p className="text-xs text-slate-500 leading-relaxed pt-1">
                    This hotel is on <strong>cash only</strong>. Walk-in cash collection still works
                    everywhere; only the &ldquo;Pay Online&rdquo; buttons across the app are hidden.
                </p>
            )}
        </section>
    );
}

/* ============================================================
   Header
   ============================================================ */

function Header({ mode }: { mode: Mode }) {
    const configured = mode !== "NONE";
    return (
        <header className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
                <div className={`h-10 w-10 shrink-0 rounded-xl flex items-center justify-center border ${configured
                    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                    : "bg-slate-800 text-slate-500 border-slate-700"
                    }`}>
                    <CreditCard className="h-5 w-5" />
                </div>
                <div>
                    <h2 className="text-base font-semibold text-slate-100">Online Payments</h2>
                    <p className="text-xs text-slate-400 mt-0.5 max-w-prose leading-relaxed">
                        Choose how this hotel accepts online payments from guests. You can switch modes
                        later without losing historical payment records.
                    </p>
                </div>
            </div>
            <ModeBadge mode={mode} />
        </header>
    );
}

function ModeBadge({ mode }: { mode: Mode }) {
    const styles: Record<Mode, string> = {
        DIRECT: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
        ROUTE: "bg-sky-500/15 text-sky-300 border-sky-500/30",
        NONE: "bg-slate-800 text-slate-400 border-slate-700",
    };
    const label: Record<Mode, string> = { DIRECT: "Direct", ROUTE: "Route", NONE: "Cash only" };
    return (
        <span className={`shrink-0 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md border ${styles[mode]}`}>
            {mode !== "NONE" && <CheckCircle2 className="h-3 w-3" />}
            {label[mode]}
        </span>
    );
}

/* ============================================================
   Mode picker (3 radios)
   ============================================================ */

function ModePicker({ mode, onPick }: { mode: Mode; onPick: (next: Mode) => void }) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <ModeRadio
                active={mode === "NONE"}
                title="Cash only"
                hint="Front-desk cash; no online buttons"
                icon={<CreditCard className="h-4 w-4" />}
                onClick={() => onPick("NONE")}
            />
            <ModeRadio
                active={mode === "DIRECT"}
                title="Direct (your own Razorpay)"
                hint="Funds settle to your bank; vaiyu integrates"
                icon={<ShieldCheck className="h-4 w-4" />}
                onClick={() => onPick("DIRECT")}
            />
            <ModeRadio
                active={mode === "ROUTE"}
                title="Route (platform-managed)"
                hint={ROUTE_ENABLED ? "Split via Linked Account" : "Locked — pending turnover threshold"}
                icon={<Lock className="h-4 w-4" />}
                onClick={() => ROUTE_ENABLED && onPick("ROUTE")}
                disabled={!ROUTE_ENABLED}
            />
        </div>
    );
}

function ModeRadio({
    active, title, hint, icon, onClick, disabled,
}: {
    active: boolean;
    title: string;
    hint: string;
    icon: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
}) {
    const base = "text-left rounded-lg border px-3 py-2.5 transition-colors";
    const cls = disabled
        ? "border-slate-800 bg-slate-900/30 text-slate-600 cursor-not-allowed"
        : active
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
            : "border-white/10 bg-white/[0.02] text-slate-300 hover:bg-white/5";
    return (
        <button type="button" disabled={disabled} onClick={onClick} className={`${base} ${cls}`}>
            <div className="flex items-center gap-2">
                <span className={active && !disabled ? "text-emerald-300" : "text-slate-500"}>{icon}</span>
                <span className="text-sm font-semibold">{title}</span>
            </div>
            <p className="text-[11px] mt-0.5 leading-snug opacity-80">{hint}</p>
        </button>
    );
}

/* ============================================================
   DIRECT subsection — credentials form + post-save webhook info
   ============================================================ */

function DirectSection({
    hotelId,
    currentKeyId,
    isActive,
    onSaved,
    onCleared,
}: {
    hotelId: string;
    currentKeyId: string | null;
    isActive: boolean;
    onSaved: (keyId: string) => void;
    onCleared: () => void;
}) {
    const [keyId, setKeyId] = useState(currentKeyId ?? "");
    const [keySecret, setKeySecret] = useState("");
    const [showSecret, setShowSecret] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Webhook info shown ONCE after a successful save — never re-fetchable.
    const [webhookInfo, setWebhookInfo] = useState<{
        secret: string;
        url: string;
        events: string[];
        mode: "test" | "live";
    } | null>(null);

    const keyIdValid = /^rzp_(test|live)_[A-Za-z0-9]+$/.test(keyId.trim());
    const canSave = keyIdValid && keySecret.trim().length > 0 && !busy;
    const isConfigured = !!currentKeyId && isActive;

    async function handleSave() {
        setBusy(true); setError(null); setWebhookInfo(null);
        try {
            const result = await setDirectCredentials({
                hotelId,
                keyId: keyId.trim(),
                keySecret: keySecret.trim(),
            });
            setKeySecret(""); // Don't keep the plaintext in memory after save
            setWebhookInfo({
                secret: result.webhookSecret,
                url: result.webhookUrl,
                events: result.subscribedEvents,
                mode: result.mode,
            });
            onSaved(keyId.trim());
        } catch (e) {
            setError(e instanceof RazorpayServiceError ? e.message : String((e as any)?.message ?? e));
        } finally {
            setBusy(false);
        }
    }

    async function handleClear() {
        if (!window.confirm("Disconnect Razorpay? Online payments will be disabled for this hotel. Existing payments and refunds are preserved.")) return;
        setBusy(true); setError(null);
        try {
            await clearDirectCredentials(hotelId);
            setKeyId(""); setKeySecret(""); setWebhookInfo(null);
            onCleared();
        } catch (e) {
            setError(e instanceof RazorpayServiceError ? e.message : String((e as any)?.message ?? e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="space-y-3 pt-2 border-t border-white/5">
            {isConfigured && !webhookInfo && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                        <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                        <span className="text-xs text-emerald-200">
                            Configured with <code className="font-mono text-[11px]">{currentKeyId}</code>
                            {currentKeyId?.startsWith("rzp_test_") && (
                                <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border bg-amber-500/15 text-amber-300 border-amber-500/30">
                                    Test mode
                                </span>
                            )}
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={handleClear}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-300 hover:bg-rose-500/20 disabled:opacity-40 transition-colors"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                        Disconnect
                    </button>
                </div>
            )}

            {!isConfigured && (
                <>
                    <div className="space-y-2">
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                            Razorpay Key ID
                        </label>
                        <input
                            type="text"
                            value={keyId}
                            onChange={(e) => { setKeyId(e.target.value); setError(null); }}
                            placeholder="rzp_test_xxxxxxxxxxxx or rzp_live_xxxxxxxxxxxx"
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-mono text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                            spellCheck={false}
                            autoComplete="off"
                        />
                        {!!keyId && !keyIdValid && (
                            <p className="text-xs text-rose-400 flex items-center gap-1.5">
                                <AlertTriangle className="h-3 w-3" />
                                Must start with <code className="bg-rose-500/10 px-1 rounded">rzp_test_</code> or <code className="bg-rose-500/10 px-1 rounded">rzp_live_</code>
                            </p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                            Razorpay Key Secret
                        </label>
                        <div className="relative">
                            <input
                                type={showSecret ? "text" : "password"}
                                value={keySecret}
                                onChange={(e) => { setKeySecret(e.target.value); setError(null); }}
                                placeholder="••••••••••••••••"
                                className="w-full rounded-lg border border-white/10 bg-white/5 pl-3 pr-10 py-2 text-sm font-mono text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                                spellCheck={false}
                                autoComplete="new-password"
                            />
                            <button
                                type="button"
                                onClick={() => setShowSecret((s) => !s)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-200"
                                tabIndex={-1}
                                aria-label={showSecret ? "Hide secret" : "Show secret"}
                            >
                                {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                        </div>
                        <p className="text-[11px] text-slate-500">
                            From your <a href="https://dashboard.razorpay.com/app/website-app-settings/api-keys" target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-300">Razorpay Dashboard &rarr; Settings &rarr; API Keys</a>. Stored encrypted at rest.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={!canSave}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        {busy ? "Verifying with Razorpay…" : "Test & save"}
                    </button>
                </>
            )}

            {error && (
                <p className="text-xs text-rose-400 flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3" />
                    {error}
                </p>
            )}

            {webhookInfo && <WebhookSetup info={webhookInfo} />}
        </div>
    );
}

/* ============================================================
   Webhook setup instructions (shown ONCE after credentials save)
   ============================================================ */

function WebhookSetup({
    info,
}: {
    info: { secret: string; url: string; events: string[]; mode: "test" | "live" };
}) {
    const [copiedField, setCopiedField] = useState<"url" | "secret" | "events" | null>(null);

    // Detect local-dev URLs. Razorpay's servers can't reach localhost / 127.x /
    // private Docker hostnames, so trying to register the webhook will fail
    // with "no such host". Surface this clearly so the user doesn't waste
    // time pasting it into Razorpay's dashboard.
    const isLocalUrl = /\b(localhost|127\.0\.0\.1|kong:8000|0\.0\.0\.0)\b/.test(info.url);

    function copy(field: "url" | "secret" | "events", value: string) {
        navigator.clipboard.writeText(value).then(() => {
            setCopiedField(field);
            window.setTimeout(() => setCopiedField(null), 1500);
        });
    }

    return (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-4 space-y-3">
            <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-amber-300 shrink-0" />
                <h3 className="text-sm font-bold text-amber-200">
                    Next: register this webhook in Razorpay
                </h3>
            </div>

            {isLocalUrl && (
                <div className="rounded border border-rose-500/40 bg-rose-500/[0.08] px-3 py-2 text-xs text-rose-100 leading-relaxed">
                    <strong className="text-rose-200">⚠️ Local dev URL detected.</strong> Razorpay&apos;s servers
                    can&apos;t reach your localhost — trying to register this URL will fail with
                    &ldquo;no such host&rdquo;. Skip webhook registration for local testing;
                    the verify-payment path records payments without webhooks. For full webhook
                    testing, use <code className="bg-rose-500/10 px-1 rounded">ngrok http 54321</code>{" "}
                    and register the ngrok URL instead. In production this URL will be your real
                    Supabase project URL and works directly.
                </div>
            )}
            <p className="text-xs text-amber-100/80 leading-relaxed">
                Open your Razorpay Dashboard ({info.mode === "live" ? "Live Mode" : "Test Mode"}) &rarr;
                Settings &rarr; Webhooks &rarr; Add. Paste these values and subscribe to the listed
                events. vaiyu stores the webhook secret encrypted at rest — if you lose it, click
                <strong> Test &amp; save</strong> again with your key_id and key_secret to redisplay
                the same secret (re-saving never rotates it).
            </p>

            <CopyableField
                label="Webhook URL"
                value={info.url}
                copied={copiedField === "url"}
                onCopy={() => copy("url", info.url)}
            />
            <CopyableField
                label="Webhook Secret"
                value={info.secret}
                copied={copiedField === "secret"}
                onCopy={() => copy("secret", info.secret)}
            />
            <CopyableField
                label="Subscribed Events"
                value={info.events.join(", ")}
                copied={copiedField === "events"}
                onCopy={() => copy("events", info.events.join(", "))}
            />

            <a
                href={`https://dashboard.razorpay.com/app/webhooks`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-500/20 transition-colors"
            >
                Open Razorpay Webhooks
                <ExternalLink className="h-3 w-3" />
            </a>

            <div className="mt-3 pt-3 border-t border-amber-500/20 text-[11px] text-amber-100/70 leading-relaxed">
                <strong className="text-amber-200">Verify it&apos;s your account:</strong> after registering
                the webhook, make a ₹1 test payment from any walk-in or guest checkout flow and confirm
                the transaction appears in <em>your</em> Razorpay Dashboard
                ({info.mode === "live" ? "Live Mode" : "Test Mode"}). Funds will settle to your bank
                per your Razorpay settlement schedule.
            </div>
        </div>
    );
}

function CopyableField({
    label, value, copied, onCopy,
}: {
    label: string; value: string; copied: boolean; onCopy: () => void;
}) {
    return (
        <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300/80 mb-1">{label}</div>
            <div className="flex items-center gap-2">
                <code className="flex-1 rounded border border-amber-500/20 bg-slate-900/40 px-2 py-1.5 text-[11px] font-mono text-amber-100 break-all">
                    {value}
                </code>
                <button
                    type="button"
                    onClick={onCopy}
                    className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-200 hover:bg-amber-500/20 transition-colors"
                >
                    {copied ? <CheckCircle2 className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied ? "Copied" : "Copy"}
                </button>
            </div>
        </div>
    );
}

/* ============================================================
   ROUTE subsection — preserved unchanged for re-enable later
   ============================================================ */

function RouteSection({
    hotelId,
    razorpayAccountId,
    platformFeePct,
    onChange,
    onLaunchOnboarding,
}: {
    hotelId: string;
    razorpayAccountId: string | null;
    platformFeePct: number | null;
    onChange: (p: { razorpay_account_id?: string | null; razorpay_platform_fee_pct?: number | null }) => void;
    onLaunchOnboarding?: () => Promise<void> | void;
}) {
    const [draftAccountId, setDraftAccountId] = useState<string>(razorpayAccountId ?? "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    const isConfigured = !!razorpayAccountId;
    const draftIsValid = /^acc_[A-Za-z0-9]+$/.test(draftAccountId.trim());
    const draftIsDirty = draftAccountId.trim() !== (razorpayAccountId ?? "");

    async function persist(nextAccountId: string | null) {
        setBusy(true); setError(null); setSaved(false);
        try {
            const { error: e } = await supabase
                .from("hotels")
                .update({ razorpay_account_id: nextAccountId })
                .eq("id", hotelId);
            if (e) throw e;
            onChange({ razorpay_account_id: nextAccountId, razorpay_platform_fee_pct: platformFeePct });
            setSaved(true);
            window.setTimeout(() => setSaved(false), 2000);
        } catch (e: any) {
            const msg = e?.message ?? String(e);
            setError(/format_chk/.test(msg)
                ? 'Invalid format — Razorpay Linked Account IDs start with "acc_".'
                : msg);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="space-y-3 pt-2 border-t border-white/5">
            <p className="text-xs text-slate-400">
                Platform retains <strong>{platformFeePct ?? 0}%</strong> per transaction via Route's
                <code className="mx-1 font-mono text-[11px]">transfers[]</code> split.
            </p>

            <div className="space-y-2">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Linked Account ID
                </label>
                <div className="flex gap-2 flex-wrap">
                    <input
                        type="text"
                        value={draftAccountId}
                        onChange={(e) => { setDraftAccountId(e.target.value); setError(null); setSaved(false); }}
                        placeholder="acc_xxxxxxxxxxxx"
                        className="flex-1 min-w-[200px] rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-mono text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                        spellCheck={false}
                        autoComplete="off"
                    />
                    <button
                        type="button"
                        onClick={() => persist(draftAccountId.trim() || null)}
                        disabled={busy || !draftIsDirty || (!!draftAccountId && !draftIsValid)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        Save
                    </button>
                    {isConfigured && (
                        <button
                            type="button"
                            onClick={() => { setDraftAccountId(""); persist(null); }}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-300 hover:bg-rose-500/20 disabled:opacity-40 transition-colors"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                            Clear
                        </button>
                    )}
                </div>
                {!!draftAccountId && !draftIsValid && (
                    <p className="text-xs text-rose-400 flex items-center gap-1.5">
                        <AlertTriangle className="h-3 w-3" />
                        Must look like <code className="bg-rose-500/10 px-1 rounded">acc_xxxxxxxxxxxx</code>
                    </p>
                )}
                {error && (
                    <p className="text-xs text-rose-400 flex items-center gap-1.5">
                        <AlertTriangle className="h-3 w-3" />
                        {error}
                    </p>
                )}
                {saved && (
                    <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                        <CheckCircle2 className="h-3 w-3" />
                        Saved.
                    </p>
                )}
            </div>

            {!isConfigured && (
                <div className="pt-2 border-t border-white/5">
                    <p className="text-xs text-slate-400 mb-2">Don&apos;t have a Linked Account yet?</p>
                    <div className="flex gap-2 flex-wrap">
                        <button
                            type="button"
                            onClick={() => onLaunchOnboarding?.()}
                            disabled={!onLaunchOnboarding || busy}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            <CreditCard className="h-3.5 w-3.5" />
                            Connect with Razorpay
                        </button>
                        <a
                            href="https://dashboard.razorpay.com/app/route/accounts"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-white/10 transition-colors"
                        >
                            Or set up manually
                            <ExternalLink className="h-3 w-3" />
                        </a>
                    </div>
                </div>
            )}
        </div>
    );
}
