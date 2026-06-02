// web/src/components/quote/SendQuoteButton.tsx
//
// Smart button + modal pair for the email-send flow on a quote draft.
//
// Encapsulates:
//   • Fetching the full quote_drafts row (for status, sent_to_address, etc.)
//   • Fetching the lead (for default recipient email)
//   • Choosing the right mode (send when DRAFT, resend when SENT)
//   • Showing the modal
//   • Surfacing post-send feedback
//   • Refreshing react-query caches after success
//
// Consumed by QuoteDrafts route — single line:
//   <SendQuoteButton activeDraftId={...} approvalReady={...} />

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Mail, RotateCw } from 'lucide-react';

import { getQuoteDraft } from '../../services/quoteDraftService';
import { getLead } from '../../services/leadService';
import { QUOTE_SEND_V1_ENABLED } from '../../config/quoteSend';
import { SendQuoteModal } from './SendQuoteModal';

interface Props {
  activeDraftId: string | null;
  /** Both governance checkboxes ticked on the active draft. */
  approvalReady: boolean;
}

export function SendQuoteButton({ activeDraftId, approvalReady }: Props) {
  const qc = useQueryClient();
  const [modalMode, setModalMode] = useState<'send' | 'resend' | null>(null);
  const [lastResult, setLastResult] = useState<
    | { mode: 'send' | 'resend'; signedUrl: string; at: number }
    | null
  >(null);

  const draftQuery = useQuery({
    queryKey: ['quote-draft', activeDraftId],
    queryFn: () => getQuoteDraft(activeDraftId!),
    enabled: !!activeDraftId,
    staleTime: 5_000,
  });

  const draft = draftQuery.data ?? null;
  const leadId = draft?.lead_id ?? null;

  const leadQuery = useQuery({
    queryKey: ['lead-for-quote-send', leadId],
    queryFn: () => getLead(leadId!),
    enabled: !!leadId,
    staleTime: 30_000,
  });

  if (!QUOTE_SEND_V1_ENABLED) return null;
  if (!activeDraftId)         return null;

  // Loading: show a muted placeholder
  if (draftQuery.isLoading || !draft) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-500"
      >
        <Mail className="h-3.5 w-3.5" aria-hidden />
        Send via email
      </button>
    );
  }

  const isSent = draft.status === 'SENT';
  const mode: 'send' | 'resend' = isSent ? 'resend' : 'send';

  // Tooltip / disabled state surfaces the same operator-pass guidance the
  // mark-sent button uses, plus the email-specific gates.
  const lead = leadQuery.data;
  const fallbackEmail = lead?.contact_email ?? draft.sent_to_address ?? '';
  const hasRecipient = fallbackEmail.trim().length > 0;

  const disabled = !approvalReady || (!isSent && !hasRecipient);
  const tooltip = !approvalReady
    ? 'Tick both approval checkboxes first.'
    : !hasRecipient && !isSent
    ? 'No email on file for this lead — open the lead and add one.'
    : isSent
    ? draft.sent_to_address
      ? `Already sent to ${draft.sent_to_address}. Click to resend.`
      : 'Already sent. Click to resend.'
    : `Sends the quote PDF to ${fallbackEmail || 'the recipient'} via Resend.`;

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => setModalMode(mode)}
          disabled={disabled}
          title={tooltip}
          data-testid={isSent ? 'quote-resend-button' : 'quote-send-email-button'}
          className={
            isSent
              ? 'inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs font-medium text-amber-200 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50'
              : 'inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50'
          }
        >
          {isSent ? (
            <RotateCw className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Mail className="h-3.5 w-3.5" aria-hidden />
          )}
          {isSent ? 'Resend via email' : 'Send via email'}
        </button>

        {lastResult && (
          <div className="text-[10.5px] text-slate-400">
            {lastResult.mode === 'resend' ? 'Resent' : 'Sent'} ·{' '}
            <a
              href={lastResult.signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-300 hover:underline"
            >
              View PDF <ExternalLink className="inline h-2.5 w-2.5" aria-hidden />
            </a>
          </div>
        )}
        {!lastResult && isSent && draft.sent_at && (
          <div className="text-[10.5px] text-slate-500">
            Sent {formatRelative(draft.sent_at)}
            {draft.sent_to_address ? ` to ${draft.sent_to_address}` : ''}
          </div>
        )}
      </div>

      <SendQuoteModal
        open={!!modalMode}
        draft={draft}
        lead={lead ? { contact_name: lead.contact_name, contact_email: lead.contact_email } : null}
        mode={modalMode ?? 'send'}
        onClose={() => setModalMode(null)}
        onSuccess={(result) => {
          setLastResult({ ...result, at: Date.now() });
          // Refetch the draft so status/sent_at refresh; refetch the list cache
          // used by QuotePreviousDrafts so its row updates.
          qc.invalidateQueries({ queryKey: ['quote-draft', activeDraftId] });
          qc.invalidateQueries({ queryKey: ['quote-drafts'] });
          qc.invalidateQueries({ queryKey: ['leads'] });
        }}
      />
    </>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const ms = Date.now() - d.getTime();
  const s = Math.round(ms / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}
