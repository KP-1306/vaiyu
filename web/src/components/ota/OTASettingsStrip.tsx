// web/src/components/ota/OTASettingsStrip.tsx
//
// Settings strip at the top of OTA Optimizer workspace — manage the active
// OTA set + the mountain-checks override.

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Mountain, Settings, Loader2, Check } from 'lucide-react';
import {
  OTA_PLATFORM_LABEL,
  OTA_PLATFORM_ORDER,
} from '../../config/otaOptimizer';
import {
  friendlyOtaError,
  setOtaActiveOtas,
  setOtaMountainOverride,
} from '../../services/otaOptimizerService';
import { otaOptimizerQueryKeys } from '../../services/otaOptimizerQueryKeys';
import { OTAServiceError } from '../../types/otaOptimizer';
import type { OTAPlatform } from '../../types/otaOptimizer';

interface Props {
  hotelId: string;
  activeOtas: OTAPlatform[];
  mountainOverride: boolean | null;
  effectiveMountain: boolean;
}

export function OTASettingsStrip({ hotelId, activeOtas, mountainOverride, effectiveMountain }: Props) {
  const qc = useQueryClient();
  const [savingOtas, setSavingOtas] = useState(false);
  const [savingMtn, setSavingMtn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number>(0);

  const isActive = (o: OTAPlatform) => activeOtas.includes(o);

  async function toggleOta(o: OTAPlatform) {
    setError(null);
    const next = isActive(o) ? activeOtas.filter((x) => x !== o) : [...activeOtas, o];
    if (next.length === 0) {
      setError('Select at least one OTA to keep active.');
      return;
    }
    setSavingOtas(true);
    try {
      await setOtaActiveOtas(hotelId, next);
      qc.invalidateQueries({ queryKey: otaOptimizerQueryKeys.hotel(hotelId) });
      setSavedAt(Date.now());
    } catch (e) {
      const code = e instanceof OTAServiceError ? e.code : null;
      setError(friendlyOtaError(code, 'Could not save OTA selection.'));
    } finally {
      setSavingOtas(false);
    }
  }

  async function setMountainOverride(override: boolean | null) {
    setError(null);
    setSavingMtn(true);
    try {
      await setOtaMountainOverride(hotelId, override as boolean);
      qc.invalidateQueries({ queryKey: otaOptimizerQueryKeys.hotel(hotelId) });
      setSavedAt(Date.now());
    } catch (e) {
      const code = e instanceof OTAServiceError ? e.code : null;
      setError(friendlyOtaError(code, 'Could not save mountain preference.'));
    } finally {
      setSavingMtn(false);
    }
  }

  const recentlySaved = savedAt > 0 && Date.now() - savedAt < 4000;

  return (
    <section className="rounded-2xl border border-slate-800 bg-[#151A25] p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-slate-200">
          <Settings className="h-4 w-4" />
          <h3 className="text-sm font-semibold">Workbook settings</h3>
        </div>
        {recentlySaved && (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300">
            <Check className="h-3 w-3" />
            Saved
          </span>
        )}
      </header>

      <div className="mt-3 grid gap-4 md:grid-cols-2">
        {/* Active OTAs */}
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Active OTAs</div>
          <p className="mt-0.5 text-[12px] text-slate-400">
            Which OTAs do you currently list on? Inactive ones are excluded from scoring.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {OTA_PLATFORM_ORDER.map((o) => {
              const on = isActive(o);
              return (
                <button
                  key={o}
                  type="button"
                  disabled={savingOtas}
                  onClick={() => toggleOta(o)}
                  className={[
                    'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                    on
                      ? 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/40'
                      : 'bg-slate-800/40 text-slate-400 hover:bg-slate-700/60 hover:text-slate-200',
                    savingOtas ? 'cursor-wait opacity-60' : 'cursor-pointer',
                  ].join(' ')}
                  aria-pressed={on}
                >
                  {savingOtas && <Loader2 className="h-3 w-3 animate-spin" />}
                  {OTA_PLATFORM_LABEL[o]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Mountain checks */}
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 flex items-center gap-1">
            <Mountain className="h-3 w-3" />
            Mountain property disclosures
          </div>
          <p className="mt-0.5 text-[12px] text-slate-400">
            Adds 13 extra checks for steep roads, snow, heating, etc. Auto-derived from state — override if your property doesn’t match.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {([
              { value: null, label: 'Auto' },
              { value: true, label: 'Show' },
              { value: false, label: 'Hide' },
            ] as const).map((opt) => {
              const on = mountainOverride === opt.value;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  disabled={savingMtn}
                  onClick={() => setMountainOverride(opt.value)}
                  className={[
                    'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                    on
                      ? 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40'
                      : 'bg-slate-800/40 text-slate-400 hover:bg-slate-700/60 hover:text-slate-200',
                    savingMtn ? 'cursor-wait opacity-60' : 'cursor-pointer',
                  ].join(' ')}
                  aria-pressed={on}
                >
                  {savingMtn && opt.value === mountainOverride && <Loader2 className="h-3 w-3 animate-spin" />}
                  {opt.label}
                </button>
              );
            })}
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500">
            Currently: <span className="text-slate-300 font-medium">{effectiveMountain ? 'Showing 13 mountain checks' : 'Hidden'}</span>
            {mountainOverride === null && <span className="text-slate-500"> (auto-derived)</span>}
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
