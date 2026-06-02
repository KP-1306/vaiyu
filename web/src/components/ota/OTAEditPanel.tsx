// web/src/components/ota/OTAEditPanel.tsx
//
// Per-(OTA × category) drill-down edit panel. Lists every applicable item
// in the category for that OTA with a status setter. Opened when the
// matrix cell is clicked.

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, RotateCcw, X, Loader2 } from 'lucide-react';
import {
  OTA_CATEGORY_LABEL,
  OTA_PLATFORM_LABEL,
  applicableCatalogItems,
} from '../../config/otaOptimizer';
import {
  friendlyOtaError,
  markOtaReviewComplete,
  resetOtaReadiness,
} from '../../services/otaOptimizerService';
import { otaOptimizerQueryKeys } from '../../services/otaOptimizerQueryKeys';
import { OTAItemSetter } from './OTAItemSetter';
import type {
  HotelOTAReadinessStateRow,
  OTAPlatform,
  OTAReadinessCategory,
  OTAReadinessStatus,
} from '../../types/otaOptimizer';
import { OTAServiceError } from '../../types/otaOptimizer';

interface Props {
  hotelId: string;
  hotelSlug: string;
  ota: OTAPlatform;
  category: OTAReadinessCategory;
  effectiveMountain: boolean;
  state: HotelOTAReadinessStateRow[];
  onClose: () => void;
}

export function OTAEditPanel({
  hotelId,
  hotelSlug,
  ota,
  category,
  effectiveMountain,
  state,
  onClose,
}: Props) {
  const qc = useQueryClient();
  const items = applicableCatalogItems(ota, effectiveMountain).filter((i) => i.category === category);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [reviewedAt, setReviewedAt] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  // Scroll the panel into view when (ota, category) changes — important on
  // mobile where the matrix is above and a click-to-open would otherwise leave
  // the panel below the fold.
  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [ota, category]);

  const getStatus = (itemKey: string): OTAReadinessStatus => {
    const row = state.find((s) => s.ota === ota && s.category === category && s.item_key === itemKey);
    return row?.status ?? 'UNKNOWN';
  };

  async function handleReviewComplete() {
    setError(null);
    setReviewBusy(true);
    try {
      await markOtaReviewComplete(hotelId, ota);
      qc.invalidateQueries({ queryKey: otaOptimizerQueryKeys.hotel(hotelId) });
      setReviewedAt(Date.now());
    } catch (e) {
      const code = e instanceof OTAServiceError ? e.code : null;
      setError(friendlyOtaError(code, 'Could not mark review complete.'));
    } finally {
      setReviewBusy(false);
    }
  }

  async function handleResetOta() {
    if (!window.confirm(`Reset all OTA Optimizer state for ${OTA_PLATFORM_LABEL[ota]}? This deletes status history for this OTA only.`)) {
      return;
    }
    setError(null);
    setResetBusy(true);
    try {
      await resetOtaReadiness(hotelId, ota);
      qc.invalidateQueries({ queryKey: otaOptimizerQueryKeys.hotel(hotelId) });
    } catch (e) {
      const code = e instanceof OTAServiceError ? e.code : null;
      setError(friendlyOtaError(code, 'Could not reset OTA.'));
    } finally {
      setResetBusy(false);
    }
  }

  const recentlyReviewed = reviewedAt > 0 && Date.now() - reviewedAt < 4000;

  return (
    <section ref={panelRef} className="rounded-2xl border border-slate-800 bg-[#151A25] p-4 scroll-mt-4">
      <header className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">
            {OTA_PLATFORM_LABEL[ota]}
          </div>
          <h3 className="text-sm font-semibold text-slate-100">
            {OTA_CATEGORY_LABEL[category]}
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {items.length} item{items.length === 1 ? '' : 's'} apply to {OTA_PLATFORM_LABEL[ota]}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          aria-label="Close drilldown"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="mt-3 grid gap-2">
        {items.map((item) => (
          <OTAItemSetter
            key={`${item.category}/${item.itemKey}`}
            hotelId={hotelId}
            hotelSlug={hotelSlug}
            ota={ota}
            item={item}
            currentStatus={getStatus(item.itemKey)}
            onSaved={() => {
              qc.invalidateQueries({ queryKey: otaOptimizerQueryKeys.hotel(hotelId) });
            }}
          />
        ))}
      </div>

      <footer className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
        <button
          type="button"
          onClick={handleReviewComplete}
          disabled={reviewBusy}
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-[12px] text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-60"
        >
          {reviewBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
          I just reviewed {OTA_PLATFORM_LABEL[ota]} — refresh freshness
        </button>

        <button
          type="button"
          onClick={handleResetOta}
          disabled={resetBusy}
          className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[12px] text-rose-200 hover:bg-rose-500/25 disabled:opacity-60"
        >
          {resetBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
          Reset {OTA_PLATFORM_LABEL[ota]} status
        </button>

        {recentlyReviewed && (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300">
            <CheckCircle2 className="h-3 w-3" />
            Freshness refreshed
          </span>
        )}
      </footer>

      {error && (
        <div className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
