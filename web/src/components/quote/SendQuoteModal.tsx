// web/src/components/quote/SendQuoteModal.tsx
//
// Operator-facing modal for the "Send via email" + "Resend" flows.
// Calls the send-quote edge function which orchestrates render → sign → enqueue.
// Idempotency key is generated once per modal open so retries/double-clicks
// short-circuit at the RPC layer.
//
// Modes:
//   • "send" — initial send. Requires DRAFT status + governance.
//   • "resend" — explicit resend with operator-typed reason.

import { useEffect, useId, useMemo, useState } from 'react';
import { Loader2, Mail, X } from 'lucide-react';
import {
  newIdempotencyKey,
  resendQuote,
  sendQuote,
  QuoteServiceError,
  type QuoteDraftRow,
} from '../../services/quoteDraftService';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  open: boolean;
  draft: QuoteDraftRow;
  /** Lead context for default recipient + greeting. May be partial. */
  lead: { contact_name?: string | null; contact_email?: string | null } | null;
  mode: 'send' | 'resend';
  onClose: () => void;
  onSuccess: (result: { mode: 'send' | 'resend'; signedUrl: string }) => void;
}

const MAX_SUBJECT_LEN = 200;
const MAX_REASON_LEN  = 200;

export function SendQuoteModal({ open, draft, lead, mode, onClose, onSuccess }: Props) {
  const t = useOwnerT('owner-quote');
  const subjectId = useId();
  const recipientId = useId();
  const reasonId = useId();
  const subjectOverrideId = useId();

  const [recipient, setRecipient] = useState<string>('');
  const [useCustomSubject, setUseCustomSubject] = useState(false);
  const [customSubject, setCustomSubject] = useState('');
  const [resendReason, setResendReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  // Fresh idempotency key per modal open. Same key persists across retries.
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');

  useEffect(() => {
    if (open) {
      setRecipient(lead?.contact_email ?? draft.sent_to_address ?? '');
      setUseCustomSubject(false);
      setCustomSubject('');
      setResendReason('');
      setErrorCode(null);
      setIdempotencyKey(newIdempotencyKey());
    }
  }, [open, lead?.contact_email, draft.sent_to_address]);

  const recipientValid = useMemo(() => {
    const e = recipient.trim();
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length >= 5 && e.length <= 254;
  }, [recipient]);

  const reasonValid = mode === 'resend' ? resendReason.trim().length > 0 : true;

  const canSubmit = !busy && recipientValid && reasonValid && idempotencyKey.length > 0;

  if (!open) return null;

  const handleSubmit = async () => {
    setBusy(true);
    setErrorCode(null);
    try {
      const common = {
        quoteId: draft.id,
        toAddress: recipient.trim(),
        channel: 'email' as const,
        customSubject: useCustomSubject ? customSubject.trim() : undefined,
        idempotencyKey,
      };
      const result =
        mode === 'send'
          ? await sendQuote(common)
          : await resendQuote({ ...common, resendReason: resendReason.trim() });
      onSuccess({ mode, signedUrl: result.signed_url });
      onClose();
    } catch (e) {
      if (e instanceof QuoteServiceError) setErrorCode(e.code);
      else setErrorCode('UNKNOWN_ERROR');
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'send' ? t('sendModal.titleSend', 'Send quote via email') : t('sendModal.titleResend', 'Resend quote via email');
  const cta   = mode === 'send' ? t('sendModal.ctaSend', 'Send email') : t('sendModal.ctaResend', 'Resend email');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${subjectId}-title`}
      className="vaiyu-owner fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-3 py-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-700 bg-[#0F1320] text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-emerald-300" aria-hidden />
            <h2 id={`${subjectId}-title`} className="text-sm font-semibold">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t('sendModal.close', 'Close')}
            className="text-slate-400 hover:text-slate-100 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label htmlFor={recipientId} className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {t('sendModal.recipientEmail', 'Recipient email')}
            </label>
            <input
              id={recipientId}
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              disabled={busy}
              placeholder={t('sendModal.recipientPlaceholder', 'guest@example.com')}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-400 focus:outline-none"
              data-testid="send-quote-recipient"
            />
            {recipient.trim() && !recipientValid && (
              <p className="mt-1 text-[11px] text-amber-300">{t('sendModal.invalidEmail', "Doesn't look like a valid email.")}</p>
            )}
          </div>

          <div>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={useCustomSubject}
                onChange={(e) => setUseCustomSubject(e.target.checked)}
                disabled={busy}
                className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900"
              />
              {t('sendModal.overrideSubject', 'Override default subject')}
            </label>
            {useCustomSubject && (
              <input
                id={subjectOverrideId}
                type="text"
                value={customSubject}
                onChange={(e) => setCustomSubject(e.target.value.slice(0, MAX_SUBJECT_LEN))}
                disabled={busy}
                placeholder={t('sendModal.subjectPlaceholder', 'Your subject')}
                maxLength={MAX_SUBJECT_LEN}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-400 focus:outline-none"
                data-testid="send-quote-subject"
              />
            )}
            {!useCustomSubject && (
              <p className="mt-1 text-[11px] text-slate-500">
                {t('sendModal.defaultSubject', 'Default: "Your quote from [hotel name]"')}
              </p>
            )}
          </div>

          {mode === 'resend' && (
            <div>
              <label htmlFor={reasonId} className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">
                {t('sendModal.resendReason', 'Resend reason')} <span className="text-red-400">*</span>
              </label>
              <input
                id={reasonId}
                type="text"
                value={resendReason}
                onChange={(e) => setResendReason(e.target.value.slice(0, MAX_REASON_LEN))}
                disabled={busy}
                placeholder={t('sendModal.resendPlaceholder', 'Guest asked us to send again / updated price / etc.')}
                maxLength={MAX_REASON_LEN}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                data-testid="send-quote-reason"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                {t('sendModal.resendHint', 'Logged to audit. Helps you remember why you re-sent.')}
              </p>
            </div>
          )}

          <div className="rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2 text-[11px] text-slate-400">
            {t('sendModal.pdfNote', 'A branded PDF is attached automatically. Generated from the current draft text — save edits before sending if needed.')}
          </div>

          {errorCode && (
            <div role="alert" className="rounded-md border border-red-700/60 bg-red-900/20 px-3 py-2 text-xs text-red-200">
              {t(`sendModal.error.${errorCode}`, errorLabel(errorCode))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-slate-700 px-3.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            {t('sendModal.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="send-quote-submit"
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/90 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Mail className="h-3.5 w-3.5" aria-hidden />
            )}
            {busy ? t('sendModal.sending', 'Sending…') : cta}
          </button>
        </div>
      </div>
    </div>
  );
}

function errorLabel(code: string): string {
  switch (code) {
    case 'IDEMPOTENCY_KEY_REQUIRED': return 'Internal: missing dedup token. Reopen the dialog and try again.';
    case 'RECIPIENT_REQUIRED':       return 'Please enter a recipient email.';
    case 'INVALID_EMAIL':            return "That email doesn't look right.";
    case 'SUBJECT_REQUIRED':         return 'Subject cannot be empty.';
    case 'BODY_REQUIRED':            return 'Email body cannot be empty.';
    case 'GOVERNANCE_INCOMPLETE':    return 'Please tick both approval checkboxes before sending.';
    case 'ALREADY_SENT':             return 'This quote was already sent. Use Resend instead.';
    case 'RESEND_REQUIRES_SENT':     return 'Resend is only available after the first send. Use Send first.';
    case 'RESEND_REASON_REQUIRED':   return 'A short reason is required for a resend.';
    case 'WHATSAPP_PENDING_APPROVAL':return 'WhatsApp is pending Meta template approval. Email only for now.';
    case 'UNSUPPORTED_CHANNEL':      return 'That delivery channel isn\'t supported yet.';
    case 'PDF_GENERATION_FAILED':    return 'Could not generate the PDF. Check the draft text and try again.';
    case 'STORAGE_UPLOAD_FAILED':    return 'Could not save the PDF. Please retry in a moment.';
    case 'SIGN_URL_FAILED':          return 'Could not produce a download link. Please retry.';
    case 'NOT_AUTHORIZED':           return "You don't have permission to send quotes for this hotel.";
    case 'QUOTE_NOT_FOUND':          return 'This quote no longer exists.';
    default:                         return 'Send failed. Please try again. If it persists, contact support.';
  }
}
