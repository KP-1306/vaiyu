// web/src/components/leads/SourceFilterDropdown.tsx
//
// Multi-select dropdown for lead source. Trigger button shows the active
// count. Body is a checklist of all 12 sources. Outside-click + Esc to close.

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import type { LeadSource } from '../../types/lead';
import { LEAD_SOURCE_CONFIG } from './LeadSourceIcon.config';

interface Props {
  value: LeadSource[];
  onChange: (next: LeadSource[]) => void;
}

const ALL_SOURCES: LeadSource[] = [
  'GOOGLE', 'WEBSITE', 'INSTAGRAM', 'FACEBOOK',
  'OTA', 'WALK_IN', 'REFERRAL',
  'AGENT', 'CORPORATE', 'WEDDING', 'GROUP', 'OTHER',
];

export function SourceFilterDropdown({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
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

  function toggle(source: LeadSource) {
    if (value.includes(source)) {
      onChange(value.filter((s) => s !== source));
    } else {
      onChange([...value, source]);
    }
  }

  const label = value.length === 0 ? 'Source' : `Source (${value.length})`;

  return (
    <div ref={rootRef} className="relative" data-testid="source-filter-dropdown">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`
          inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
          ring-1 transition-colors
          ${value.length > 0
            ? 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/30'
            : 'bg-white/[0.03] text-white/70 ring-white/10 hover:bg-white/[0.06]'
          }
        `}
      >
        {label}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute z-40 mt-2 w-56 rounded-lg border border-white/10 bg-[#15171c] shadow-xl p-1.5 max-h-80 overflow-y-auto right-0 sm:left-0 sm:right-auto"
        >
          {ALL_SOURCES.map((s) => {
            const checked = value.includes(s);
            const cfg = LEAD_SOURCE_CONFIG[s];
            const Icon = cfg.Icon;
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggle(s)}
                role="menuitemcheckbox"
                aria-checked={checked}
                className={`
                  flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm text-left
                  ${checked ? 'bg-emerald-500/10 text-emerald-200' : 'text-white/80 hover:bg-white/[0.05]'}
                `}
              >
                <Icon size={14} className="shrink-0" aria-hidden="true" />
                <span className="flex-1">{cfg.label}</span>
                {checked && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            );
          })}
          {value.length > 0 && (
            <div className="border-t border-white/10 mt-1 pt-1">
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full px-2 py-1.5 text-xs text-white/60 hover:text-white text-left"
              >
                Clear sources
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
