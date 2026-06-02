// web/src/components/packages/PackageSeasonPicker.tsx
//
// Month-grid + optional date-window picker for seasonality.

import { Calendar } from 'lucide-react';
import { MONTH_LABEL } from '../../config/packages';

interface Props {
  months: number[];
  onMonthsChange: (next: number[]) => void;
  validFrom: string;
  validUntil: string;
  onValidFromChange: (value: string) => void;
  onValidUntilChange: (value: string) => void;
  dateError?: string;
}

const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export function PackageSeasonPicker({
  months,
  onMonthsChange,
  validFrom,
  validUntil,
  onValidFromChange,
  onValidUntilChange,
  dateError,
}: Props) {
  function toggle(m: number) {
    onMonthsChange(months.includes(m) ? months.filter((x) => x !== m) : [...months, m].sort((a, b) => a - b));
  }
  function selectAll() {
    onMonthsChange([...ALL]);
  }
  function clearAll() {
    onMonthsChange([]);
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-100 inline-flex items-center gap-2">
          <Calendar className="h-4 w-4 text-emerald-300" aria-hidden />
          Seasonality
        </h3>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={selectAll}
            className="text-[10px] text-slate-300 hover:text-slate-100"
          >
            All
          </button>
          <span className="text-slate-700">|</span>
          <button
            type="button"
            onClick={clearAll}
            className="text-[10px] text-slate-300 hover:text-slate-100"
          >
            Clear
          </button>
        </div>
      </div>

      <p className="text-[11px] text-slate-500">
        Pick which months this package runs. Leave all unticked for year-round.
      </p>

      <div className="grid grid-cols-6 sm:grid-cols-12 gap-1.5">
        {ALL.map((m) => {
          const active = months.includes(m);
          return (
            <button
              key={m}
              type="button"
              onClick={() => toggle(m)}
              className={`rounded-md border px-2 py-1 text-[11px] font-medium ${
                active
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-100'
                  : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:bg-slate-800'
              }`}
              data-testid={`season-month-${m}`}
              aria-pressed={active}
            >
              {MONTH_LABEL[m]}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3 pt-1">
        <Field label="Valid from (optional)">
          <input
            type="date"
            value={validFrom}
            onChange={(e) => onValidFromChange(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-1.5 text-xs text-slate-100 focus:border-emerald-400 focus:outline-none"
          />
        </Field>
        <Field label="Valid until (optional)">
          <input
            type="date"
            value={validUntil}
            onChange={(e) => onValidUntilChange(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-1.5 text-xs text-slate-100 focus:border-emerald-400 focus:outline-none"
          />
        </Field>
      </div>

      {dateError && <p className="text-[11px] text-red-300">{dateError}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
