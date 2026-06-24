// web/src/components/seasonal/SeasonalCategorySection.tsx
//
// Collapsible group for a seasonal category. Mirrors AssetCategorySection.

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import {
  SEASONAL_CATEGORY_LABEL,
} from '../../config/seasonalCalendar';
import type {
  SeasonalCategory,
  VisibleSeasonalWindow,
} from '../../types/seasonalCalendar';
import { SeasonalWindowCard } from './SeasonalWindowCard';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  hotelId: string;
  hotelSlug: string;
  category: SeasonalCategory;
  windows: VisibleSeasonalWindow[];
  language: 'en' | 'hi';
  defaultOpen?: boolean;
  /** When true, governance actions hidden across the section (e.g. for member-only views). */
  hideManagerActions?: boolean;
}

export function SeasonalCategorySection({
  hotelId,
  hotelSlug,
  category,
  windows,
  language,
  defaultOpen = true,
  hideManagerActions,
}: Props) {
  const t = useOwnerT('owner-seasonal');
  const [open, setOpen] = useState(defaultOpen);
  const total = windows.length;
  const ready = windows.filter((w) => w.review_status === 'READY').length;
  const urgentNow = windows.filter(
    (w) => w.computed_urgency === 'NOW' && w.review_status !== 'DISMISSED' && !w.is_permanently_hidden,
  ).length;

  if (total === 0) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            {t(`category.${category}`, SEASONAL_CATEGORY_LABEL[category])}
          </h2>
        </div>
        <div className="flex items-center gap-3">
          {urgentNow > 0 && (
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10.5px] font-semibold text-rose-700">
              {t('section.urgentNow', '{{count}} now', { count: urgentNow })}
            </span>
          )}
          <div className="text-right">
            <div className="text-[10.5px] font-medium uppercase tracking-wider text-slate-400">{t('section.ready', 'Ready')}</div>
            <div className="text-sm font-semibold text-slate-900">
              {ready}<span className="text-slate-400">/{total}</span>
            </div>
          </div>
          {open
            ? <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden />
            : <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden />}
        </div>
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-200 bg-slate-50/30 px-2 py-3 sm:px-3">
          {windows.map((w) => (
            <SeasonalWindowCard
              key={w.window_code}
              hotelId={hotelId}
              hotelSlug={hotelSlug}
              window={w}
              language={language}
              hideManagerActions={hideManagerActions}
            />
          ))}
        </div>
      )}
    </section>
  );
}
