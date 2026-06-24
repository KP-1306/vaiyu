// web/src/components/leads/LostReasonModal.tsx
//
// Mini-modal that captures a "why was this lost?" reason before the LOST
// transition fires. Cancel = revert the drag (caller responsibility).

import { useEffect, useRef, useState } from 'react';
import { X, AlertCircle, Loader2 } from 'lucide-react';
import { validateLostReason } from './LostReasonModal.validation';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  isOpen: boolean;
  leadName: string;
  onConfirm: (reason: string) => Promise<void>;
  onCancel: () => void;
}

export function LostReasonModal({ isOpen, leadName, onConfirm, onCancel }: Props) {
  const t = useOwnerT('owner-leads');
  const modalRef = useRef<HTMLDivElement>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setReason('');
      setError(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  useFocusTrap(modalRef, isOpen);

  // Esc cancels (unless submitting)
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, submitting, onCancel]);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validateLostReason(reason, t);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(reason.trim());
      // Caller closes the modal on success
    } catch (err) {
      // Caller handles toast; we just stop the spinner
      setError(err instanceof Error ? err.message : t('lostModal.couldNotSave', 'Could not save. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-testid="lost-reason-modal"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel();
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lost-reason-title"
        className="w-full sm:max-w-md bg-[#101218] sm:rounded-2xl border-t sm:border border-white/10 overflow-hidden"
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 id="lost-reason-title" className="text-base font-semibold text-white">
            {t('lostModal.title', 'Mark as Lost')}
          </h2>
          <button
            type="button"
            aria-label={t('lostModal.cancel', 'Cancel')}
            onClick={onCancel}
            disabled={submitting}
            className="p-1 rounded text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-40 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-sm text-white/70">
            {t('lostModal.whyLost', 'Why was {{name}} lost?', { name: leadName })}
          </p>

          <label htmlFor="lost-reason-textarea" className="block">
            <span className="block text-xs font-medium text-white/70 mb-1">
              {t('lostModal.reason', 'Reason')} <span className="text-red-400" aria-hidden="true">*</span>
            </span>
            <textarea
              id="lost-reason-textarea"
              data-testid="lost-reason-textarea"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError(null);
              }}
              rows={3}
              autoFocus
              aria-required="true"
              aria-invalid={!!error}
              aria-describedby={error ? 'lost-reason-error' : undefined}
              disabled={submitting}
              placeholder={t('lostModal.placeholder', 'e.g. Booked elsewhere via MMT, budget mismatch, dates not available')}
              className={`
                w-full rounded-lg border bg-black/30 px-3 py-2 text-sm text-white
                placeholder:text-white/30 focus:border-emerald-400 focus:outline-none
                disabled:opacity-50 resize-y
                ${error ? 'border-red-500/60' : 'border-white/10'}
              `}
            />
            {error && (
              <span id="lost-reason-error" role="alert" className="block text-[11px] text-red-400 mt-1">
                {error}
              </span>
            )}
          </label>

          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200/90">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              {t('lostModal.willMove', 'The lead will move to {{lost}}. You can reopen it later by dragging back to {{new}}.', {
                lost: t('status.LOST', 'Lost'),
                new: t('status.NEW', 'New'),
              })}
            </span>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white/70 hover:text-white disabled:opacity-40 transition-colors"
            >
              {t('lostModal.cancel', 'Cancel')}
            </button>
            <button
              type="submit"
              data-testid="lost-reason-submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-[120px] justify-center"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('lostModal.saving', 'Saving…')}
                </>
              ) : (
                t('lostModal.title', 'Mark as Lost')
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
