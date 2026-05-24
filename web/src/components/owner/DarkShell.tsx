// web/src/components/owner/DarkShell.tsx
// Shared dark-theme primitives aligned with OwnerHousekeeping.tsx.
// Used by the Dynamic Pricing and Finance modules so all "Operations"
// Owner pages share the same visual language.

import React, { useEffect, useId, useRef } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";

/* ───────────────────────────── Page Shell ───────────────────────────── */

export type BreadcrumbItem = { label: string; to?: string };

export function OwnerDarkPage({
  title,
  titleAccent,
  subtitle,
  icon: Icon,
  accent = "indigo",
  breadcrumbs,
  actions,
  children,
}: {
  title: string;
  titleAccent?: string;
  subtitle?: React.ReactNode;
  icon?: React.ElementType;
  accent?: "indigo" | "violet" | "emerald" | "amber";
  breadcrumbs?: BreadcrumbItem[];
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const accentMap: Record<string, { bg: string; text: string; ring: string }> = {
    indigo:  { bg: "bg-indigo-500/10",  text: "text-indigo-400",  ring: "border-indigo-500/20" },
    violet:  { bg: "bg-violet-500/10",  text: "text-violet-400",  ring: "border-violet-500/20" },
    emerald: { bg: "bg-emerald-500/10", text: "text-emerald-400", ring: "border-emerald-500/20" },
    amber:   { bg: "bg-amber-500/10",   text: "text-amber-400",   ring: "border-amber-500/20" },
  };
  const a = accentMap[accent];

  return (
    <div className="min-h-screen w-full bg-[#0f1113] text-white font-['Outfit'] overflow-y-auto">
      {/* Header bar — matches OwnerHousekeeping */}
      <div className="bg-[#16181b] border-b border-white/[0.05] px-4 sm:px-6 py-4 shadow-lg">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500 mb-3">
            {breadcrumbs.map((b, i) => (
              <React.Fragment key={i}>
                {b.to ? (
                  <Link to={b.to} className="hover:text-indigo-400 transition">
                    {b.label}
                  </Link>
                ) : (
                  <span className="text-slate-300">{b.label}</span>
                )}
                {i < breadcrumbs.length - 1 && <span className="text-slate-600">/</span>}
              </React.Fragment>
            ))}
          </div>
        )}

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            {Icon && (
              <div className={`p-3 ${a.bg} rounded-2xl border ${a.ring}`}>
                <Icon className={`w-6 h-6 ${a.text}`} />
              </div>
            )}
            <div>
              <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
                {title}
                {titleAccent && <span className={a.text}>{titleAccent}</span>}
              </h1>
              {subtitle && (
                <p className="text-xs text-slate-400 font-medium mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
        </div>
      </div>

      {/* Content */}
      <div className="px-4 sm:px-6 py-6 space-y-6 max-w-7xl mx-auto">{children}</div>
    </div>
  );
}

/* ───────────────────────────── Cards / KPIs ───────────────────────────── */

export function DarkCard({
  children,
  className = "",
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={
        "rounded-2xl bg-[#16181b] border border-white/[0.06] shadow-lg " +
        (padded ? "p-5 " : "") +
        className
      }
    >
      {children}
    </div>
  );
}

export function DarkKPI({
  label,
  value,
  sub,
  valueClass,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  valueClass?: string;
  icon?: React.ElementType;
}) {
  return (
    <div className="rounded-2xl bg-[#16181b] border border-white/[0.06] p-4 shadow-md">
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p
        className={
          "text-2xl font-black mt-1 flex items-center gap-1.5 " + (valueClass ?? "text-white")
        }
      >
        {Icon && <Icon className="w-5 h-5" />}
        {value}
      </p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

/* ───────────────────────────── Form Primitives ───────────────────────────── */

// `[color-scheme:dark]` tells the browser to render native form-control
// chrome (the calendar-picker icon on <input type="date|month|time">, the
// number-input spinner, select dropdowns) in dark mode, so they stay
// visible against our dark background instead of rendering as a
// near-invisible black icon.
export const darkInputCls =
  "w-full rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder-slate-500 " +
  "px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/40 transition " +
  "[color-scheme:dark]";

export function DarkField({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

/* ───────────────────────────── Modal ───────────────────────────── */

// Returns every tabbable element inside `root`, in DOM order, skipping anything
// inert or explicitly hidden. Used for focus-trap wraparound.
function getTabbables(root: HTMLElement): HTMLElement[] {
  const nodes = root.querySelectorAll<HTMLElement>(
    'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  return Array.from(nodes).filter(
    (el) => !el.hasAttribute("inert") && el.offsetParent !== null,
  );
}

export function DarkModal({
  title,
  onClose,
  children,
  maxWidth = "max-w-lg",
  initialFocusRef,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
  // Element to receive focus on open. Defaults to the first tabbable in the
  // dialog. Pass a ref to the Cancel button in destructive confirmations so
  // Enter does NOT fire the dangerous action by accident.
  initialFocusRef?: React.RefObject<HTMLElement>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Initial focus
    const target =
      initialFocusRef?.current ?? getTabbables(dialog)[0] ?? dialog;
    target.focus({ preventScroll: false });

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const tabbables = getTabbables(dialog!);
      if (tabbables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = tabbables[0];
      const last = tabbables[tabbables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    // Lock background scroll while the dialog is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      // Restore focus to the opener so keyboard users aren't dumped at the top.
      previouslyFocused?.focus?.();
    };
    // onClose + initialFocusRef are expected to be stable for the dialog's
    // lifetime; re-binding listeners every render would fight focus management.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
      onMouseDown={(e) => {
        // Clicking the backdrop (but not the dialog itself) dismisses.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={
          "bg-[#16181b] border border-white/[0.08] rounded-2xl shadow-2xl w-full overflow-hidden " +
          maxWidth +
          " max-h-[92vh] flex flex-col outline-none"
        }
      >
        <div className="bg-[#1a1c1e] border-b border-white/[0.05] px-6 py-4 flex justify-between items-center shrink-0">
          <h3 id={titleId} className="text-lg font-bold text-white">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/10 rounded-full transition text-slate-300"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/* ───────────────────────────── Confirm Modal ───────────────────────────── */

export function DarkConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  onConfirm,
  onCancel,
  busy = false,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const confirmCls =
    variant === "danger"
      ? "bg-rose-500 hover:bg-rose-600 shadow-rose-500/20"
      : "bg-indigo-500 hover:bg-indigo-600 shadow-indigo-500/20";

  // For destructive actions, default keyboard focus to Cancel so a stray Enter
  // does not fire the irreversible button. Non-destructive ("primary") variants
  // default to the confirm button for speed.
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const initialFocusRef = variant === "danger" ? cancelRef : confirmRef;

  return (
    <DarkModal
      title={title}
      onClose={onCancel}
      maxWidth="max-w-md"
      initialFocusRef={initialFocusRef}
    >
      <div className="text-sm text-slate-300">{message}</div>
      <div className="mt-6 flex gap-3 justify-end">
        <button
          ref={cancelRef}
          onClick={onCancel}
          disabled={busy}
          className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-white/30"
        >
          {cancelLabel}
        </button>
        <button
          ref={confirmRef}
          onClick={onConfirm}
          disabled={busy}
          aria-busy={busy || undefined}
          className={
            "rounded-xl px-5 py-2 text-sm font-bold text-white transition disabled:opacity-60 shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#16181b] " +
            (variant === "danger" ? "focus:ring-rose-400 " : "focus:ring-indigo-400 ") +
            confirmCls
          }
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </DarkModal>
  );
}

/* ───────────────────────────── Loading / Error ───────────────────────────── */

export function DarkLoading({ message }: { message?: string }) {
  return (
    <div className="min-h-screen w-full bg-[#0f1113] grid place-items-center text-slate-400 font-['Outfit']">
      <div className="flex items-center gap-3 text-sm">
        <span className="inline-block w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
        {message ?? "Loading…"}
      </div>
    </div>
  );
}

export function DarkErrorPanel({ message }: { message: string }) {
  return (
    <div className="min-h-screen w-full bg-[#0f1113] grid place-items-center p-4 font-['Outfit']">
      <div className="rounded-2xl bg-rose-500/10 border border-rose-500/30 p-6 max-w-md text-rose-200 text-sm">
        <p className="font-semibold text-rose-100 mb-1">Something went wrong</p>
        <p>{message}</p>
      </div>
    </div>
  );
}
