// web/src/components/quote/QuoteGovernanceBanner.tsx
//
// Two banners shown inside the AI Quote Drafts workspace. Phase 8A is a
// safe, deterministic-template UI; both banners make the contract explicit
// to the operator.

import { Info, Shield } from 'lucide-react';
import { QUOTE_DISCLAIMER, QUOTE_GOVERNANCE_LINE } from '../../config/quoteDrafts';
import { useOwnerT } from '../../i18n/useOwnerT';

export function QuoteDisclaimerBanner() {
  const t = useOwnerT('owner-quote');
  return (
    <div
      role="note"
      className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-100"
    >
      <div className="flex items-start gap-3">
        <Info className="h-4 w-4 mt-0.5 shrink-0 text-amber-300" aria-hidden />
        <div className="space-y-1">
          <p className="font-medium text-amber-100">{t('disclaimer.title', 'Indicative proposal — manual verification required.')}</p>
          <p className="text-amber-100/80">{t('disclaimer.body', QUOTE_DISCLAIMER)}</p>
          <p className="text-amber-100/70 italic">{t('disclaimer.governance', QUOTE_GOVERNANCE_LINE)}</p>
        </div>
      </div>
    </div>
  );
}

export function QuoteAiGovernanceNotice() {
  const t = useOwnerT('owner-quote');
  return (
    <div
      role="note"
      className="rounded-xl border border-slate-700 bg-slate-800/40 p-3 text-xs text-slate-300"
    >
      <div className="flex items-start gap-2">
        <Shield className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-300" aria-hidden />
        <div className="space-y-1">
          <p className="text-slate-200 font-medium">{t('aiNotice.title', 'Phase 8A — no live AI in use.')}</p>
          <p>
            {t('aiNotice.body', 'Draft text is generated from a deterministic template. Real AI generation will be enabled only after AI usage logging, owner approval workflow, prompt safety controls, and audit logs are in place.')}
          </p>
        </div>
      </div>
    </div>
  );
}
