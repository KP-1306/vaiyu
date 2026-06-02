// web/src/components/owner/OTAReadinessCard.tsx
//
// Compact dashboard tile for OTA Listing Optimizer (Position 2 of growth
// sheet). Dark theme to match OwnerDashboard. Shows overall readiness band,
// per-OTA pill row, next-focus line, and a resume-wizard CTA when the
// cold-start wizard has not been completed.

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Compass, AlertTriangle, ClipboardList } from 'lucide-react';

import { supabase } from '../../lib/supabase';
import {
  OTA_BAND_LABEL,
  OTA_BAND_TONE,
  OTA_DISCLAIMER_EN,
  OTA_LISTING_OPTIMIZER_V0_ENABLED,
  OTA_PLATFORM_LABEL,
  OTA_PLATFORM_SHORT,
  OTA_STALE_DAYS,
  freshnessForReviewedAt,
} from '../../config/otaOptimizer';
import {
  getOtaReadinessByOta,
  getOtaReadinessSummary,
  summarizeOtaReadiness,
} from '../../services/otaOptimizerService';
import { otaOptimizerQueryKeys } from '../../services/otaOptimizerQueryKeys';
import { useOTAReadinessRealtime } from '../../hooks/useOTAReadinessRealtime';
import type { OTAReadinessBand } from '../../types/otaOptimizer';

interface Props {
  hotelSlug: string;
}

interface HotelRow { id: string; slug: string }

const BAND_BADGE_CLS: Record<OTAReadinessBand, string> = {
  PREMIUM:  'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  MODERATE: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
  CRITICAL: 'border-rose-500/40 bg-rose-500/15 text-rose-200',
};

const BAND_PILL_CLS: Record<OTAReadinessBand, string> = {
  PREMIUM:  'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
  MODERATE: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
  CRITICAL: 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30',
};

const BAND_RING_STROKE: Record<OTAReadinessBand, string> = {
  PREMIUM:  'stroke-emerald-400',
  MODERATE: 'stroke-amber-400',
  CRITICAL: 'stroke-rose-400',
};

export function OTAReadinessCard({ hotelSlug }: Props) {
  if (!OTA_LISTING_OPTIMIZER_V0_ENABLED) return null;

  const hotelQ = useQuery<HotelRow | null>({
    queryKey: ['ota-optimizer', 'hotel-by-slug', hotelSlug],
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
  useOTAReadinessRealtime(hotelId ?? undefined);

  const summaryQ = useQuery({
    queryKey: hotelId ? otaOptimizerQueryKeys.summary(hotelId) : ['ota-optimizer', 'noop-summary'],
    queryFn: () => (hotelId ? getOtaReadinessSummary(hotelId) : Promise.resolve(null)),
    enabled: !!hotelId,
    staleTime: 30_000,
  });

  const byOtaQ = useQuery({
    queryKey: hotelId ? otaOptimizerQueryKeys.byOta(hotelId) : ['ota-optimizer', 'noop-by-ota'],
    queryFn: () => (hotelId ? getOtaReadinessByOta(hotelId) : Promise.resolve([])),
    enabled: !!hotelId,
    staleTime: 30_000,
  });

  const summary = summarizeOtaReadiness(summaryQ.data ?? null, byOtaQ.data ?? []);
  const isLoading = hotelQ.isLoading || summaryQ.isLoading || byOtaQ.isLoading;
  const isError = hotelQ.isError || summaryQ.isError || byOtaQ.isError;

  // Wizard incomplete check
  const wizardIncomplete = summary !== null && !summary.wizardCompletedAt;

  // Staleness flag (any OTA stale or expired)
  const hasStale = (summary?.totalStaleCount ?? 0) > 0;

  const overallScore = summary?.overallScore ?? 0;
  const overallBand: OTAReadinessBand = summary?.overallBand ?? 'CRITICAL';

  // SVG ring geometry
  const ringRadius = 26;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringPct = summary ? Math.max(0, Math.min(100, overallScore)) : 0;
  const ringStrokeDashoffset = ringCircumference * (1 - ringPct / 100);

  return (
    <Link
      to={`/owner/${hotelSlug}/ota`}
      data-testid="ota-readiness-card"
      className="block rounded-2xl border border-slate-800 bg-[#151A25] p-4 hover:border-slate-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0E14]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-9 w-9 shrink-0 rounded-xl bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30 flex items-center justify-center">
            <Compass className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-slate-100">OTA Listing Optimizer</h3>
              <span className="inline-flex items-center rounded-md border border-sky-500/40 bg-sky-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-200">
                v0
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Self-audit workbook across 8 OTAs. Not a channel manager.
            </p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-slate-500 shrink-0" aria-hidden />
      </div>

      {/* Hero: score ring + band */}
      <div className="mt-3 flex items-center gap-4">
        <div className={`relative shrink-0 rounded-full border ${BAND_BADGE_CLS[overallBand].split(' ').slice(0, 1).join(' ')} p-1`}>
          <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90">
            <circle cx="32" cy="32" r={ringRadius}
              className="stroke-slate-800" strokeWidth="6" fill="none" />
            <circle cx="32" cy="32" r={ringRadius}
              className={BAND_RING_STROKE[overallBand]} strokeWidth="6" fill="none"
              strokeDasharray={ringCircumference}
              strokeDashoffset={ringStrokeDashoffset}
              strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-base font-semibold ${BAND_BADGE_CLS[overallBand].split(' ').filter(c => c.startsWith('text-')).join(' ')}`}>
              {summary ? Math.round(overallScore) : '—'}
            </span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${BAND_BADGE_CLS[overallBand]}`}>
            {OTA_BAND_LABEL[overallBand]}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            {summary
              ? `${summary.activeOtaCount} active OTA${summary.activeOtaCount === 1 ? '' : 's'} · ${summary.totalGapCount} gap${summary.totalGapCount === 1 ? '' : 's'}`
              : isLoading ? 'Loading…' : isError ? 'Could not load' : ''}
          </div>
          {hasStale && summary && (
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
              <AlertTriangle className="h-3 w-3" />
              <span>{summary.totalStaleCount} item{summary.totalStaleCount === 1 ? '' : 's'} stale ({OTA_STALE_DAYS}d+)</span>
            </div>
          )}
        </div>
      </div>

      {/* Per-OTA pill row */}
      {summary && summary.perOta.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {summary.perOta.slice(0, 8).map((r) => (
            <span
              key={r.ota}
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${BAND_PILL_CLS[r.band]}`}
              title={`${OTA_PLATFORM_LABEL[r.ota]}: ${Math.round(r.ota_score)}/100`}
            >
              <span className="font-semibold">{OTA_PLATFORM_SHORT[r.ota]}</span>
              <span>{Math.round(r.ota_score)}</span>
            </span>
          ))}
        </div>
      )}

      {/* Next focus */}
      {summary?.focusOta && (
        <div className="mt-3 rounded-lg border border-slate-800 bg-[#0B0E14] px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Next focus</div>
          <div className="mt-0.5 truncate text-[13px] font-medium text-slate-100">
            {OTA_PLATFORM_LABEL[summary.focusOta.ota]}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            {summary.focusOta.missing_count + summary.focusOta.unknown_count} item{(summary.focusOta.missing_count + summary.focusOta.unknown_count) === 1 ? '' : 's'} to address ·{' '}
            <span className={BAND_BADGE_CLS[summary.focusOta.band].split(' ').filter(c => c.startsWith('text-')).join(' ')}>
              {OTA_BAND_LABEL[summary.focusOta.band]}
            </span>
            {summary.focusOta.oldest_review_at && freshnessForReviewedAt(summary.focusOta.oldest_review_at) !== 'fresh' && (
              <>{' '}· <span className="text-amber-300">stale</span></>
            )}
          </div>
        </div>
      )}

      {/* Wizard incomplete CTA */}
      {wizardIncomplete && (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-2">
          <ClipboardList className="h-4 w-4 text-sky-300 shrink-0" />
          <span className="text-[12px] text-sky-200">
            Cold-start wizard not completed — open the workspace to fill the matrix.
          </span>
        </div>
      )}

      {/* Empty / error states */}
      {!summary && !isLoading && !isError && (
        <div className="mt-3 text-[12px] text-slate-500">
          No OTA settings yet — open the workspace to start the wizard.
        </div>
      )}
      {isError && (
        <div className="mt-3 text-[12px] text-rose-300">
          Could not load OTA readiness. Refresh the page.
        </div>
      )}

      <p className="mt-3 text-[10px] text-slate-500">{OTA_DISCLAIMER_EN}</p>
    </Link>
  );
}
