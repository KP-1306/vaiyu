// web/src/components/owner/PackageBuilderCard.tsx
//
// Dashboard widget for Experience Package Builder. Click → /owner/:slug/packages.
// Shows live counts: active+approved, drafts/in-review, 7-day public views.

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Tent, Eye, FileText, CircleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { PACKAGE_BUILDER_V0_ENABLED } from '../../config/packages';
import { listPackages, getPackageAnalytics } from '../../services/packageService';
import { packageQueryKeys } from '../../services/packageQueryKeys';
import { usePackagesRealtime } from '../../hooks/usePackagesRealtime';

interface Props {
  hotelSlug: string;
}

interface HotelRow { id: string; slug: string }

export function PackageBuilderCard({ hotelSlug }: Props) {
  if (!PACKAGE_BUILDER_V0_ENABLED) return null;

  const hotelQ = useQuery<HotelRow | null>({
    queryKey: ['package-card-hotel', hotelSlug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hotels')
        .select('id, slug')
        .eq('slug', hotelSlug)
        .maybeSingle();
      if (error) throw error;
      return data as HotelRow | null;
    },
    enabled: !!hotelSlug,
    staleTime: 60_000,
  });
  const hotelId = hotelQ.data?.id ?? null;
  usePackagesRealtime(hotelId ?? undefined);

  const listQ = useQuery({
    queryKey: hotelId ? packageQueryKeys.list(hotelId) : ['packages', 'noop'],
    queryFn: () => (hotelId ? listPackages(hotelId, { limit: 200 }) : Promise.resolve([])),
    enabled: !!hotelId,
    staleTime: 15_000,
  });

  const analyticsQ = useQuery({
    queryKey: hotelId ? packageQueryKeys.analytics(hotelId, 7) : ['package-analytics', 'noop'],
    queryFn: () => (hotelId ? getPackageAnalytics(hotelId, 7) : Promise.resolve(null)),
    enabled: !!hotelId,
    staleTime: 60_000,
  });

  const counts = useMemo(() => {
    const rows = listQ.data ?? [];
    let active = 0;
    let drafts = 0;
    let pendingReview = 0;
    let changesRequested = 0;
    for (const r of rows) {
      if (r.status === 'ACTIVE' && r.owner_approval_status === 'APPROVED') active++;
      if (r.status === 'DRAFT') drafts++;
      if (r.status === 'READY' && r.owner_approval_status === 'PENDING_REVIEW') pendingReview++;
      if (r.owner_approval_status === 'CHANGES_REQUESTED') changesRequested++;
    }
    return { active, drafts, pendingReview, changesRequested };
  }, [listQ.data]);

  const views7d = analyticsQ.data?.totalViews ?? 0;

  return (
    <Link
      to={`/owner/${hotelSlug}/packages`}
      data-testid="package-builder-card"
      className="block rounded-2xl border border-slate-800 bg-[#151A25] p-4 hover:border-slate-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0E14]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-9 w-9 shrink-0 rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 flex items-center justify-center">
            <Tent className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-slate-100">Experience Packages</h3>
              <span className="inline-flex items-center rounded-md border border-emerald-500/40 bg-emerald-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-200">
                v0
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Curate & publish stay packages — share via WhatsApp or link
            </p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-slate-500 shrink-0" aria-hidden />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-slate-800 bg-[#0B0E14] px-2.5 py-2">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
            <Tent className="h-3 w-3" aria-hidden />
            Active
          </div>
          <div className="mt-0.5 text-base font-semibold text-emerald-200">{counts.active}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-[#0B0E14] px-2.5 py-2">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
            <FileText className="h-3 w-3" aria-hidden />
            Drafts
          </div>
          <div className="mt-0.5 text-base font-semibold text-slate-200">{counts.drafts}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-[#0B0E14] px-2.5 py-2">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
            <Eye className="h-3 w-3" aria-hidden />
            7d views
          </div>
          <div className="mt-0.5 text-base font-semibold text-sky-200">{views7d}</div>
        </div>
      </div>

      {(counts.pendingReview > 0 || counts.changesRequested > 0) && (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
          <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {counts.pendingReview > 0 && `${counts.pendingReview} awaiting review`}
            {counts.pendingReview > 0 && counts.changesRequested > 0 && ' · '}
            {counts.changesRequested > 0 && `${counts.changesRequested} need changes`}
          </span>
        </div>
      )}

      <p className="mt-3 text-[10px] text-slate-500">
        Owner approval required before any package goes live. Final rate manually confirmed.
      </p>
    </Link>
  );
}
