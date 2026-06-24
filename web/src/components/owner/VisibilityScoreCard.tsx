// web/src/components/owner/VisibilityScoreCard.tsx
//
// Hero card for the Owner Dashboard right rail — top slot. Shows the current
// readiness score, band, 7-day delta, and a deep-link into the workspace.
//
// Dark-theme to match the existing dashboard surfaces.

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Gauge, TrendingDown, TrendingUp, Minus } from 'lucide-react';

import {
  VISIBILITY_BAND_LABEL,
  VISIBILITY_BAND_TONE,
  VISIBILITY_SCORE_ENABLED,
} from '../../config/visibilityScore';
import {
  getVisibilityHistory,
  getVisibilityScore,
} from '../../services/visibilityScoreService';
import { visibilityScoreQueryKeys } from '../../services/visibilityScoreQueryKeys';
import type { VisibilityBand } from '../../types/visibilityScore';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  hotelId: string;
  hotelSlug: string;
}

const TONE_COLOR_CLASS: Record<ReturnType<typeof tonePick>, string> = {
  emerald: 'text-emerald-300 border-emerald-500/40',
  sky:     'text-sky-300 border-sky-500/40',
  amber:   'text-amber-300 border-amber-500/40',
  rose:    'text-rose-300 border-rose-500/40',
  slate:   'text-slate-300 border-slate-600/60',
};
const TONE_STROKE_CLASS: Record<ReturnType<typeof tonePick>, string> = {
  emerald: 'stroke-emerald-400',
  sky:     'stroke-sky-400',
  amber:   'stroke-amber-400',
  rose:    'stroke-rose-400',
  slate:   'stroke-slate-400',
};

function tonePick(b: VisibilityBand) {
  return VISIBILITY_BAND_TONE[b];
}

export function VisibilityScoreCard({ hotelId, hotelSlug }: Props) {
  const t = useOwnerT('owner-visibility');
  if (!VISIBILITY_SCORE_ENABLED) return null;

  const scoreQ = useQuery({
    queryKey: visibilityScoreQueryKeys.score(hotelId),
    queryFn: () => getVisibilityScore(hotelId),
    enabled: !!hotelId,
    staleTime: 30_000,
  });
  const historyQ = useQuery({
    queryKey: visibilityScoreQueryKeys.history(hotelId, 2),
    queryFn: () => getVisibilityHistory(hotelId, 2),
    enabled: !!hotelId,
    staleTime: 60_000,
  });

  const breakdown = scoreQ.data?.breakdown;
  const score = breakdown?.total_score ?? 0;
  const band: VisibilityBand = breakdown?.band ?? 'ONBOARDING';
  const tone = tonePick(band);
  const colorCls = TONE_COLOR_CLASS[tone];
  const strokeCls = TONE_STROKE_CLASS[tone];

  // Latest snapshot vs the one before it (if any)
  const snapshots = historyQ.data ?? [];
  const latest = snapshots[0];
  const prior = snapshots[1];
  const delta = latest && prior ? Math.round((latest.total_score - prior.total_score) * 10) / 10 : null;
  // A brand-new hotel will see its first snapshot land days after onboarding,
  // and the second snapshot a week later. Until then, the score is jittery —
  // a -4.5 delta against a near-zero prior reads as "I'm getting worse" when
  // it actually means "I just started." Surface that explicitly when there
  // are fewer than 3 snapshots so the operator doesn't misread the trend.
  const stillStabilizing = snapshots.length > 0 && snapshots.length < 3;

  const ringRadius = 28;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringPct = breakdown ? Math.max(0, Math.min(100, score)) : 0;
  const ringStrokeDashoffset = ringCircumference * (1 - ringPct / 100);

  return (
    <Link
      to={`/owner/${hotelSlug}/visibility`}
      className="block rounded-2xl border border-slate-800 bg-[#0F1320] p-4 hover:border-slate-700 transition-colors"
      data-testid="visibility-score-card"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Gauge className={`h-4 w-4 ${colorCls.split(' ')[0]}`} aria-hidden />
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-300">
            {t('card.title', 'Visibility Score')}
          </h3>
        </div>
        <ChevronRight className="h-4 w-4 text-slate-500" aria-hidden />
      </div>

      <div className="mt-3 flex items-center gap-4">
        {/* SVG ring */}
        <div className={`relative shrink-0 rounded-full border ${colorCls} p-1`}>
          <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90">
            <circle cx="36" cy="36" r={ringRadius}
              className="stroke-slate-800" strokeWidth="6" fill="none" />
            <circle cx="36" cy="36" r={ringRadius}
              className={strokeCls} strokeWidth="6" fill="none"
              strokeDasharray={ringCircumference}
              strokeDashoffset={ringStrokeDashoffset}
              strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-xl font-semibold ${colorCls.split(' ')[0]}`}>
              {breakdown ? Math.round(score) : '—'}
            </span>
          </div>
        </div>

        {/* Right column */}
        <div className="min-w-0 flex-1">
          <div className={`text-[13px] font-medium ${colorCls.split(' ')[0]}`}>
            {VISIBILITY_BAND_LABEL[band]}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            {breakdown
              ? t('card.signalsSatisfied', '{{satisfied}}/{{total}} signals satisfied', { satisfied: breakdown.signals_satisfied, total: breakdown.signals_total })
              : t('card.loading', 'Loading…')}
          </div>
          {breakdown && breakdown.max_unlockable_weight > 0 && (
            <div className="mt-0.5 text-[10px] text-slate-500">
              {t('card.ptsPending', '{{pts}} pts pending data', { pts: breakdown.max_unlockable_weight })}
            </div>
          )}
          {/* Delta chip and stabilization hint are mutually exclusive. While
              the hotel is still in its first 3 snapshots, the prior baseline
              is mostly noise (zeros + onboarding) — a red "-4.5" chip there
              reads as "you're regressing" when it actually means "you just
              started". Show *only* the stabilization hint in that window. */}
          {stillStabilizing ? (
            <div className="mt-1.5 text-[10px] text-slate-500 leading-snug">
              {t('card.stabilizing', 'Score stabilizes after the first 7 days of snapshots.')}
            </div>
          ) : delta !== null && delta !== 0 ? (
            <div
              className={`mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] ${
                delta > 0
                  ? 'bg-emerald-500/10 text-emerald-300'
                  : 'bg-rose-500/10 text-rose-300'
              }`}
            >
              {delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              <span>{delta > 0 ? `+${delta}` : delta} {t('card.sinceLastSnapshot', 'since last snapshot')}</span>
            </div>
          ) : delta === 0 ? (
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-1.5 py-0.5 text-[10px] text-slate-300">
              <Minus className="h-3 w-3" />
              <span>{t('card.noChange', 'No change since last snapshot')}</span>
            </div>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
