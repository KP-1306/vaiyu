// web/src/components/ota/OTAItemSetter.tsx
//
// Five-state status setter for one (OTA × category × item_key) cell.
// Renders 5 buttons (Complete / Partial / Missing / Unknown / N/A) plus a
// fix-action deep-link to the relevant module. Optimistic update with
// rollback on failure.

import { useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import {
  OTA_STATUS_LABEL,
  OTA_STATUS_TONE,
  otaFixActionRoute,
  OTA_FIX_MODULE_LABEL,
  type StatusTone,
} from '../../config/otaOptimizer';
import { friendlyOtaError, setOtaReadinessStatus } from '../../services/otaOptimizerService';
import { OTAServiceError } from '../../types/otaOptimizer';
import type {
  OTACatalogItem,
  OTAPlatform,
  OTAReadinessStatus,
} from '../../types/otaOptimizer';

interface Props {
  hotelId: string;
  hotelSlug: string;
  ota: OTAPlatform;
  item: OTACatalogItem;
  currentStatus: OTAReadinessStatus;
  /** Called after successful save (parent can refresh queries). */
  onSaved?: (newStatus: OTAReadinessStatus) => void;
}

const STATUSES: OTAReadinessStatus[] = ['COMPLETE', 'PARTIAL', 'MISSING', 'UNKNOWN', 'NOT_APPLICABLE'];

const TONE_BTN_ACTIVE: Record<StatusTone, string> = {
  emerald: 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40',
  amber:   'bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40',
  rose:    'bg-rose-500/20 text-rose-200 ring-1 ring-rose-500/40',
  slate:   'bg-slate-700/40 text-slate-200 ring-1 ring-slate-500/40',
  sky:     'bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/40',
};

export function OTAItemSetter({
  hotelId,
  hotelSlug,
  ota,
  item,
  currentStatus,
  onSaved,
}: Props) {
  const [pending, setPending] = useState<OTAReadinessStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<OTAReadinessStatus>(currentStatus);

  async function handleClick(next: OTAReadinessStatus) {
    if (pending) return;
    if (next === status) return;
    setError(null);
    setPending(next);
    const prev = status;
    setStatus(next); // optimistic
    try {
      await setOtaReadinessStatus({
        hotelId,
        ota,
        category: item.category,
        itemKey: item.itemKey,
        status: next,
      });
      setPending(null);
      onSaved?.(next);
    } catch (e) {
      setStatus(prev); // rollback
      setPending(null);
      const code = e instanceof OTAServiceError ? e.code : null;
      setError(friendlyOtaError(code, 'Could not save status. Try again.'));
    }
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-[#0B0E14] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-slate-100">{item.labelEn}</div>
          <div className="mt-0.5 text-[11px] text-slate-400 leading-snug">{item.descEn}</div>
        </div>
        <a
          href={otaFixActionRoute(hotelSlug, item.fixModule)}
          className="shrink-0 inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/50 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-600 hover:bg-slate-700/60 transition-colors"
          onClick={(e) => e.stopPropagation()}
          title={`Open ${OTA_FIX_MODULE_LABEL[item.fixModule]}`}
        >
          {OTA_FIX_MODULE_LABEL[item.fixModule]}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {STATUSES.map((s) => {
          const tone = OTA_STATUS_TONE[s];
          const isActive = status === s;
          const isPending = pending === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => handleClick(s)}
              disabled={!!pending}
              className={[
                'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                isActive
                  ? TONE_BTN_ACTIVE[tone]
                  : 'bg-slate-800/40 text-slate-400 hover:bg-slate-700/60 hover:text-slate-200',
                pending ? 'cursor-wait opacity-60' : 'cursor-pointer',
              ].join(' ')}
              aria-pressed={isActive}
            >
              {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              {OTA_STATUS_LABEL[s]}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="mt-2 text-[11px] text-rose-300" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
