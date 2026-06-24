// web/src/components/visibility/VisibilityTrendChart.tsx
//
// Sparkline of the last N snapshots (oldest → newest). No chart library —
// pure SVG. Shows score band tones and a hover tooltip with the delta-aware
// breakdown.

import { useMemo } from 'react';
import { VISIBILITY_BAND_TONE } from '../../config/visibilityScore';
import type { VisibilityScoreSnapshot } from '../../types/visibilityScore';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  snapshots: VisibilityScoreSnapshot[]; // newest-first from history RPC
}

const STROKE: Record<string, string> = {
  emerald: '#34d399',
  sky:     '#7dd3fc',
  amber:   '#fbbf24',
  rose:    '#fb7185',
  slate:   '#94a3b8',
};

export function VisibilityTrendChart({ snapshots }: Props) {
  const t = useOwnerT('owner-visibility');
  const ordered = useMemo(() => [...snapshots].reverse(), [snapshots]); // oldest → newest
  const width = 360;
  const height = 80;
  const padding = 8;

  if (ordered.length < 2) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-300">
          {t('trendChart.title', 'Score history')}
        </h3>
        <p className="mt-2 text-[12px] text-slate-500">
          {ordered.length === 0
            ? t('trendChart.noSnapshots', 'No snapshots yet. The weekly cron writes the first one on Sunday 03:00 IST — or use the Refresh button to take one now.')
            : t('trendChart.oneSnapshot', 'First snapshot taken — a second snapshot is needed to draw the trend line.')}
        </p>
      </div>
    );
  }

  const points = ordered.map((s, i) => ({
    x: padding + ((width - 2 * padding) / (ordered.length - 1)) * i,
    y: padding + ((100 - s.total_score) / 100) * (height - 2 * padding),
    snap: s,
  }));

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-300">
          {t('trendChart.title', 'Score history')}
        </h3>
        <span className="text-[10px] text-slate-500">
          {t('trendChart.snapshot', '{{count}} snapshot', { count: ordered.length })}
        </span>
      </div>
      <div className="mt-3">
        <svg width={width} height={height} className="block max-w-full">
          {/* baseline */}
          <line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding}
            stroke="#1f2937" strokeWidth="1" />
          {/* 80 / 60 / 40 reference grid */}
          {[80, 60, 40].map((band) => {
            const y = padding + ((100 - band) / 100) * (height - 2 * padding);
            return (
              <g key={band}>
                <line x1={padding} x2={width - padding} y1={y} y2={y}
                  stroke="#1f2937" strokeWidth="1" strokeDasharray="2,3" />
                <text x={width - padding} y={y - 2} textAnchor="end" fontSize="9" fill="#475569">
                  {band}
                </text>
              </g>
            );
          })}
          {/* path */}
          <path d={pathD} fill="none" stroke="#94a3b8" strokeWidth="1.5" />
          {/* points */}
          {points.map((p, i) => {
            const tone = VISIBILITY_BAND_TONE[p.snap.band];
            return (
              <circle key={i} cx={p.x} cy={p.y} r="3"
                fill={STROKE[tone] || '#94a3b8'}
                stroke="#0B0E14" strokeWidth="1.5">
                <title>
                  {new Date(p.snap.taken_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  {' · '}
                  {Math.round(p.snap.total_score)}{' / 100'}
                  {p.snap.previous_score !== null
                    ? ` (Δ ${(p.snap.total_score - p.snap.previous_score).toFixed(1)})`
                    : ''}
                </title>
              </circle>
            );
          })}
        </svg>
      </div>
      <p className="mt-2 text-[10px] text-slate-500">
        {t('trendChart.formulaVersion', 'Score formula v{{version}}', { version: ordered[ordered.length - 1]?.formula_version ?? 1 })}
      </p>
    </div>
  );
}
