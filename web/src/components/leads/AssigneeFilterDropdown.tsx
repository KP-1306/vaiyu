// web/src/components/leads/AssigneeFilterDropdown.tsx
//
// Single-select dropdown: All / Me / Unassigned.
// Specific-user picker deferred for v1.

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { useOwnerT } from '../../i18n/useOwnerT';

type AssigneeValue = 'me' | 'unassigned' | undefined;

interface Props {
  value: AssigneeValue;
  onChange: (next: AssigneeValue) => void;
}

const OPTIONS: Array<{ value: AssigneeValue; key: string; label: string }> = [
  { value: undefined, key: 'all', label: 'All assignees' },
  { value: 'me', key: 'me', label: 'Assigned to me' },
  { value: 'unassigned', key: 'unassigned', label: 'Unassigned' },
];

export function AssigneeFilterDropdown({ value, onChange }: Props) {
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

  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];
  const isActive = value !== undefined;

  return (
    <div ref={rootRef} className="relative" data-testid="assignee-filter-dropdown">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`
          inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
          ring-1 transition-colors
          ${isActive
            ? 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/30'
            : 'bg-white/[0.03] text-white/70 ring-white/10 hover:bg-white/[0.06]'
          }
        `}
      >
        {t(`assignee.${current.key}`, current.label)}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute z-40 mt-2 w-44 rounded-lg border border-white/10 bg-[#15171c] shadow-xl p-1.5 right-0 sm:left-0 sm:right-auto"
        >
          {OPTIONS.map((o) => {
            const selected = o.value === value;
            return (
              <button
                key={o.key}
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
                {t(`assignee.${o.key}`, o.label)}
                {selected && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
