// web/src/components/owner/LocalSeoPlannerCard.tsx
//
// Dashboard widget for the Local SEO Landing Planner. Counts blueprints by
// risk + status (read-model RPC, designed to be reused later by Visibility Score).

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ShieldCheck, ShieldAlert, ShieldQuestion, CircleAlert } from 'lucide-react';
import { LOCAL_SEO_LANDING_PLANNER_V0_ENABLED } from '../../config/localSeoPlanner';
import { getSeoBlueprintSummary } from '../../services/seoBlueprintService';
import { seoBlueprintQueryKeys } from '../../services/seoBlueprintQueryKeys';
import { useSeoBlueprintsRealtime } from '../../hooks/useSeoBlueprintsRealtime';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  hotelId: string;
  hotelSlug: string;
}

export function LocalSeoPlannerCard({ hotelId, hotelSlug }: Props) {
  const t = useOwnerT('owner-cards');
  if (!LOCAL_SEO_LANDING_PLANNER_V0_ENABLED) return null;

  // hotelId is passed by the parent (OwnerDashboard already resolved slug->id),
  // so there is no redundant per-card hotels lookup.
  useSeoBlueprintsRealtime(hotelId);

  const summaryQ = useQuery({
    queryKey: hotelId ? seoBlueprintQueryKeys.summary(hotelId) : ['seo-blueprint-summary', 'noop'],
    queryFn: () => (hotelId ? getSeoBlueprintSummary(hotelId) : Promise.resolve(null)),
    enabled: !!hotelId,
    staleTime: 30_000,
  });

  const s = summaryQ.data;
  const safeCount = s?.byRisk.SAFE_BLUEPRINT ?? 0;
  const needsProof = s?.byRisk.NEEDS_PROOF ?? 0;
  const risky =
    (s?.byRisk.RISKY_DOORWAY ?? 0) +
    (s?.byRisk.FAKE_LOCAL_CLAIM ?? 0) +
    (s?.byRisk.DUPLICATE_LOW_VALUE ?? 0);
  const inReview = s?.byStatus.IN_REVIEW ?? 0;
  const readyToBuild = s?.byStatus.READY_TO_BUILD ?? 0;

  return (
    <Link
      to={`/owner/${hotelSlug}/seo-planner`}
      data-testid="local-seo-planner-card"
      className="block rounded-2xl border border-slate-800 bg-[#151A25] p-4 hover:border-slate-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0E14]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-9 w-9 shrink-0 rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 flex items-center justify-center">
            <ShieldCheck className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-slate-100">{t('localSeo.title', 'Local SEO Planner')}</h3>
              <span className="inline-flex items-center rounded-md border border-emerald-500/40 bg-emerald-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-200">
                v0
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {t('localSeo.subtitle', 'Plan + govern local page ideas. Internal only — publishes nothing.')}
            </p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-slate-500 shrink-0" aria-hidden />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Metric icon={<ShieldCheck className="h-3 w-3" />} label={t('localSeo.safe', 'Safe')} value={safeCount} tone="emerald" />
        <Metric icon={<ShieldQuestion className="h-3 w-3" />} label={t('localSeo.needsProof', 'Needs proof')} value={needsProof} tone="amber" />
        <Metric icon={<ShieldAlert className="h-3 w-3" />} label={t('localSeo.risky', 'Risky')} value={risky} tone="rose" />
      </div>

      {(inReview > 0 || readyToBuild > 0) && (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0B0E14] px-2.5 py-1.5 text-[11px] text-slate-300">
          <CircleAlert className="h-3.5 w-3.5 shrink-0 text-sky-300" aria-hidden />
          <span>
            {inReview > 0 && t('localSeo.inReview', '{{count}} in review', { count: inReview })}
            {inReview > 0 && readyToBuild > 0 && ' · '}
            {readyToBuild > 0 && t('localSeo.readyToBuild', '{{count}} ready to build', { count: readyToBuild })}
          </span>
        </div>
      )}

      <p className="mt-3 text-[10px] text-slate-500">
        {t('localSeo.footer', 'Deterministic Policy Shield. No AI. No keyword scraping. No metadata changes.')}
      </p>
    </Link>
  );
}

function Metric({
  icon, label, value, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'emerald' | 'amber' | 'rose';
}) {
  const cls =
    tone === 'emerald' ? 'text-emerald-200' :
    tone === 'amber'   ? 'text-amber-200' :
                         'text-rose-200';
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
