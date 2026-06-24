// web/src/components/ota/OTAReadinessWizard.tsx
//
// Cold-start wizard for OTA Listing Optimizer. 4 steps:
//   1. Select active OTAs (defaults to all 8)
//   2. Confirm mountain-checks visibility (auto-derived; allow override)
//   3. Quick first-pass status entry for the top categories on each OTA
//   4. Done — stamp wizard_completed_at on settings
//
// Idempotent: re-running the wizard just re-stamps timestamps; existing
// statuses preserved.

import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Mountain, X } from 'lucide-react';
import {
  OTA_DISCLAIMER_EN,
  OTA_DISCLAIMER_HI,
  OTA_PLATFORM_DESC_EN,
  OTA_PLATFORM_DESC_HI,
  OTA_PLATFORM_LABEL,
  OTA_PLATFORM_ORDER,
  OTA_STATUS_LABEL,
  applicableCatalogItems,
  isStateMountain,
} from '../../config/otaOptimizer';
import {
  bulkSetOtaReadiness,
  completeOtaWizard,
  friendlyOtaError,
  setOtaActiveOtas,
  setOtaMountainOverride,
} from '../../services/otaOptimizerService';
import { otaOptimizerQueryKeys } from '../../services/otaOptimizerQueryKeys';
import {
  OTAServiceError,
  type OTABulkSetItem,
  type OTAPlatform,
  type OTAReadinessStatus,
} from '../../types/otaOptimizer';
import { useOwnerT, useOwnerLang } from '../../i18n/useOwnerT';

interface Props {
  hotelId: string;
  hotelState: string | null;
  hotelName: string;
  initialActiveOtas: OTAPlatform[];
  initialMountainOverride: boolean | null;
  effectiveMountain: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

type Step = 1 | 2 | 3 | 4;

export function OTAReadinessWizard({
  hotelId,
  hotelState,
  hotelName,
  initialActiveOtas,
  initialMountainOverride,
  effectiveMountain: initialEffective,
  onComplete,
  onSkip,
}: Props) {
  const t = useOwnerT('owner-ota');
  const lang = useOwnerLang();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>(1);
  const [active, setActive] = useState<OTAPlatform[]>(initialActiveOtas);
  const [mtnOverride, setMtnOverride] = useState<boolean | null>(initialMountainOverride);
  // Quick first-pass: per-OTA top items (LISTING_QUALITY + PHOTOS_MEDIA = 11 items per OTA)
  const [quick, setQuick] = useState<Record<string, OTAReadinessStatus>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveMountain = useMemo(() => {
    if (mtnOverride !== null) return mtnOverride;
    return isStateMountain(hotelState);
  }, [mtnOverride, hotelState]);

  const platformDesc = lang === 'hi' ? OTA_PLATFORM_DESC_HI : OTA_PLATFORM_DESC_EN;

  function quickKey(o: OTAPlatform, itemKey: string) {
    return `${o}|${itemKey}`;
  }

  function toggleOta(o: OTAPlatform) {
    setActive((cur) => (cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]));
  }

  async function handleNextFrom1() {
    if (active.length === 0) {
      setError(t('error.minOneOtaWizard', 'Select at least one OTA.'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await setOtaActiveOtas(hotelId, active);
      qc.invalidateQueries({ queryKey: otaOptimizerQueryKeys.hotel(hotelId) });
      setStep(2);
    } catch (e) {
      const code = e instanceof OTAServiceError ? e.code : null;
      setError(friendlyOtaError(code, t('error.saveOtasFailed', 'Could not save OTA selection.')));
    } finally {
      setBusy(false);
    }
  }

  async function handleNextFrom2() {
    setError(null);
    setBusy(true);
    try {
      await setOtaMountainOverride(hotelId, mtnOverride as boolean);
      qc.invalidateQueries({ queryKey: otaOptimizerQueryKeys.hotel(hotelId) });
      setStep(3);
    } catch (e) {
      const code = e instanceof OTAServiceError ? e.code : null;
      setError(friendlyOtaError(code, t('error.saveMountainFailed', 'Could not save mountain preference.')));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveQuickAndFinish() {
    setError(null);
    setBusy(true);

    // Build bulk payload from any quick entries provided
    const payload: OTABulkSetItem[] = [];
    for (const o of active) {
      const items = applicableCatalogItems(o, effectiveMountain).filter(
        (i) => i.category === 'LISTING_QUALITY' || i.category === 'PHOTOS_MEDIA',
      );
      for (const item of items) {
        const status = quick[quickKey(o, item.itemKey)];
        if (status !== undefined) {
          payload.push({ ota: o, category: item.category, item_key: item.itemKey, status });
        }
      }
    }

    try {
      if (payload.length > 0) {
        // Chunk to 200 items per request (RPC cap)
        for (let i = 0; i < payload.length; i += 200) {
          await bulkSetOtaReadiness(hotelId, payload.slice(i, i + 200));
        }
      }
      await completeOtaWizard(hotelId);
      qc.invalidateQueries({ queryKey: otaOptimizerQueryKeys.hotel(hotelId) });
      setStep(4);
      // Auto-close after a beat
      setTimeout(onComplete, 1200);
    } catch (e) {
      const code = e instanceof OTAServiceError ? e.code : null;
      setError(friendlyOtaError(code, t('error.saveInitialFailed', 'Could not save initial statuses.')));
    } finally {
      setBusy(false);
    }
  }

  const step2Options = [
    { value: null, label: t('wizard.step2.optAuto', 'Auto'), desc: t('wizard.step2.autoDesc', 'Use state-based default') },
    { value: true, label: t('wizard.step2.optYes', 'Yes'), desc: t('wizard.step2.yesDesc', 'Show mountain checks') },
    { value: false, label: t('wizard.step2.optNo', 'No'), desc: t('wizard.step2.noDesc', 'Hide mountain checks') },
  ] as const;

  return (
    <div className="vaiyu-owner fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 md:p-8">
      <div className="w-full max-w-3xl rounded-2xl border border-slate-800 bg-[#0F1320] p-6 shadow-2xl">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              {t('wizard.title', 'OTA Listing Optimizer — first-time setup')}
            </h2>
            <p className="mt-0.5 text-[12px] text-slate-400">
              {t('wizard.subtitle', 'About 15 minutes. You can skip and resume anytime.')}
            </p>
          </div>
          <button
            type="button"
            onClick={onSkip}
            className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
          >
            <X className="inline h-3 w-3 mr-0.5" />
            {t('wizard.skip', 'Skip')}
          </button>
        </header>

        {/* Progress dots */}
        <div className="mt-4 flex items-center gap-1.5">
          {([1, 2, 3, 4] as Step[]).map((n) => (
            <span
              key={n}
              className={[
                'h-1.5 rounded-full transition-all',
                n === step ? 'w-8 bg-sky-400' : n < step ? 'w-4 bg-emerald-400' : 'w-4 bg-slate-700',
              ].join(' ')}
              aria-label={n === step
                ? t('wizard.stepLabelCurrent', 'Step {{n}} (current)', { n })
                : t('wizard.stepLabel', 'Step {{n}}', { n })}
            />
          ))}
        </div>

        {/* Step 1: active OTAs */}
        {step === 1 && (
          <section className="mt-5">
            <h3 className="text-sm font-medium text-slate-100">{t('wizard.step1.title', 'Which OTAs do you list on?')}</h3>
            <p className="mt-0.5 text-[12px] text-slate-400">
              {t('wizard.step1.desc', 'Toggle off the OTAs you don\'t use. You can change this later.')}
            </p>
            <div className="mt-3 grid gap-1.5">
              {OTA_PLATFORM_ORDER.map((o) => {
                const on = active.includes(o);
                return (
                  <button
                    key={o}
                    type="button"
                    onClick={() => toggleOta(o)}
                    className={[
                      'flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                      on
                        ? 'border-sky-500/40 bg-sky-500/10 text-sky-100'
                        : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:border-slate-600',
                    ].join(' ')}
                    aria-pressed={on}
                  >
                    <span>
                      <span className="block text-[13px] font-medium">{OTA_PLATFORM_LABEL[o]}</span>
                      <span className="mt-0.5 block text-[11px] text-slate-400">{platformDesc[o]}</span>
                    </span>
                    <span
                      className={[
                        'inline-flex h-5 w-9 items-center rounded-full transition-colors',
                        on ? 'bg-sky-500' : 'bg-slate-700',
                      ].join(' ')}
                    >
                      <span
                        className={[
                          'h-3.5 w-3.5 rounded-full bg-white transition-transform',
                          on ? 'translate-x-5' : 'translate-x-1',
                        ].join(' ')}
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Step 2: mountain confirmation */}
        {step === 2 && (
          <section className="mt-5">
            <div className="flex items-center gap-2">
              <Mountain className="h-4 w-4 text-amber-300" />
              <h3 className="text-sm font-medium text-slate-100">{t('wizard.step2.title', 'Mountain property disclosures?')}</h3>
            </div>
            <p className="mt-0.5 text-[12px] text-slate-400">
              {t('wizard.step2.desc', 'Adds 13 extra checks for parking, steep roads, snow, heating, hot water, etc. — important for mountain properties.')}
            </p>
            <div className="mt-3 rounded-lg border border-slate-800 bg-[#0B0E14] p-3 text-[12px] text-slate-300">
              <div>
                {t('wizard.step2.hotelLabel', 'Hotel')}: <span className="font-medium">{hotelName}</span>
              </div>
              <div className="mt-0.5">
                {t('wizard.step2.stateLabel', 'State')}: <span className="font-medium">{hotelState ?? '—'}</span>
                {isStateMountain(hotelState) && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
                    {t('wizard.step2.mountainDetected', 'detected as mountain state')}
                  </span>
                )}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
              {step2Options.map((opt) => (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => setMtnOverride(opt.value)}
                  className={[
                    'rounded-lg border px-3 py-2 text-left transition-colors',
                    mtnOverride === opt.value
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-100'
                      : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:border-slate-600',
                  ].join(' ')}
                  aria-pressed={mtnOverride === opt.value}
                >
                  <div className="text-[13px] font-medium">{opt.label}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{opt.desc}</div>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              {effectiveMountain
                ? t('wizard.step2.currentlyShowing', '13 mountain checks will be shown')
                : t('wizard.step2.currentlyHidden', 'Mountain checks hidden')}
            </p>
          </section>
        )}

        {/* Step 3: quick first-pass */}
        {step === 3 && (
          <section className="mt-5">
            <h3 className="text-sm font-medium text-slate-100">{t('wizard.step3.title', 'Quick first-pass (optional)')}</h3>
            <p className="mt-0.5 text-[12px] text-slate-400">
              {t('wizard.step3.desc', 'Mark the most important items per OTA. You can skip and come back to fill more.')}
            </p>
            <div className="mt-3 max-h-[400px] overflow-y-auto space-y-3">
              {active.map((o) => {
                const items = applicableCatalogItems(o, effectiveMountain).filter(
                  (i) => i.category === 'LISTING_QUALITY' || i.category === 'PHOTOS_MEDIA',
                );
                return (
                  <div key={o} className="rounded-lg border border-slate-800 bg-[#0B0E14] p-3">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                      {OTA_PLATFORM_LABEL[o]}
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {items.map((item) => (
                        <div key={item.itemKey} className="flex items-center justify-between gap-2">
                          <div className="min-w-0 text-[12px] text-slate-300">
                            {lang === 'hi' ? item.labelHi : item.labelEn}
                          </div>
                          <div className="flex gap-1 shrink-0">
                            {(['COMPLETE', 'PARTIAL', 'MISSING'] as OTAReadinessStatus[]).map((s) => {
                              const k = quickKey(o, item.itemKey);
                              const on = quick[k] === s;
                              return (
                                <button
                                  key={s}
                                  type="button"
                                  onClick={() =>
                                    setQuick((cur) => ({ ...cur, [k]: on ? ('UNKNOWN' as OTAReadinessStatus) : s }))
                                  }
                                  className={[
                                    'rounded-md px-1.5 py-0.5 text-[10px] font-medium',
                                    on
                                      ? s === 'COMPLETE'
                                        ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40'
                                        : s === 'PARTIAL'
                                        ? 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40'
                                        : 'bg-rose-500/20 text-rose-200 ring-1 ring-rose-500/40'
                                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200',
                                  ].join(' ')}
                                >
                                  {t(`status.${s}`, OTA_STATUS_LABEL[s])}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              {t('wizard.step3.blankNote', 'Items left blank stay as "Not reviewed" — set them later from the workspace.')}
            </p>
          </section>
        )}

        {/* Step 4: done */}
        {step === 4 && (
          <section className="mt-6 flex flex-col items-center justify-center py-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-400" />
            <h3 className="mt-3 text-base font-medium text-slate-100">{t('wizard.step4.title', 'All set')}</h3>
            <p className="mt-1 text-[12px] text-slate-400">
              {t('wizard.step4.desc', 'Continue in the workspace. You can re-run this setup anytime.')}
            </p>
          </section>
        )}

        {error && (
          <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200" role="alert">
            {error}
          </div>
        )}

        {/* Footer: nav buttons */}
        {step !== 4 && (
          <footer className="mt-5 flex items-center justify-between gap-2">
            {step > 1 ? (
              <button
                type="button"
                onClick={() => setStep((step - 1) as Step)}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-3 py-1.5 text-[12px] text-slate-300 hover:bg-slate-800 disabled:opacity-60"
              >
                <ArrowLeft className="h-3 w-3" /> {t('wizard.nav.back', 'Back')}
              </button>
            ) : <span />}

            {step === 1 && (
              <button
                type="button"
                onClick={handleNextFrom1}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md bg-sky-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-sky-400 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {t('wizard.nav.next', 'Next')} <ArrowRight className="h-3 w-3" />
              </button>
            )}
            {step === 2 && (
              <button
                type="button"
                onClick={handleNextFrom2}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md bg-sky-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-sky-400 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {t('wizard.nav.next', 'Next')} <ArrowRight className="h-3 w-3" />
              </button>
            )}
            {step === 3 && (
              <button
                type="button"
                onClick={handleSaveQuickAndFinish}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-emerald-400 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {t('wizard.nav.finish', 'Finish setup')}
              </button>
            )}
          </footer>
        )}

        {/* Disclaimers — pinned bottom (bilingual data, shown both always) */}
        <p className="mt-4 border-t border-slate-800 pt-3 text-[10px] text-slate-500">
          {OTA_DISCLAIMER_EN}
        </p>
        <p className="mt-1 text-[10px] text-slate-500">{OTA_DISCLAIMER_HI}</p>
      </div>
    </div>
  );
}
