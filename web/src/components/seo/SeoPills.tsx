// web/src/components/seo/SeoPills.tsx
//
// Tone-mapped pills for risk / status / review on the planner UI.

import {
  SEO_RISK_LABEL,
  SEO_RISK_TONE,
  SEO_STATUS_LABEL,
  SEO_REVIEW_LABEL,
} from '../../config/localSeoPlanner';
import type {
  SeoBlueprintRisk,
  SeoBlueprintStatus,
  SeoReviewStatus,
} from '../../types/seoBlueprint';
import { useOwnerT } from '../../i18n/useOwnerT';

function pillCls(tone: 'safe' | 'warn' | 'danger' | 'neutral' | 'info'): string {
  switch (tone) {
    case 'safe':    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
    case 'warn':    return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
    case 'danger':  return 'border-rose-500/40 bg-rose-500/10 text-rose-200';
    case 'info':    return 'border-sky-500/40 bg-sky-500/10 text-sky-200';
    case 'neutral': return 'border-slate-700 bg-slate-800/60 text-slate-300';
  }
}

export function RiskPill({ risk }: { risk: SeoBlueprintRisk }) {
  const t = useOwnerT('owner-seo');
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${pillCls(SEO_RISK_TONE[risk])}`}
      data-testid={`risk-pill-${risk}`}
    >
      {t(`risk.${risk}`, SEO_RISK_LABEL[risk])}
    </span>
  );
}

export function StatusPill({ status }: { status: SeoBlueprintStatus }) {
  const t = useOwnerT('owner-seo');
  const tone =
    status === 'READY_TO_BUILD' ? 'safe'
    : status === 'IN_REVIEW' ? 'info'
    : status === 'ON_HOLD' ? 'neutral'
    : status === 'ARCHIVED' ? 'neutral'
    : 'warn'; // DRAFT
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${pillCls(tone)}`}>
      {t(`status.${status}`, SEO_STATUS_LABEL[status])}
    </span>
  );
}

export function ReviewPill({ status }: { status: SeoReviewStatus }) {
  const t = useOwnerT('owner-seo');
  const tone =
    status === 'APPROVED' ? 'safe'
    : status === 'CHANGES_REQUESTED' ? 'danger'
    : 'warn'; // PENDING_REVIEW
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${pillCls(tone)}`}>
      {t(`review.${status}`, SEO_REVIEW_LABEL[status])}
    </span>
  );
}
