// web/src/components/seo/PlannerDisclaimerBanner.tsx
//
// Required disclaimer banner. Shown on the workspace + dashboard card.

import { Info } from 'lucide-react';
import { LOCAL_SEO_DISCLAIMER, LOCAL_SEO_DISCLAIMER_HI } from '../../config/localSeoPlanner';
import { useOwnerT } from '../../i18n/useOwnerT';

export function PlannerDisclaimerBanner() {
  const t = useOwnerT('owner-seo');
  return (
    <aside
      role="note"
      className="rounded-2xl border border-slate-800 bg-[#0F1320] p-3 text-[11px] text-slate-300"
      data-testid="planner-disclaimer-banner"
    >
      <div className="flex items-start gap-2">
        <Info className="h-4 w-4 mt-0.5 shrink-0 text-slate-400" aria-hidden />
        <div className="space-y-1">
          <p className="font-semibold uppercase tracking-wide text-[10px] text-slate-400">
            {t('disclaimer.heading', 'Internal planning tool — publishes nothing')}
          </p>
          <p className="leading-relaxed">{t('disclaimer.body', LOCAL_SEO_DISCLAIMER)}</p>
          <p className="leading-relaxed text-slate-400">{t('disclaimer.hinglish', LOCAL_SEO_DISCLAIMER_HI)}</p>
        </div>
      </div>
    </aside>
  );
}
