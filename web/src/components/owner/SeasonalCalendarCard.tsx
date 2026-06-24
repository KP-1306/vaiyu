// web/src/components/owner/SeasonalCalendarCard.tsx
//
// Compact dashboard tile for Seasonal Demand Calendar — Position 8 of the
// growth sheet. Dark theme to match OwnerDashboard. Shows the next planning
// focus + urgency counters. Deep-links to /owner/:slug/seasonal.

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronRight, Flame, Clock, Eye } from 'lucide-react';

import {
  SEASONAL_DEMAND_CALENDAR_V0_ENABLED,
  formatDaysUntil,
  SEASONAL_URGENCY_LABEL,
} from '../../config/seasonalCalendar';
import { useOwnerT } from '../../i18n/useOwnerT';
import {
  listVisibleSeasonalWindows,
  summarizeSeasonalCalendar,
} from '../../services/seasonalCalendarService';
import { seasonalCalendarQueryKeys } from '../../services/seasonalCalendarQueryKeys';
import { useSeasonalWindowsRealtime } from '../../hooks/useSeasonalWindowsRealtime';

interface Props {
  hotelId: string;
  hotelSlug: string;
}

export function SeasonalCalendarCard({ hotelId, hotelSlug }: Props) {
  const t = useOwnerT('owner-cards');
  const seasT = useOwnerT('owner-seasonal');
  if (!SEASONAL_DEMAND_CALENDAR_V0_ENABLED) return null;

  // hotelId is passed by the parent (OwnerDashboard already resolved slug->id),
  // so there is no redundant per-card hotels lookup.
  useSeasonalWindowsRealtime(hotelId);

  const listQ = useQuery({
    queryKey: hotelId
      ? seasonalCalendarQueryKeys.list(hotelId)
      : ['seasonal-windows', 'noop'],
    queryFn: () => (hotelId ? listVisibleSeasonalWindows(hotelId) : Promise.resolve([])),
    enabled: !!hotelId,
    staleTime: 30_000,
  });

  const summary = summarizeSeasonalCalendar(listQ.data ?? []);
  const nowCount = summary.byUrgency.NOW ?? 0;
  const prepCount = summary.byUrgency.PREPARE ?? 0;
  const watchCount = summary.byUrgency.WATCH ?? 0;
  const readyCount = summary.byReviewStatus.READY ?? 0;

  return (
    <Link
      to={`/owner/${hotelSlug}/seasonal`}
      data-testid="seasonal-calendar-card"
      className="block rounded-2xl border border-slate-800 bg-[#151A25] p-4 hover:border-slate-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0E14]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-9 w-9 shrink-0 rounded-xl bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30 flex items-center justify-center">
            <CalendarDays className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-slate-100">{t('seasonalCard.title', 'Seasonal Demand Calendar')}</h3>
              <span className="inline-flex items-center rounded-md border border-amber-500/40 bg-amber-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-200">
                v0
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {t('seasonalCard.subtitle', 'Planning guide for regional travel seasons. No forecasts, no auto-campaigns.')}
            </p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-slate-500 shrink-0" aria-hidden />
      </div>

      {/* Next focus line */}
      {summary.topWindow ? (
        <div className="mt-3 rounded-lg border border-slate-800 bg-[#0B0E14] px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">{t('seasonalCard.nextFocus', 'Next focus')}</div>
          <div className="mt-0.5 truncate text-[13px] font-medium text-slate-100">
            {summary.topWindow.display_name_en}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
            <span>{formatDaysUntil(summary.topWindow.days_to_start, summary.topWindow.computed_urgency, seasT)}</span>
            <span className="text-slate-600">·</span>
            <span className="font-semibold text-slate-300">{seasT(`urgency.${summary.topWindow.computed_urgency}`, SEASONAL_URGENCY_LABEL[summary.topWindow.computed_urgency])}</span>
            <span className="text-slate-600">·</span>
            <span>{t('seasonalCard.prepDone', '{{done}}/{{total}} prep done', { done: summary.topWindow.checklist_done, total: summary.topWindow.checklist_total })}</span>
          </div>
        </div>
      ) : (
        <div className="mt-3 text-[12px] text-slate-500">
          {listQ.isLoading
            ? t('common.loading', 'Loading…')
            : listQ.isError
            ? t('seasonalCard.loadError', 'Could not load planning windows.')
            : t('seasonalCard.allDismissed', 'All planning windows are dismissed or hidden.')}
        </div>
      )}

      {/* Urgency counters */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Metric icon={<Flame className="h-3 w-3" />} label={t('seasonalCard.now', 'Now')}     value={nowCount}   tone="rose" />
        <Metric icon={<Clock className="h-3 w-3" />} label={t('seasonalCard.prepare', 'Prepare')} value={prepCount}  tone="amber" />
        <Metric icon={<Eye className="h-3 w-3" />}   label={t('seasonalCard.watch', 'Watch')}   value={watchCount} tone="sky" />
      </div>

      {readyCount > 0 && (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0B0E14] px-2.5 py-1.5 text-[11px] text-slate-300">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span>{t('seasonalCard.readyByMgr', '{{count}} marked READY by manager', { count: readyCount })}</span>
        </div>
      )}

      <p className="mt-3 text-[10px] text-slate-500">
        {t('seasonalCard.footer', 'Deterministic planning windows. No demand prediction, no campaigns, no AI.')}
      </p>
    </Link>
  );
}

function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'rose' | 'amber' | 'sky';
}) {
  const cls =
    tone === 'rose'  ? 'text-rose-200'  :
    tone === 'amber' ? 'text-amber-200' :
                       'text-sky-200';
  return (
    <div className="rounded-lg border border-slate-800 bg-[#0B0E14] px-2.5 py-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
        {icon}
        {label}
      </div>
      <div className={`mt-0.5 text-base font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
