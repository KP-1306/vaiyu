// web/src/components/packages/PackageCategoryChip.tsx

import {
  Briefcase, Heart, Home, Mountain, Sparkles, Sun, Tent, Compass,
  type LucideIcon,
} from 'lucide-react';
import type { PackageCategory } from '../../types/package';
import { PACKAGE_CATEGORY_LABEL } from '../../config/packages';

const ICON: Record<PackageCategory, LucideIcon> = {
  WEEKEND_ESCAPE: Sun,
  ADVENTURE_TREKKING: Mountain,
  RELIGIOUS_SPIRITUAL: Sparkles,
  WELLNESS_YOGA: Heart,
  WORKATION_MONSOON: Briefcase,
  FAMILY_STAY: Home,
  COUPLE_RETREAT: Sparkles,
  CUSTOM: Compass,
};

const TONE: Record<PackageCategory, string> = {
  WEEKEND_ESCAPE: 'bg-amber-500/10 text-amber-200 border-amber-500/30',
  ADVENTURE_TREKKING: 'bg-emerald-500/10 text-emerald-200 border-emerald-500/30',
  RELIGIOUS_SPIRITUAL: 'bg-orange-500/10 text-orange-200 border-orange-500/30',
  WELLNESS_YOGA: 'bg-rose-500/10 text-rose-200 border-rose-500/30',
  WORKATION_MONSOON: 'bg-blue-500/10 text-blue-200 border-blue-500/30',
  FAMILY_STAY: 'bg-violet-500/10 text-violet-200 border-violet-500/30',
  COUPLE_RETREAT: 'bg-pink-500/10 text-pink-200 border-pink-500/30',
  CUSTOM: 'bg-slate-700/40 text-slate-200 border-slate-600',
};

export function PackageCategoryChip({ category }: { category: PackageCategory }) {
  const Icon = ICON[category] ?? Tent;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${TONE[category]}`}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {PACKAGE_CATEGORY_LABEL[category]}
    </span>
  );
}
