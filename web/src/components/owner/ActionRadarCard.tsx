// web/src/components/owner/ActionRadarCard.tsx
//
// Compact dashboard widget for Follow-up Radar. Reads real follow-ups.
// Always-visible card; shows a "0 / 0 / 0" baseline + "No follow-ups yet"
// hint when the hotel has none. NO mock data in production.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Radar } from 'lucide-react';
import {
  countByBucket,
  FOLLOW_UP_RADAR_V0_ENABLED,
} from '../../config/followUpRadar';
import { listFollowUps } from '../../services/followUpService';
import { useFollowUpsRealtime } from '../../hooks/useFollowUpsRealtime';

interface Props {
  hotelSlug: string;
  hotelId?: string | null;
}

export function ActionRadarCard({ hotelSlug, hotelId }: Props) {
  useFollowUpsRealtime(hotelId ?? undefined);

  const listQ = useQuery({
    queryKey: hotelId ? ['follow-ups', 'list', hotelId] : ['follow-ups', 'list', null],
    queryFn: () =>
      hotelId
        ? listFollowUps(hotelId, { includeAddressed: true })
        : Promise.resolve({ items: [], raw: [] }),
    enabled: !!hotelId,
    staleTime: 30_000,
  });

  const items = listQ.data?.items ?? [];
  const counts = useMemo(() => countByBucket(items), [items]);
  const isEmpty = listQ.isSuccess && items.length === 0;

  if (!FOLLOW_UP_RADAR_V0_ENABLED) return null;
  const hasCritical = counts.criticalUnaddressed > 0;

  return (
    <Link
      to={`/owner/${hotelSlug}/follow-up`}
      data-testid="action-radar-card"
      className="block rounded-2xl border border-slate-800 bg-[#151A25] p-4 hover:border-slate-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0E14]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-9 w-9 shrink-0 rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 flex items-center justify-center">
            <Radar className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-100">Action Radar</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Aaj kaunse follow-up karne hain
            </p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-slate-500 shrink-0" aria-hidden />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="Due today" value={counts.dueToday} tone="emerald" />
        <Stat label="Overdue" value={counts.overdue} tone="red" />
        <Stat label="Blocked" value={counts.blocked} tone="amber" />
      </div>

      {hasCritical && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-100">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-300" aria-hidden />
          <span>
            {counts.criticalUnaddressed} critical follow-up{counts.criticalUnaddressed === 1 ? '' : 's'} need attention.
          </span>
        </div>
      )}

      {isEmpty && (
        <p className="mt-3 text-[11px] text-slate-500">
          No follow-ups yet — they'll appear here as your team adds leads.
        </p>
      )}
    </Link>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'emerald' | 'red' | 'amber';
}) {
  const cls =
    tone === 'emerald'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
      : tone === 'red'
      ? 'border-red-500/30 bg-red-500/10 text-red-100'
      : 'border-amber-500/30 bg-amber-500/10 text-amber-100';
  return (
    <div className={`rounded-lg border px-2.5 py-2 ${cls}`}>
      <div className="text-base font-semibold leading-none">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide opacity-80">{label}</div>
    </div>
  );
}
