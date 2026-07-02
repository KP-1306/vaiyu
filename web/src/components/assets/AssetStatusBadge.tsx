// web/src/components/assets/AssetStatusBadge.tsx
//
// Small visual primitives shared across the workspace + dashboard card.
// Dark theme.

import { CheckCircle2, CircleAlert, AlertTriangle, Circle, Sparkles } from 'lucide-react';
import type { AssetStatus, AssetPriority, AssetCategory } from '../../types/digitalAssets';
import { useOwnerT } from '../../i18n/useOwnerT';

export function AssetStatusBadge({ status }: { status: AssetStatus }) {
  const t = useOwnerT('owner-assets');
  const cfg: Record<AssetStatus, { fallback: string; cls: string; icon: typeof Circle }> = {
    MISSING:           { fallback: 'Missing',           cls: 'bg-slate-500/15 text-slate-300 border-slate-600',          icon: Circle },
    COLLECTED:         { fallback: 'Collected',         cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', icon: CheckCircle2 },
    APPROVED:          { fallback: 'Approved',          cls: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',    icon: Sparkles },
    REJECTED:          { fallback: 'Rejected',          cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30',          icon: AlertTriangle },
    NEEDS_REPLACEMENT: { fallback: 'Needs replacement', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30',       icon: CircleAlert },
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
    CRITICAL: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    HIGH:     'bg-amber-500/15 text-amber-300 border-amber-500/30',
    MEDIUM:   'bg-sky-500/15 text-sky-300 border-sky-500/30',
    LOW:      'bg-slate-500/15 text-slate-300 border-slate-600',
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
