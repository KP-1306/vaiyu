// web/src/components/owner/QuoteDraftCard.tsx
//
// Compact dashboard widget for AI Quote Drafts v0. Static — no realtime, no
// queries. Click → /owner/:slug/quote-drafts.

import { Link } from 'react-router-dom';
import { ChevronRight, FileText, Sparkles } from 'lucide-react';
import { AI_QUOTE_DRAFTS_V0_ENABLED } from '../../config/quoteDrafts';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  hotelSlug: string;
}

export function QuoteDraftCard({ hotelSlug }: Props) {
  const t = useOwnerT('owner-cards');
  if (!AI_QUOTE_DRAFTS_V0_ENABLED) return null;

  return (
    <Link
      to={`/owner/${hotelSlug}/quote-drafts`}
      data-testid="quote-draft-card"
      className="block rounded-2xl border border-slate-800 bg-[#151A25] p-4 hover:border-slate-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0E14]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-9 w-9 shrink-0 rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 flex items-center justify-center">
            <FileText className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-slate-100">{t('quoteDraft.title', 'AI Quote Drafts')}</h3>
              <span className="inline-flex items-center rounded-md border border-emerald-500/40 bg-emerald-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-200">
                v0
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {t('quoteDraft.subtitle', 'Need to send a quote to a guest? Draft it here')}
            </p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-slate-500 shrink-0" aria-hidden />
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-800 bg-[#0B0E14] px-3 py-2 text-[11px] text-slate-300">
        <Sparkles className="h-3.5 w-3.5 text-emerald-300 shrink-0" aria-hidden />
        <span>
          {t('quoteDraft.blurb', 'Pick a lead, choose a package, type the final price, generate a draft to copy.')}
        </span>
      </div>

      <p className="mt-3 text-[10px] text-slate-500">
        {t('quoteDraft.footer', 'Deterministic template. No live AI. No send. Manual verification required.')}
      </p>
    </Link>
  );
}
