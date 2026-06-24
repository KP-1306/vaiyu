// web/src/components/assets/AssetStatusBadge.tsx
//
// Small visual primitives shared across the workspace + dashboard card.
// Light theme.

import { CheckCircle2, CircleAlert, AlertTriangle, Circle, Sparkles } from 'lucide-react';
import type { AssetStatus, AssetPriority, AssetCategory } from '../../types/digitalAssets';
import { useOwnerT } from '../../i18n/useOwnerT';

export function AssetStatusBadge({ status }: { status: AssetStatus }) {
  const t = useOwnerT('owner-assets');
  const cfg: Record<AssetStatus, { fallback: string; cls: string; icon: typeof Circle }> = {
    MISSING:           { fallback: 'Missing',           cls: 'bg-slate-100 text-slate-700 border-slate-200',       icon: Circle },
    COLLECTED:         { fallback: 'Collected',         cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
    APPROVED:          { fallback: 'Approved',          cls: 'bg-indigo-50 text-indigo-700 border-indigo-200',    icon: Sparkles },
    REJECTED:          { fallback: 'Rejected',          cls: 'bg-rose-50 text-rose-700 border-rose-200',          icon: AlertTriangle },
    NEEDS_REPLACEMENT: { fallback: 'Needs replacement', cls: 'bg-amber-50 text-amber-700 border-amber-200',       icon: CircleAlert },
  };
  const c = cfg[status];
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${c.cls}`}>
      <Icon className="h-3 w-3" aria-hidden />
      {t(`status.${status}`, c.fallback)}
    </span>
  );
}

export function AssetPriorityBadge({ priority }: { priority: AssetPriority }) {
  const t = useOwnerT('owner-assets');
  const cfg: Record<AssetPriority, string> = {
    CRITICAL: 'bg-rose-100 text-rose-700 border-rose-200',
    HIGH:     'bg-amber-100 text-amber-700 border-amber-200',
    MEDIUM:   'bg-sky-100 text-sky-700 border-sky-200',
    LOW:      'bg-slate-100 text-slate-600 border-slate-200',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cfg[priority]}`}>
      {t(`priority.${priority}`, priority)}
    </span>
  );
}

export function AssetCategoryDot({ category }: { category: AssetCategory }) {
  const cls: Record<AssetCategory, string> = {
    VERIFICATION_PROOF: 'bg-rose-500',
    TRUST_ESSENTIALS:   'bg-indigo-500',
    OPERATIONAL:        'bg-emerald-500',
    EXPERIENCE:         'bg-amber-500',
  };
  return <span className={`inline-block h-2 w-2 rounded-full ${cls[category]}`} aria-hidden />;
}
