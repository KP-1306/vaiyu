// web/src/components/ota/OTAMatrixView.tsx
//
// Read-only matrix view: rows = categories, columns = active OTAs.
// Each cell shows the count of complete/total items and the band tone.
// Click a cell → calls onSelectCell prop (parent opens drilldown).

import { Lock } from 'lucide-react';
import {
  OTA_CATEGORY_ORDER,
  OTA_PLATFORM_LABEL,
  applicableCatalogItems,
} from '../../config/otaOptimizer';
import { useOwnerT } from '../../i18n/useOwnerT';
import type {
  HotelOTAReadinessRow,
  HotelOTAReadinessStateRow,
  OTAPlatform,
  OTAReadinessCategory,
  OTAReadinessBand,
  OTAReadinessStatus,
} from '../../types/otaOptimizer';

interface Props {
  activeOtas: OTAPlatform[];
  effectiveMountain: boolean;
  state: HotelOTAReadinessStateRow[];
  perOta: HotelOTAReadinessRow[];
  onSelectCell: (ota: OTAPlatform, category: OTAReadinessCategory) => void;
}

type CellStat = {
  applicable: number;
  complete: number;
  partial: number;
  missing: number;
  unknown: number;
  na: number;
  applies: boolean;
};

function statForCell(
  ota: OTAPlatform,
  cat: OTAReadinessCategory,
  state: HotelOTAReadinessStateRow[],
  effectiveMountain: boolean,
): CellStat {
  const items = applicableCatalogItems(ota, effectiveMountain).filter((i) => i.category === cat);
  if (items.length === 0) {
    return { applicable: 0, complete: 0, partial: 0, missing: 0, unknown: 0, na: 0, applies: false };
  }
  const stat: CellStat = {
    applicable: items.length,
    complete: 0,
    partial: 0,
    missing: 0,
    unknown: 0,
    na: 0,
    applies: true,
  };
  for (const item of items) {
    const row = state.find(
      (s) => s.ota === ota && s.category === item.category && s.item_key === item.itemKey,
    );
    const status: OTAReadinessStatus = row?.status ?? 'UNKNOWN';
    switch (status) {
      case 'COMPLETE':       stat.complete++; break;
      case 'PARTIAL':        stat.partial++;  break;
      case 'MISSING':        stat.missing++;  break;
      case 'UNKNOWN':        stat.unknown++;  break;
      case 'NOT_APPLICABLE': stat.na++;       break;
    }
  }
  return stat;
}

function cellToneClass(stat: CellStat): string {
  if (!stat.applies) return 'bg-slate-900/40 text-slate-600';
  const denom = stat.applicable - stat.na;
  if (denom === 0) return 'bg-sky-500/10 text-sky-300';
  const ratio = (stat.complete + stat.partial * 0.5) / denom;
  if (stat.unknown === denom) return 'bg-slate-800/50 text-slate-400';
  if (ratio >= 0.8) return 'bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25';
  if (ratio >= 0.5) return 'bg-amber-500/15 text-amber-200 hover:bg-amber-500/25';
  return 'bg-rose-500/15 text-rose-200 hover:bg-rose-500/25';
}

export function OTAMatrixView({
  activeOtas,
  effectiveMountain,
  state,
  perOta,
  onSelectCell,
}: Props) {
  const t = useOwnerT('owner-ota');
  const otaScoreFor = (o: OTAPlatform) => perOta.find((r) => r.ota === o)?.ota_score ?? null;
  const otaBandFor = (o: OTAPlatform) => perOta.find((r) => r.ota === o)?.band ?? null;

  return (
    <section className="rounded-2xl border border-slate-800 bg-[#151A25] p-4">
      <h3 className="text-sm font-semibold text-slate-100">{t('matrix.title', 'Compare across OTAs')}</h3>
      <p className="mt-0.5 text-[12px] text-slate-400">
        {t('matrix.subtitle', 'Click any cell to set statuses for that category × OTA. Empty cells = items don\'t apply to that OTA.')}
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-[12px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[#151A25] text-left p-2 font-semibold text-slate-300 align-bottom min-w-[180px]">
                {t('matrix.categoryHeader', 'Category')}
              </th>
              {activeOtas.map((o) => {
                const score = otaScoreFor(o);
                const band = otaBandFor(o) as OTAReadinessBand | null;
                return (
                  <th key={o} className="p-2 text-center font-semibold text-slate-300 align-bottom whitespace-nowrap min-w-[110px]">
                    <div>{OTA_PLATFORM_LABEL[o]}</div>
                    <div className="mt-1 text-[10px] font-normal text-slate-400">
                      {score !== null ? `${Math.round(score)}/100` : '—'}{' '}
                      <span className={
                        band === 'PREMIUM' ? 'text-emerald-300' :
                        band === 'MODERATE' ? 'text-amber-300' :
                        band === 'CRITICAL' ? 'text-rose-300' :
                        'text-slate-500'
                      }>
                        {band ? t(`band.${band}`, band) : ''}
                      </span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {OTA_CATEGORY_ORDER
              .filter((cat) => cat !== 'MOUNTAIN_DISCLOSURE' || effectiveMountain)
              .map((cat) => (
                <tr key={cat} className="border-t border-slate-800/60">
                  <td className="sticky left-0 z-10 bg-[#151A25] p-2 text-left text-slate-200 font-medium">
                    {t(`category.${cat}`, cat.replace(/_/g, ' ').toLowerCase())}
                  </td>
                  {activeOtas.map((o) => {
                    const stat = statForCell(o, cat, state, effectiveMountain);
                    if (!stat.applies) {
                      return (
                        <td key={o} className="p-1.5">
                          <div className="rounded-md bg-slate-900/40 px-2 py-1.5 text-center text-slate-600">
                            <Lock className="inline h-3 w-3" />
                          </div>
                        </td>
                      );
                    }
                    return (
                      <td key={o} className="p-1.5">
                        <button
                          type="button"
                          onClick={() => onSelectCell(o, cat)}
                          className={[
                            'block w-full rounded-md px-2 py-1.5 text-center font-medium transition-colors cursor-pointer',
                            cellToneClass(stat),
                          ].join(' ')}
                          title={`${stat.complete}✓ ${stat.partial}~ ${stat.missing}✗ ${stat.unknown}? — click to set`}
                        >
                          {stat.complete}/{stat.applicable - stat.na}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
