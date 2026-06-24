// web/src/components/followup/FollowUpFilterBar.tsx
//
// Category / status / priority filter pills for the Follow-up Radar workspace.
// State lives in URL search params (mirrors the LeadsFilterBar approach so
// URLs are shareable, refresh-safe within the session).

import { X } from 'lucide-react';
import type {
  FollowUpCategory,
  FollowUpPriority,
  FollowUpStatus,
} from '../../types/followUp';
import {
  CATEGORY_LABEL,
  CATEGORY_OPTIONS,
  PRIORITY_LABEL,
  PRIORITY_OPTIONS,
  STATUS_LABEL,
  STATUS_OPTIONS,
} from '../../config/followUpRadar';
import { useOwnerT } from '../../i18n/useOwnerT';

export interface RadarFilters {
  categories: FollowUpCategory[];
  statuses: FollowUpStatus[];
  priorities: FollowUpPriority[];
}

interface Props {
  filters: RadarFilters;
  onChange: (next: RadarFilters) => void;
  onClear: () => void;
  totalShown: number;
  totalAll: number;
}

function pillClass(active: boolean): string {
  return [
    'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
    active
      ? 'bg-emerald-500/20 text-emerald-100 border-emerald-500/50'
      : 'bg-slate-800/60 text-slate-300 border-slate-700 hover:bg-slate-800',
  ].join(' ');
}

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

export function FollowUpFilterBar({
  filters,
  onChange,
  onClear,
  totalShown,
  totalAll,
}: Props) {
  const t = useOwnerT('owner-followup');
  const hasActive =
    filters.categories.length > 0 ||
    filters.statuses.length > 0 ||
    filters.priorities.length > 0;

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-slate-400">
          {t('filterBar.showing', 'Showing {{shown}} of {{all}} follow-ups', { shown: totalShown, all: totalAll })}
        </div>
        {hasActive && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
          >
            <X className="h-3 w-3" aria-hidden />
            {t('filterBar.clearFilters', 'Clear filters')}
          </button>
        )}
      </div>

      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
          {t('filterBar.category', 'Category')}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORY_OPTIONS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange({ ...filters, categories: toggle(filters.categories, c) })}
              className={pillClass(filters.categories.includes(c))}
            >
              {t(`category.${c}`, CATEGORY_LABEL[c])}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
          {t('filterBar.status', 'Status')}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange({ ...filters, statuses: toggle(filters.statuses, s) })}
              className={pillClass(filters.statuses.includes(s))}
            >
              {t(`status.${s}`, STATUS_LABEL[s])}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
          {t('filterBar.priority', 'Priority')}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRIORITY_OPTIONS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange({ ...filters, priorities: toggle(filters.priorities, p) })}
              className={pillClass(filters.priorities.includes(p))}
            >
              {t(`priority.${p}`, PRIORITY_LABEL[p])}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
