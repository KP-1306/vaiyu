// web/src/components/partner/PartnerBadges.tsx
//
// Tiny status pills used across the directory + detail drawer. Single source
// of truth for status colouring so the UI stays consistent.

import {
  PARTNER_STATUS_LABEL,
  PARTNER_VERIFICATION_LABEL,
  PARTNER_CATEGORY_LABEL,
  PARTNER_STATUS_TONE,
  type PartnerStatus,
  type PartnerVerificationStatus,
  type PartnerKind,
  type PartnerCategory,
} from '../../types/partner';

const TONE_CLASSES: Record<string, string> = {
  green:   'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  gold:    'border-amber-400/50 bg-amber-400/10 text-amber-200',
  amber:   'border-amber-500/40 bg-amber-500/10 text-amber-200',
  neutral: 'border-slate-700 bg-slate-800/60 text-slate-300',
  grey:    'border-slate-700 bg-slate-800/40 text-slate-400',
  red:     'border-red-500/40 bg-red-500/10 text-red-200',
};

function pillClass(tone: keyof typeof TONE_CLASSES): string {
  return `inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${TONE_CLASSES[tone] ?? TONE_CLASSES.neutral}`;
}

export function PartnerStatusBadge({ status }: { status: PartnerStatus }) {
  return <span className={pillClass(PARTNER_STATUS_TONE[status])}>{PARTNER_STATUS_LABEL[status]}</span>;
}

export function PartnerKindBadge({ kind }: { kind: PartnerKind }) {
  const tone = kind === 'AGENT' ? 'gold' : 'neutral';
  const label = kind === 'AGENT' ? 'Agent' : 'Vendor';
  return <span className={pillClass(tone)}>{label}</span>;
}

export function PartnerCategoryBadge({ category }: { category: PartnerCategory }) {
  return <span className={pillClass('neutral')}>{PARTNER_CATEGORY_LABEL[category]}</span>;
}

export function PartnerVerificationBadge({
  status,
  isStale,
}: {
  status: PartnerVerificationStatus;
  isStale: boolean;
}) {
  if (isStale) {
    return <span className={pillClass('amber')}>{PARTNER_VERIFICATION_LABEL.VERIFIED} · stale</span>;
  }
  const tone =
    status === 'VERIFIED' ? 'green' :
    status === 'PENDING'  ? 'amber' :
    status === 'REJECTED' ? 'red'   : 'neutral';
  return <span className={pillClass(tone)}>{PARTNER_VERIFICATION_LABEL[status]}</span>;
}
