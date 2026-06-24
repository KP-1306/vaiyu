// web/src/components/visibility/VisibilityBreakdown.tsx
//
// 5-category accordion of all 19 signals, with per-category subtotal.

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import {
  VISIBILITY_CATEGORY_LABEL,
  VISIBILITY_CATEGORY_ORDER,
  VISIBILITY_CATEGORY_WEIGHT,
} from '../../config/visibilityScore';
import { useOwnerT } from '../../i18n/useOwnerT';
import type {
  HotelVisibilityAttestation,
  VisibilityBreakdown as VisibilityBreakdownT,
  VisibilityCategory,
  VisibilitySignalKey,
} from '../../types/visibilityScore';
import { VisibilitySignalRow } from './VisibilitySignalRow';

interface Props {
  hotelId: string;
  hotelSlug: string;
  breakdown: VisibilityBreakdownT;
  attestationsByKey: Partial<Record<VisibilitySignalKey, HotelVisibilityAttestation>>;
  isManager: boolean;
}

export function VisibilityBreakdown({ hotelId, hotelSlug, breakdown, attestationsByKey, isManager }: Props) {
  const t = useOwnerT('owner-visibility');
  const [openCats, setOpenCats] = useState<Record<VisibilityCategory, boolean>>({
    GMB_READINESS: true,
    TRUST_REPUTATION: false,
    DIGITAL_ASSETS: false,
    DIRECT_ENQUIRY: false,
    EXPERIENCE_PACKAGES: false,
  });
  const toggle = (c: VisibilityCategory) =>
    setOpenCats((s) => ({ ...s, [c]: !s[c] }));

  return (
    <section className="space-y-2" data-testid="visibility-breakdown">
      {VISIBILITY_CATEGORY_ORDER.map((cat) => {
        const signalsInCat = breakdown.signals.filter((s) => s.category === cat);
        const subtotal = breakdown.category_scores[cat];
        const max = VISIBILITY_CATEGORY_WEIGHT[cat];
        const open = openCats[cat];

        return (
          <div key={cat} className="rounded-2xl border border-slate-800 bg-[#0F1320]">
            <button
              type="button"
              onClick={() => toggle(cat)}
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
              aria-expanded={open}
              data-testid={`category-toggle-${cat}`}
            >
              <div className="flex items-center gap-2">
                {open ? (
                  <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden />
                ) : (
                  <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden />
                )}
                <span className="text-[12px] font-semibold text-slate-100">
                  {t(`visibilityCategory.${cat}`, VISIBILITY_CATEGORY_LABEL[cat])}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-slate-500">
                  {t('signal', '{{count}} signal', { count: signalsInCat.length })}
                </span>
              </div>
              <span className="text-[11px] text-slate-300">
                {subtotal.toFixed(subtotal % 1 === 0 ? 0 : 1)} / {max} {t('pts', 'pts')}
              </span>
            </button>
            {open && (
              <ul className="space-y-2 px-3 pb-3" data-testid={`category-list-${cat}`}>
                {signalsInCat.map((s) => (
                  <VisibilitySignalRow
                    key={s.key}
                    hotelId={hotelId}
                    hotelSlug={hotelSlug}
                    signal={s}
                    attestation={attestationsByKey[s.key] ?? null}
                    isManager={isManager}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
