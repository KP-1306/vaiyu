// web/src/routes/owner/Visibility.tsx
//
// /owner/:slug/visibility — Visibility Score workspace. Position 9.
//
// Dark-theme owner page. Composes:
//   • Header (back / hotel name / Refresh button)
//   • Disclaimer banner (bilingual)
//   • Hero score (large ring + band + delta)
//   • Onboarding state (when signals_total < 5)
//   • Google Business checklist
//   • Trend chart (last 12 snapshots)
//   • Full 5-category breakdown

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Gauge, Loader2, RefreshCw } from 'lucide-react';

import { supabase } from '../../lib/supabase';
import {
  VISIBILITY_BAND_LABEL,
  VISIBILITY_BAND_LABEL_HI,
  VISIBILITY_BAND_TONE,
  VISIBILITY_SCORE_ENABLED,
} from '../../config/visibilityScore';
import { useOwnerT, useOwnerLang } from '../../i18n/useOwnerT';
import {
  getVisibilityCronHealth,
  getVisibilityHistory,
  getVisibilityScore,
  listVisibilityAttestations,
  snapshotVisibilityScore,
} from '../../services/visibilityScoreService';
import { visibilityScoreQueryKeys } from '../../services/visibilityScoreQueryKeys';
import {
  VisibilityServiceError,
  type HotelVisibilityAttestation,
  type VisibilityBand,
  type VisibilitySignalKey,
} from '../../types/visibilityScore';

import { VisibilityDisclaimerBanner } from '../../components/visibility/VisibilityDisclaimerBanner';
import { VisibilityTrendChart } from '../../components/visibility/VisibilityTrendChart';
import { GoogleBusinessChecklist } from '../../components/visibility/GoogleBusinessChecklist';
import { VisibilityBreakdown } from '../../components/visibility/VisibilityBreakdown';
import { useGBPChecklistRealtime } from '../../hooks/useGBPChecklistRealtime';

interface HotelRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  amenities: string[] | null;
}

const TONE_TEXT: Record<ReturnType<typeof tonePick>, string> = {
  emerald: 'text-emerald-300',
  sky:     'text-sky-300',
  amber:   'text-amber-300',
  rose:    'text-rose-300',
  slate:   'text-slate-300',
};
const TONE_STROKE: Record<ReturnType<typeof tonePick>, string> = {
  emerald: 'stroke-emerald-400',
  sky:     'stroke-sky-400',
  amber:   'stroke-amber-400',
  rose:    'stroke-rose-400',
  slate:   'stroke-slate-400',
};
function tonePick(b: VisibilityBand) {
  return VISIBILITY_BAND_TONE[b];
}

export default function VisibilityWorkspace() {
  const t = useOwnerT('owner-visibility');
  const lang = useOwnerLang();
  const { slug } = useParams<{ slug: string }>();
  const qc = useQueryClient();
  const [isManager, setIsManager] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // Resolve hotel by slug — also fetch description + amenities for the
  // GBP Checklist's AUTO_DERIVED items (description_present, amenities_visible_on_gbp).
  const hotelQ = useQuery<HotelRow | null>({
    queryKey: ['visibility', 'hotel', slug],
    queryFn: async () => {
      if (!slug) return null;
      const { data, error } = await supabase
        .from('hotels')
        .select('id, name, slug, description, amenities')
        .eq('slug', slug)
        .maybeSingle();
      if (error) throw error;
      return data as HotelRow | null;
    },
    enabled: !!slug,
    staleTime: 60_000,
  });
  const hotel = hotelQ.data ?? null;
  useGBPChecklistRealtime(hotel?.id);

  // Resolve manager role for this hotel
  useEffect(() => {
    let cancelled = false;
    if (!hotel?.id) return;
    (async () => {
      try {
        const { data } = await supabase.rpc('vaiyu_is_hotel_finance_manager', { p_hotel_id: hotel.id });
        if (!cancelled) setIsManager(Boolean(data));
      } catch {
        if (!cancelled) setIsManager(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hotel?.id]);

  const scoreQ = useQuery({
    queryKey: hotel?.id ? visibilityScoreQueryKeys.score(hotel.id) : ['visibility-score', 'noop'],
    queryFn: () => (hotel?.id ? getVisibilityScore(hotel.id) : Promise.resolve(null)),
    enabled: !!hotel?.id,
    staleTime: 15_000,
  });
  const historyQ = useQuery({
    queryKey: hotel?.id ? visibilityScoreQueryKeys.history(hotel.id, 12) : ['visibility-history', 'noop'],
    queryFn: () => (hotel?.id ? getVisibilityHistory(hotel.id, 12) : Promise.resolve([])),
    enabled: !!hotel?.id,
    staleTime: 60_000,
  });
  const cronHealthQ = useQuery({
    queryKey: hotel?.id ? visibilityScoreQueryKeys.cronHealth(hotel.id) : ['visibility-cron-health', 'noop'],
    queryFn: () => (hotel?.id ? getVisibilityCronHealth(hotel.id) : Promise.resolve(null)),
    enabled: !!hotel?.id,
    staleTime: 5 * 60_000,
  });
  const attestationsQ = useQuery({
    queryKey: hotel?.id ? visibilityScoreQueryKeys.attestations(hotel.id) : ['visibility-attestations', 'noop'],
    queryFn: () => (hotel?.id ? listVisibilityAttestations(hotel.id) : Promise.resolve([])),
    enabled: !!hotel?.id,
    staleTime: 15_000,
  });
  const attestationsByKey = (attestationsQ.data ?? []).reduce<
    Partial<Record<VisibilitySignalKey, HotelVisibilityAttestation>>
  >((acc, row) => {
    acc[row.signal_key as VisibilitySignalKey] = row;
    return acc;
  }, {});

  const refreshMut = useMutation({
    mutationFn: () => {
      if (!hotel?.id) throw new Error('No hotel');
      return snapshotVisibilityScore(hotel.id, isManager ? 'MANAGER_REFRESH' : 'OWNER_REFRESH');
    },
    onSuccess: () => {
      setRefreshError(null);
      if (!hotel?.id) return;
      qc.invalidateQueries({ queryKey: visibilityScoreQueryKeys.score(hotel.id) });
      qc.invalidateQueries({ queryKey: visibilityScoreQueryKeys.history(hotel.id, 12) });
      qc.invalidateQueries({ queryKey: visibilityScoreQueryKeys.history(hotel.id, 2) });
      qc.invalidateQueries({ queryKey: visibilityScoreQueryKeys.cronHealth(hotel.id) });
    },
    onError: (e: unknown) => {
      if (e instanceof VisibilityServiceError && e.code === 'RATE_LIMIT_REFRESH') {
        setRefreshError(
          isManager
            ? t('error.refreshRateLimitManager', 'You can refresh again in a minute — rate-limited to prevent runaway snapshots.')
            : t('error.refreshRateLimitOwner', 'You can refresh once every 5 minutes. Try again shortly.'),
        );
      } else {
        setRefreshError(e instanceof Error ? e.message : t('error.refreshFailed', 'Refresh failed.'));
      }
    },
  });

  if (!VISIBILITY_SCORE_ENABLED) {
    return (
      <main className="vaiyu-owner mx-auto max-w-3xl px-4 py-10 text-sm text-slate-400">
        {t('notEnabled', 'Visibility Score is disabled.')}
      </main>
    );
  }

  if (hotelQ.isLoading) {
    return (
      <main className="vaiyu-owner grid min-h-[40vh] place-items-center bg-[#0B0E14] text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </main>
    );
  }
  if (!hotel) {
    return (
      <main className="vaiyu-owner mx-auto max-w-3xl px-4 py-10 text-sm text-slate-400">
        {t('notFound', 'Hotel not found.')}
      </main>
    );
  }

  const breakdown = scoreQ.data?.breakdown;
  const band: VisibilityBand = breakdown?.band ?? 'ONBOARDING';
  const tone = tonePick(band);
  const score = breakdown?.total_score ?? 0;
  const onboarding = band === 'ONBOARDING' || !breakdown || breakdown.signals_total < 5;

  return (
    <main className="vaiyu-owner min-h-screen bg-[#0B0E14] text-slate-100">
      <div className="mx-auto max-w-4xl px-4 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <Link
            to={`/owner/${hotel.slug}/dashboard`}
            className="inline-flex items-center gap-1 text-[12px] text-slate-300 hover:text-slate-100"
          >
            <ArrowLeft className="h-4 w-4" /> {t('page.backToDashboard', 'Dashboard')}
          </Link>
          <h1 className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-100">
            <Gauge className="h-4 w-4 text-sky-300" /> {t('page.title', 'Visibility')} · {hotel.name}
          </h1>
          <button
            type="button"
            onClick={() => refreshMut.mutate()}
            disabled={refreshMut.isPending}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#0F1320] px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            data-testid="visibility-refresh"
          >
            {refreshMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {t('action.refresh', 'Refresh')}
          </button>
        </div>

        <VisibilityDisclaimerBanner />

        {/* Hero score */}
        <section className="rounded-2xl border border-slate-800 bg-[#0F1320] p-5" data-testid="visibility-hero">
          <div className="flex items-center gap-5">
            <div className={`rounded-full border ${TONE_TEXT[tone]}/40 p-1`}>
              <svg width="120" height="120" viewBox="0 0 120 120" className="-rotate-90">
                <circle cx="60" cy="60" r="48" className="stroke-slate-800" strokeWidth="10" fill="none" />
                <circle cx="60" cy="60" r="48"
                  className={TONE_STROKE[tone]} strokeWidth="10" fill="none"
                  strokeDasharray={Math.PI * 96}
                  strokeDashoffset={Math.PI * 96 * (1 - Math.max(0, Math.min(100, score)) / 100)}
                  strokeLinecap="round" />
              </svg>
              <div className="-mt-[120px] grid h-[120px] place-items-center">
                <span className={`text-3xl font-semibold ${TONE_TEXT[tone]}`}>
                  {onboarding ? '—' : Math.round(score)}
                </span>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className={`text-[14px] font-medium ${TONE_TEXT[tone]}`}>
                {lang === 'hi' ? t(`band.${band}`, VISIBILITY_BAND_LABEL[band]) : VISIBILITY_BAND_LABEL[band]}
              </div>
              {lang === 'en' && (
                <p className="mt-0.5 text-[12px] text-slate-400">
                  {VISIBILITY_BAND_LABEL_HI[band]}
                </p>
              )}
              {breakdown && (
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-400">
                  <div>
                    {t('hero.signalsSatisfied', 'Signals satisfied')}:{' '}
                    <span className="text-slate-200">
                      {breakdown.signals_satisfied} / {breakdown.signals_total}
                    </span>
                  </div>
                  {breakdown.signals_excluded > 0 && (
                    <div>
                      {t('hero.pendingData', 'Pending data')}:{' '}
                      <span className="text-slate-200">
                        {t('signal', '{{count}} signal', { count: breakdown.signals_excluded })}
                      </span>
                    </div>
                  )}
                  {breakdown.max_unlockable_weight > 0 && (
                    <div>
                      {t('hero.unlockableLater', 'Unlockable later')}:{' '}
                      <span className="text-slate-200">+{breakdown.max_unlockable_weight} {t('pts', 'pts')}</span>
                    </div>
                  )}
                </div>
              )}
              {refreshError && (
                <p className="mt-2 text-[11px] text-rose-300" role="alert">
                  {refreshError}
                </p>
              )}
            </div>
          </div>

          {/* Cron health warning — shows magnitude */}
          {cronHealthQ.data && cronHealthQ.data.healthy === false && (
            <p className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-200">
              {cronHealthQ.data.last_cron_snapshot_at
                ? t('cronHealth.stale', 'Last weekly snapshot was {{days}} days ago — take a manual snapshot via Refresh.', {
                    days: Math.floor((Date.now() - new Date(cronHealthQ.data.last_cron_snapshot_at).getTime()) / (24 * 60 * 60 * 1000)),
                  })
                : t('cronHealth.notStarted', "Weekly snapshots haven't started yet for this property. Take a manual snapshot via Refresh.")}
            </p>
          )}
        </section>

        {onboarding && (
          <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4 text-[12px] text-slate-200" data-testid="onboarding-state">
            <p className="font-medium">{t('onboarding.title', 'Onboarding — complete a few basics to unlock your score')}</p>
            <p className="mt-1 text-[11px] text-slate-400">
              {t('onboarding.body', 'The score appears once at least 5 signals are evaluable. Start with: phone number, address, map pin, logo, and at least one GMB attestation.')}
            </p>
          </section>
        )}

        {scoreQ.isLoading && (
          <div className="py-6 text-center">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500" />
          </div>
        )}

        {breakdown && (
          <>
            <GoogleBusinessChecklist
              hotelId={hotel.id}
              hotelSlug={hotel.slug}
              breakdown={breakdown}
              attestationsByKey={attestationsByKey}
              isManager={isManager}
              hotelDescription={hotel.description}
              hotelAmenities={hotel.amenities}
            />

            <VisibilityTrendChart snapshots={historyQ.data ?? []} />

            <VisibilityBreakdown
              hotelId={hotel.id}
              hotelSlug={hotel.slug}
              breakdown={breakdown}
              attestationsByKey={attestationsByKey}
              isManager={isManager}
            />
          </>
        )}
      </div>
    </main>
  );
}
