// web/src/components/seo/BlueprintCard.tsx
//
// Compact blueprint row card for the workspace list. Shows title + category +
// risk/status/review pills + a single Open action.

import { ArrowRight } from 'lucide-react';
import { RiskPill, StatusPill, ReviewPill } from './SeoPills';
import { SEO_CATEGORY_LABEL } from '../../config/localSeoPlanner';
import type { SeoBlueprint } from '../../types/seoBlueprint';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  blueprint: SeoBlueprint;
  onOpen: () => void;
}

export function BlueprintCard({ blueprint, onOpen }: Props) {
  const t = useOwnerT('owner-seo');
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`blueprint-card-${blueprint.id}`}
      className="block w-full text-left rounded-2xl border border-slate-800 bg-[#0F1320] p-4 hover:border-slate-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm font-medium text-slate-100 truncate">{blueprint.page_title_concept}</p>
          <p className="text-[11px] text-slate-400">{t(`category.${blueprint.target_category}`, SEO_CATEGORY_LABEL[blueprint.target_category])}</p>
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <RiskPill risk={blueprint.risk_classification} />
            <StatusPill status={blueprint.status} />
            <ReviewPill status={blueprint.review_status as never} />
          </div>
        </div>
        <ArrowRight className="h-4 w-4 text-slate-500 shrink-0" aria-hidden />
      </div>
      {blueprint.owner_notes && (
        <p className="mt-2 text-[11px] text-slate-400 line-clamp-2">{blueprint.owner_notes}</p>
      )}
    </button>
  );
}
