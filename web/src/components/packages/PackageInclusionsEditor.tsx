// web/src/components/packages/PackageInclusionsEditor.tsx
//
// Four grouped chip-editors for food / activity / transfer / custom
// inclusions. Each accepts free-text entries; one entry per chip.

import { useState } from 'react';
import { Plus, X } from 'lucide-react';

interface GroupProps {
  label: string;
  hint?: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
  testId: string;
  suggestions?: string[];
}

function InclusionGroup({
  label,
  hint,
  placeholder,
  values,
  onChange,
  testId,
  suggestions = [],
}: GroupProps) {
  const [draft, setDraft] = useState('');

  function add(value: string) {
    const v = value.trim();
    if (!v) return;
    if (values.includes(v)) return;
    onChange([...values, v]);
    setDraft('');
  }

  function remove(value: string) {
    onChange(values.filter((v) => v !== value));
  }

  return (
    <div className="space-y-2">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">{label}</div>
        {hint && <div className="text-[10px] text-slate-500">{hint}</div>}
      </div>

      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-100"
            >
              {v}
              <button
                type="button"
                onClick={() => remove(v)}
                aria-label={`Remove ${v}`}
                className="text-emerald-300/70 hover:text-emerald-100"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
            }
          }}
          placeholder={placeholder}
          maxLength={80}
          className="flex-1 rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
          data-testid={`${testId}-input`}
        />
        <button
          type="button"
          onClick={() => add(draft)}
          disabled={!draft.trim()}
          className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid={`${testId}-add`}
        >
          <Plus className="h-3 w-3" aria-hidden />
          Add
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestions
            .filter((s) => !values.includes(s))
            .slice(0, 6)
            .map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => add(s)}
                className="rounded-md border border-slate-700 bg-slate-800/40 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-800"
              >
                + {s}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  food: string[];
  activity: string[];
  transfer: string[];
  custom: string[];
  onFoodChange: (next: string[]) => void;
  onActivityChange: (next: string[]) => void;
  onTransferChange: (next: string[]) => void;
  onCustomChange: (next: string[]) => void;
}

const FOOD_SUGGESTIONS = ['Breakfast', 'Lunch', 'Dinner', 'Welcome drink', 'Bonfire snacks'];
const ACTIVITY_SUGGESTIONS = ['Char Dham yatra guidance', 'Local sightseeing', 'Yoga session', 'River rafting', 'Trekking guide'];
const TRANSFER_SUGGESTIONS = ['Airport pickup', 'Airport drop', 'Sightseeing taxi', 'Railway station pickup'];

export function PackageInclusionsEditor(props: Props) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-100">Inclusions</h3>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Pick what's included so the package page can list it clearly. Add suggestions or type your own.
        </p>
      </div>

      <InclusionGroup
        label="Food"
        hint="Meals, drinks, snacks bundled in the package"
        placeholder="e.g. Breakfast, Dinner"
        values={props.food}
        onChange={props.onFoodChange}
        testId="incl-food"
        suggestions={FOOD_SUGGESTIONS}
      />
      <InclusionGroup
        label="Activities"
        hint="Tours, guidance, sessions, experiences"
        placeholder="e.g. Local sightseeing"
        values={props.activity}
        onChange={props.onActivityChange}
        testId="incl-activity"
        suggestions={ACTIVITY_SUGGESTIONS}
      />
      <InclusionGroup
        label="Transfers"
        hint="Pickups, drops, in-trip taxis"
        placeholder="e.g. Airport pickup"
        values={props.transfer}
        onChange={props.onTransferChange}
        testId="incl-transfer"
        suggestions={TRANSFER_SUGGESTIONS}
      />
      <InclusionGroup
        label="Custom inclusions"
        hint="Anything else — welcome cake, photographer, decor, etc."
        placeholder="e.g. Welcome cake on arrival"
        values={props.custom}
        onChange={props.onCustomChange}
        testId="incl-custom"
      />
    </div>
  );
}
