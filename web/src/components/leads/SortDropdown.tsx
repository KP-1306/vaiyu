// web/src/components/leads/SortDropdown.tsx
//
// Single-select sort dropdown. Driven by SORT_OPTIONS from leadsFilters.

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check, ArrowUpDown } from 'lucide-react';
import { SORT_OPTIONS, type SortOption } from './leadsFilters';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  value: SortOption;
  onChange: (next: SortOption) => void;
}

export function SortDropdown({ value, onChange }: Props) {
  const t = useOwnerT('owner-leads');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = SORT_OPTIONS.find((o) => o.value === value) ?? SORT_OPTIONS[0];

  return (
    <div ref={rootRef} className="relative" data-testid="sort-dropdown">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={t('sort.title', 'Sort')}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ring-1 bg-white/[0.03] text-white/70 ring-white/10 hover:bg-white/[0.06] transition-colors"
      >
        <ArrowUpDown className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t(`sort.${current.value}`, current.label)}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute z-40 mt-2 w-48 rounded-lg border border-white/10 bg-[#15171c] shadow-xl p-1.5 right-0"
        >
          {SORT_OPTIONS.map((o) => {
            const selected = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                role="menuitemradio"
                aria-checked={selected}
                className={`
                  flex items-center justify-between w-full px-2 py-1.5 rounded-md text-sm text-left
                  ${selected ? 'bg-emerald-500/10 text-emerald-200' : 'text-white/80 hover:bg-white/[0.05]'}
                `}
              >
                {t(`sort.${o.value}`, o.label)}
                {selected && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
