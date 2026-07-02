// web/src/components/assets/AssetCategorySection.tsx
//
// Collapsible category group — collapses when all requirements collected
// so the workspace defaults to focused on what's missing. Dark theme.

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { AssetRequirementRow } from './AssetRequirementRow';
import { AssetCategoryDot } from './AssetStatusBadge';
import { DAM_CATEGORY_LABELS, DAM_CATEGORY_SUBTITLES } from '../../config/digitalAssetManager';
import type { AssetCategory, AssetStatusRow } from '../../types/digitalAssets';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  category: AssetCategory;
  rows: AssetStatusRow[];
  defaultOpen?: boolean;
  showHinglish: boolean;
}

export function AssetCategorySection({ category, rows, defaultOpen = true, showHinglish }: Props) {
  const t = useOwnerT('owner-assets');
  const [open, setOpen] = useState(defaultOpen);
  const total = rows.length;
  const ready = rows.filter((r) => r.status === 'COLLECTED' || r.status === 'APPROVED').length;
  const missing = rows.filter((r) => r.status === 'MISSING' || r.status === 'REJECTED' || r.status === 'NEEDS_REPLACEMENT').length;

  return (
    <section className="rounded-xl border border-slate-800 bg-[#0F1320]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <AssetCategoryDot category={category} />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-100">
              {t(`category.${category}`, DAM_CATEGORY_LABELS[category])}
            </h2>
            <p className="truncate text-[11.5px] text-slate-400">
              {t(`subtitle.${category}`, DAM_CATEGORY_SUBTITLES[category])}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[10.5px] font-medium uppercase tracking-wider text-slate-500">{t('section.ready', 'Ready')}</div>
            <div className="text-sm font-semibold text-slate-100">
              {ready}<span className="text-slate-500">/{total}</span>
            </div>
          </div>
          {missing > 0 && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-semibold text-amber-300">
              {t('section.needAttention', '{{count}} need attention', { count: missing })}
            </span>
          )}
          {open
            ? <ChevronDown className="h-4 w-4 text-slate-500" aria-hidden />
            : <ChevronRight className="h-4 w-4 text-slate-500" aria-hidden />}
        </div>
      </button>

      {open && (
        <div className="space-y-2 border-t border-slate-800 bg-black/20 px-2 py-3 sm:px-3">
          {rows.map((r) => (
            <AssetRequirementRow key={r.requirement_code} row={r} showHinglish={showHinglish} />
          ))}
          {rows.length === 0 && (
            <p className="px-3 py-4 text-[12px] text-slate-400">{t('section.noReqs', 'No requirements in this category.')}</p>
          )}
        </div>
      )}
    </section>
  );
}
