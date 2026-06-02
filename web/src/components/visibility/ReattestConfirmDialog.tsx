// web/src/components/visibility/ReattestConfirmDialog.tsx
//
// Confirmation modal shown when the owner clicks Self-attest on a row that
// already has an active manager verification. Re-attestation wipes the
// manager seal and forces re-verification; the user needs to know that.

import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface Props {
  open: boolean;
  signalLabel: string;
  verifiedAtIso: string | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ReattestConfirmDialog({
  open, signalLabel, verifiedAtIso, busy, onCancel, onConfirm,
}: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reattest-dialog-title"
      data-testid="reattest-confirm-dialog"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-full max-w-md rounded-2xl border border-amber-500/40 bg-[#0F1320] p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 id="reattest-dialog-title" className="text-[14px] font-semibold text-slate-100">
              Replace manager verification?
            </h2>
            <p className="mt-0.5 text-[12px] text-slate-400">
              <span className="text-slate-300">{signalLabel}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-3 text-[12px] text-slate-300">
          This signal is currently <strong className="text-emerald-300">verified by a manager</strong>
          {verifiedAtIso
            ? <> on <strong>{new Date(verifiedAtIso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</strong>.</>
            : '.'} Re-attesting will clear that verification and the credit will drop to <strong>50%</strong>
          until a manager confirms the new evidence.
        </p>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-slate-700 px-3 py-1.5 text-[12px] text-slate-200 hover:bg-slate-800"
          >
            Keep verification
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded bg-amber-500/20 px-3 py-1.5 text-[12px] text-amber-200 hover:bg-amber-500/30 disabled:opacity-50"
            data-testid="reattest-dialog-confirm"
          >
            {busy ? 'Updating…' : 'Replace verification'}
          </button>
        </div>
      </div>
    </div>
  );
}
