// web/src/components/visibility/UnverifyDialog.tsx
//
// Modal dialog used when a manager unverifies an attestation. Replaces the
// previous window.prompt() flow — proper accessible modal with required-reason
// validation and keyboard handling.

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  open: boolean;
  signalLabel: string;
  busy?: boolean;
  errorText?: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

export function UnverifyDialog({ open, signalLabel, busy, errorText, onCancel, onConfirm }: Props) {
  const t = useOwnerT('owner-visibility');
  const [reason, setReason] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open) {
      setReason('');
      // focus after the dialog mounts
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const trimmed = reason.trim();
  const canConfirm = trimmed.length > 0 && !busy;

  return (
    <div
      className="vaiyu-owner fixed inset-0 z-50 grid place-items-center bg-black/60 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unverify-dialog-title"
      data-testid="unverify-dialog"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#0F1320] p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="unverify-dialog-title" className="text-[14px] font-semibold text-slate-100">
              {t('unverifyDialog.title', 'Unverify attestation')}
            </h2>
            <p className="mt-0.5 text-[12px] text-slate-400">
              <span className="text-slate-300">{signalLabel}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            aria-label={t('unverifyDialog.closeAriaLabel', 'Close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-3 text-[12px] text-slate-300">
          {t('unverifyDialog.body', 'This will demote the signal back to Self-attested (50% credit). The owner who attested it will be notified via the audit log. Please share the reason — it stays in the audit trail.')}
        </p>

        <label className="mt-3 block text-[11px] uppercase tracking-wide text-slate-400">
          {t('unverifyDialog.reasonLabel', 'Reason')} <span className="text-rose-400">*</span>
        </label>
        <textarea
          ref={inputRef}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder={t('unverifyDialog.reasonPlaceholder', 'e.g. Evidence link no longer valid; GMB profile was unverified by Google.')}
          className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-[12px] text-slate-100 placeholder:text-slate-500 focus:border-slate-500 focus:outline-none"
          data-testid="unverify-dialog-reason"
        />
        <div className="mt-1 text-right text-[10px] text-slate-500">
          {trimmed.length}/500
        </div>

        {errorText && (
          <p className="mt-2 text-[11px] text-rose-300" role="alert">
            {errorText}
          </p>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-slate-700 px-3 py-1.5 text-[12px] text-slate-200 hover:bg-slate-800"
          >
            {t('unverifyDialog.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={() => canConfirm && onConfirm(trimmed)}
            disabled={!canConfirm}
            className="rounded bg-rose-500/20 px-3 py-1.5 text-[12px] text-rose-200 hover:bg-rose-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="unverify-dialog-confirm"
          >
            {busy ? t('unverifyDialog.confirming', 'Unverifying…') : t('unverifyDialog.confirm', 'Unverify')}
          </button>
        </div>
      </div>
    </div>
  );
}
