// web/src/components/owner/AssetReadinessCard.tsx
//
// Compact dashboard tile for Digital Asset Manager — Position 6 of the growth
// sheet. Dark theme to match OwnerDashboard. Shows readiness ring + Top 3
// missing assets. Deep-links to /owner/:slug/assets.

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Camera, ChevronRight, AlertTriangle } from 'lucide-react';

import { DIGITAL_ASSET_MANAGER_V0_ENABLED, DAM_CATEGORY_LABELS } from '../../config/digitalAssetManager';
import { listAssetStatus } from '../../services/digitalAssetService';
import type { AssetStatusRow } from '../../types/digitalAssets';

interface Props {
  hotelId: string;
  hotelSlug: string;
}

export function AssetReadinessCard({ hotelId, hotelSlug }: Props) {
  const q = useQuery({
    queryKey: ['asset-status', hotelId],
    queryFn: () => listAssetStatus(hotelId),
    enabled: !!hotelId && DIGITAL_ASSET_MANAGER_V0_ENABLED,
    staleTime: 30_000,
  });

  if (!DIGITAL_ASSET_MANAGER_V0_ENABLED) return null;

  const rows: AssetStatusRow[] = q.data ?? [];
  const total = rows.length;
  const ready = rows.filter((r) => r.status === 'COLLECTED' || r.status === 'APPROVED').length;
  const missing = rows.filter((r) => r.status === 'MISSING').length;
  const rejected = rows.filter((r) => r.status === 'REJECTED' || r.status === 'NEEDS_REPLACEMENT').length;

  const top3 = [...rows]
    .filter((r) => r.status === 'MISSING' || r.status === 'REJECTED' || r.status === 'NEEDS_REPLACEMENT')
    .sort((a, b) => {
      if (a.priority_rank !== b.priority_rank) return a.priority_rank - b.priority_rank;
      if (a.category_rank !== b.category_rank) return a.category_rank - b.category_rank;
      return a.sort_order - b.sort_order;
    })
    .slice(0, 3);

  const pct = total === 0 ? 0 : Math.round((ready / total) * 100);

  return (
    <div className="rounded-xl border border-slate-800 bg-[#0F1320] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-fuchsia-300" aria-hidden />
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-300">
            Asset Readiness
          </h3>
        </div>
        <Link
          to={`/owner/${hotelSlug}/assets`}
          className="inline-flex items-center gap-0.5 text-[11px] text-fuchsia-300 hover:underline"
          data-testid="asset-readiness-card-open"
        >
          Open <ChevronRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>

      {q.isLoading && <div className="text-[12px] text-slate-500">Loading…</div>}

      {!q.isLoading && total > 0 && (
        <>
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Ready"   value={`${ready}/${total}`} tone="emerald" />
            <Stat label="Pct"     value={`${pct}%`}            tone="fuchsia" />
            <Stat label="Missing" value={missing}              tone={missing > 0 ? 'amber' : 'neutral'} />
            <Stat label="Replace" value={rejected}             tone={rejected > 0 ? 'red' : 'neutral'} icon={rejected > 0 ? AlertTriangle : undefined} />
          </div>

          {top3.length > 0 && (
            <div className="mt-3 border-t border-slate-800 pt-3">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Top missing
              </div>
              <ul className="space-y-1.5">
                {top3.map((r) => (
                  <li key={r.requirement_code} className="flex items-start gap-2">
                    <span className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dotForPriority(r.priority_rank)}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium text-slate-200">
                        {r.display_name_en}
                      </div>
                      <div className="truncate text-[10.5px] text-slate-500">
                        {DAM_CATEGORY_LABELS[r.category]} · {r.priority}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {top3.length === 0 && (
            <div className="mt-3 border-t border-slate-800 pt-3 text-[12px] text-emerald-300/80">
              All requirements collected. The VAiyu team will review uploaded assets.
            </div>
          )}
        </>
      )}

      {!q.isLoading && total === 0 && (
        <Link
          to={`/owner/${hotelSlug}/assets`}
          className="inline-flex items-center gap-1 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/10 px-2.5 py-1 text-[11px] font-medium text-fuchsia-200 hover:bg-fuchsia-500/20"
        >
          Set up your asset library
        </Link>
      )}
    </div>
  );
}

function dotForPriority(rank: number): string {
  if (rank === 0) return 'bg-rose-400';
  if (rank === 1) return 'bg-amber-400';
  if (rank === 2) return 'bg-sky-400';
  return 'bg-slate-500';
}

function Stat({
  label,
  value,
  tone = 'neutral',
  icon: Icon,
}: {
  label: string;
  value: number | string;
  tone?: 'neutral' | 'emerald' | 'fuchsia' | 'amber' | 'red';
  icon?: typeof AlertTriangle;
}) {
  const colour =
    tone === 'emerald' ? 'text-emerald-300' :
    tone === 'fuchsia' ? 'text-fuchsia-300' :
    tone === 'amber'   ? 'text-amber-300'   :
    tone === 'red'     ? 'text-red-300'     : 'text-slate-100';
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-500">
        {Icon && <Icon className="h-2.5 w-2.5" aria-hidden />}
        {label}
      </div>
      <div className={`mt-0.5 text-base font-semibold ${colour}`}>{value}</div>
    </div>
  );
}
