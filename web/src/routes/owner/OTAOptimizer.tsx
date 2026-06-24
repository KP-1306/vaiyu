// web/src/routes/owner/OTAOptimizer.tsx
//
// OTA Listing Optimizer workspace — Growth Hub Position 2 (growth sheet).
//
// Identity: INTERNAL self-audit workbook across 8 OTAs. NOT a channel
// manager. Does not connect to any OTA, change any listing, or sync any
// rate/inventory/booking. All scoring is deterministic.

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ClipboardList, Compass, RotateCcw } from 'lucide-react';

import { supabase } from '../../lib/supabase';
import { useOwnerT } from '../../i18n/useOwnerT';
import {
  OTA_DISCLAIMER_EN,
  OTA_DISCLAIMER_HI,
  OTA_LISTING_OPTIMIZER_V0_ENABLED,
  OTA_PLATFORM_ORDER,
} from '../../config/otaOptimizer';
import {
  friendlyOtaError,
  getOtaReadinessByOta,
  getOtaReadinessSummary,
  getOtaSettings,
  listOtaReadinessState,
  resetOtaReadiness,
} from '../../services/otaOptimizerService';
import { otaOptimizerQueryKeys } from '../../services/otaOptimizerQueryKeys';
import { useOTAReadinessRealtime } from '../../hooks/useOTAReadinessRealtime';
import { OTASettingsStrip } from '../../components/ota/OTASettingsStrip';
import { OTAMatrixView } from '../../components/ota/OTAMatrixView';
import { OTAEditPanel } from '../../components/ota/OTAEditPanel';
import { OTAReadinessWizard } from '../../components/ota/OTAReadinessWizard';
import { OTAServiceError } from '../../types/otaOptimizer';
import type { OTAPlatform, OTAReadinessCategory } from '../../types/otaOptimizer';

interface HotelRow {
  id: string;
  slug: string;
  name: string;
  state: string | null;
}

export default function OTAOptimizer() {
  const { slug = '' } = useParams<{ slug: string }>();
  const t = useOwnerT('owner-ota');
  const [forceWizard, setForceWizard] = useState(false);
  const [drilldown, setDrilldown] = useState<{ ota: OTAPlatform; category: OTAReadinessCategory } | null>(null);
  const [resetAllBusy, setResetAllBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  if (!OTA_LISTING_OPTIMIZER_V0_ENABLED) {
    return (
      <main className="vaiyu-owner min-h-screen bg-[#0B0E14] p-6 text-slate-300">
        {t('page.title', 'OTA Listing Optimizer')} is disabled.
      </main>
    );
  }

  const hotelQ = useQuery<HotelRow | null>({
    queryKey: ['ota-optimizer', 'hotel-by-slug', slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hotels')
        .select('id, slug, name, state')
        .eq('slug', slug)
        .maybeSingle();
      if (error) throw error;
      return data as HotelRow | null;
    },
    enabled: !!slug,
    staleTime: 60_000,
  });
  const hotel = hotelQ.data ?? null;
  const hotelId = hotel?.id ?? null;
  useOTAReadinessRealtime(hotelId ?? undefined);

  const settingsQ = useQuery({
    queryKey: hotelId ? otaOptimizerQueryKeys.settings(hotelId) : ['ota-optimizer', 'noop-settings'],
    queryFn: () => (hotelId ? getOtaSettings(hotelId) : Promise.resolve(null)),
    enabled: !!hotelId,
    staleTime: 30_000,
  });

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

  const stateQ = useQuery({
    queryKey: hotelId ? otaOptimizerQueryKeys.state(hotelId) : ['ota-optimizer', 'noop-state'],
    queryFn: () => (hotelId ? listOtaReadinessState(hotelId) : Promise.resolve([])),
    enabled: !!hotelId,
    staleTime: 30_000,
  });

  const isLoading = hotelQ.isLoading || settingsQ.isLoading || summaryQ.isLoading || byOtaQ.isLoading || stateQ.isLoading;
  const isError = hotelQ.isError || settingsQ.isError || summaryQ.isError || byOtaQ.isError || stateQ.isError;

  // Wizard should open automatically if it hasn't been completed yet
  const wizardCompletedAt = settingsQ.data?.wizard_completed_at ?? null;
  const shouldShowWizard = !!hotelId && !isLoading && (forceWizard || !wizardCompletedAt);

  // Active OTAs (default to all 8 if no settings row yet)
  const activeOtas: OTAPlatform[] = settingsQ.data?.active_otas ?? OTA_PLATFORM_ORDER;
  const mountainOverride = settingsQ.data?.show_mountain_checks_override ?? null;
  const effectiveMountain = summaryQ.data?.effective_mountain ?? byOtaQ.data?.[0]?.effective_mountain ?? false;

  // Auto-clear stale drilldown when its OTA leaves active set
  useEffect(() => {
    if (drilldown && !activeOtas.includes(drilldown.ota)) setDrilldown(null);
  }, [activeOtas, drilldown]);

  async function handleResetAll() {
    if (!hotelId) return;
    if (!window.confirm(t('confirm.resetAll', 'Reset ALL OTA Optimizer state for every OTA? This deletes all status history for this hotel.'))) {
      return;
    }
    setResetError(null);
    setResetAllBusy(true);
    try {
      await resetOtaReadiness(hotelId);
      // Reset query cache by invalidating the hotel scope key
      summaryQ.refetch();
      byOtaQ.refetch();
      stateQ.refetch();
    } catch (e) {
      const code = e instanceof OTAServiceError ? e.code : null;
      setResetError(friendlyOtaError(code, t('error.loadFailed', 'Could not reset OTA Optimizer state.')));
    } finally {
      setResetAllBusy(false);
    }
  }

  return (
    <main className="vaiyu-owner min-h-screen bg-[#0B0E14]">
      <div className="mx-auto max-w-6xl p-4 md:p-6 space-y-4">
        {/* Header */}
        <header className="flex items-start justify-between gap-3">
          <div>
            <Link
              to={`/owner/${slug}`}
              className="inline-flex items-center gap-1 text-[12px] text-slate-400 hover:text-slate-200"
            >
              <ArrowLeft className="h-3 w-3" /> {t('nav.back', 'Back to dashboard')}
            </Link>
            <h1 className="mt-2 text-lg font-semibold text-slate-100 flex items-center gap-2">
              <Compass className="h-5 w-5 text-sky-300" />
              {t('page.title', 'OTA Listing Optimizer')}
              <span className="inline-flex items-center rounded-md border border-sky-500/40 bg-sky-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-200">
                v0
              </span>
            </h1>
            <p className="mt-1 max-w-2xl text-[12px] text-slate-400">{OTA_DISCLAIMER_EN}</p>
            <p className="mt-1 max-w-2xl text-[11px] text-slate-500">{OTA_DISCLAIMER_HI}</p>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-2">
            <button
              type="button"
              onClick={() => setForceWizard(true)}
              className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-[12px] text-sky-200 hover:bg-sky-500/20"
            >
              <ClipboardList className="h-3 w-3" />
              {t('action.rerunSetup', 'Re-run setup')}
            </button>
            <button
              type="button"
              onClick={handleResetAll}
              disabled={resetAllBusy || !hotelId}
              className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[12px] text-rose-200 hover:bg-rose-500/20 disabled:opacity-60"
            >
              <RotateCcw className="h-3 w-3" />
              {t('action.resetAll', 'Reset all')}
            </button>
          </div>
        </header>

        {resetError && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200" role="alert">
            {resetError}
          </div>
        )}

        {/* Loading / Error / Content */}
        {isLoading && (
          <div className="rounded-2xl border border-slate-800 bg-[#151A25] p-8 text-center text-slate-400">
            {t('loading', 'Loading…')}
          </div>
        )}

        {isError && !isLoading && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-[13px] text-rose-200">
            {t('error.loadFailed', 'Could not load OTA Optimizer data. Refresh the page.')}
          </div>
        )}

        {!isLoading && !isError && hotel && hotelId && (
          <>
            {/* Settings strip */}
            <OTASettingsStrip
              hotelId={hotelId}
              activeOtas={activeOtas}
              mountainOverride={mountainOverride}
              effectiveMountain={effectiveMountain}
            />

            {/* Matrix view */}
            <OTAMatrixView
              activeOtas={activeOtas}
              effectiveMountain={effectiveMountain}
              state={stateQ.data ?? []}
              perOta={byOtaQ.data ?? []}
              onSelectCell={(o, c) => setDrilldown({ ota: o, category: c })}
            />

            {/* Drilldown (when a cell is selected) */}
            {drilldown && (
              <OTAEditPanel
                hotelId={hotelId}
                hotelSlug={slug}
                ota={drilldown.ota}
                category={drilldown.category}
                effectiveMountain={effectiveMountain}
                state={stateQ.data ?? []}
                onClose={() => setDrilldown(null)}
              />
            )}
          </>
        )}

        {/* Wizard overlay */}
        {shouldShowWizard && hotelId && hotel && (
          <OTAReadinessWizard
            hotelId={hotelId}
            hotelState={hotel.state}
            hotelName={hotel.name}
            initialActiveOtas={activeOtas}
            initialMountainOverride={mountainOverride}
            effectiveMountain={effectiveMountain}
            onComplete={() => {
              setForceWizard(false);
              settingsQ.refetch();
              summaryQ.refetch();
              byOtaQ.refetch();
              stateQ.refetch();
            }}
            onSkip={() => setForceWizard(false)}
          />
        )}
      </div>
    </main>
  );
}
