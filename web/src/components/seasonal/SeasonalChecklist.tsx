// web/src/components/seasonal/SeasonalChecklist.tsx
//
// Renders the per-window prep checklist with EN/Hi labels and a soft link to
// the connected module (when one exists for that item). Ticks fire optimistic
// mutations; revert on RPC error.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, AlertCircle } from 'lucide-react';

import {
  seasonalConnectedModuleRoute,
  SEASONAL_CONNECTED_MODULE_LABEL,
} from '../../config/seasonalCalendar';
import {
  tickSeasonalChecklist,
  friendlySeasonalError,
  extractSeasonalErrorCode,
} from '../../services/seasonalCalendarService';
import { seasonalCalendarQueryKeys } from '../../services/seasonalCalendarQueryKeys';
import type {
  SeasonalChecklistItem,
  VisibleSeasonalWindow,
} from '../../types/seasonalCalendar';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  hotelId: string;
  hotelSlug: string;
  window: VisibleSeasonalWindow;
  language: 'en' | 'hi';
  disabled?: boolean;
}

export function SeasonalChecklist({ hotelId, hotelSlug, window, language, disabled }: Props) {
  const t = useOwnerT('owner-seasonal');
  const qc = useQueryClient();
  const items = window.prep_checklist_seed ?? [];
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: ({ itemKey, ticked }: { itemKey: string; ticked: boolean }) =>
      tickSeasonalChecklist({
        hotelId,
        windowCode: window.window_code,
        itemKey,
        ticked,
      }),
    onMutate: ({ itemKey }) => {
      setPendingKey(itemKey);
      setErrorMsg(null);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: seasonalCalendarQueryKeys.list(hotelId) });
    },
    onError: (err) => {
      const code = extractSeasonalErrorCode(err);
      setErrorMsg(friendlySeasonalError(code, t('checklist.saveError', 'Could not save. Please try again.')));
    },
    onSettled: () => {
      setPendingKey(null);
    },
  });

  if (items.length === 0) {
    return (
      <p className="text-[12px] text-slate-500">
        {t('checklist.noItems', 'No checklist items defined for this window yet.')}
      </p>
    );
  }

  return (
    <div>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <ChecklistRow
            key={item.key}
            item={item}
            ticked={window.ticked_keys.includes(item.key)}
            language={language}
            hotelSlug={hotelSlug}
            disabled={disabled || pendingKey === item.key}
            onToggle={(next) => mutation.mutate({ itemKey: item.key, ticked: next })}
          />
        ))}
      </ul>
      {errorMsg && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[12px] text-rose-800">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
}

function ChecklistRow({
  item,
  ticked,
  language,
  hotelSlug,
  disabled,
  onToggle,
}: {
  item: SeasonalChecklistItem;
  ticked: boolean;
  language: 'en' | 'hi';
  hotelSlug: string;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
}) {
  const t = useOwnerT('owner-seasonal');
  const label = language === 'en' ? item.label_en : item.label_hi;
  const linkRoute = seasonalConnectedModuleRoute(hotelSlug, item.link_target ?? null);
  const moduleLabel = item.link_target
    ? t(`module.${item.link_target}`, SEASONAL_CONNECTED_MODULE_LABEL[item.link_target])
    : null;

  return (
    <li className="flex items-start gap-2.5 rounded-md border border-slate-200 bg-white px-2.5 py-2 hover:bg-slate-50">
      <button
        type="button"
        role="checkbox"
        aria-checked={ticked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onToggle(!ticked)}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 ${
          ticked
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : 'border-slate-300 bg-white hover:border-emerald-400'
        } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
      >
        {ticked && <Check className="h-3.5 w-3.5" aria-hidden />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] leading-snug ${ticked ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
          {item.days_before !== undefined && (
            <span className="mr-1.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
              T-{item.days_before}
            </span>
          )}
          {label}
        </div>
        {linkRoute && moduleLabel && (
          <Link
            to={linkRoute}
            className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] text-emerald-700 hover:underline"
          >
            {t('checklist.openModule', 'Open {{module}}', { module: moduleLabel })} <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
        )}
      </div>
    </li>
  );
}
