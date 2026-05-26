// web/src/components/leads/FilterSheet.tsx
//
// Mobile bottom sheet that hosts the filter controls. Used on < sm viewports
// where inline filters would be too cramped.

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { LeadSource, LeadStatus } from '../../types/lead';
import { StatusFilterChips } from './StatusFilterChips';
import { SourceFilterDropdown } from './SourceFilterDropdown';
import { AssigneeFilterDropdown } from './AssigneeFilterDropdown';
import type { LeadFiltersUrlState } from './leadsFilters';

interface Props {
  isOpen: boolean;
  filters: LeadFiltersUrlState;
  onChange: (next: LeadFiltersUrlState) => void;
  onClose: () => void;
  onClearAll: () => void;
}

export function FilterSheet({ isOpen, filters, onChange, onClose, onClearAll }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      data-testid="filter-sheet"
      className="fixed inset-0 z-40 flex items-end bg-black/70"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Filter leads"
        className="w-full bg-[#101218] border-t border-white/10 rounded-t-2xl p-4 max-h-[80vh] overflow-y-auto"
      >
        <header className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">Filters</h2>
          <button
            type="button"
            aria-label="Close filters"
            onClick={onClose}
            className="p-1 rounded text-white/60 hover:text-white hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="space-y-5">
          <section>
            <h3 className="text-xs font-medium text-white/70 mb-2 uppercase tracking-wider">Status</h3>
            <StatusFilterChips
              value={filters.status ?? []}
              onChange={(next: LeadStatus[]) =>
                onChange({ ...filters, status: next.length > 0 ? next : undefined, page: 1 })
              }
            />
          </section>

          <section>
            <h3 className="text-xs font-medium text-white/70 mb-2 uppercase tracking-wider">Source</h3>
            <SourceFilterDropdown
              value={filters.source ?? []}
              onChange={(next: LeadSource[]) =>
                onChange({ ...filters, source: next.length > 0 ? next : undefined, page: 1 })
              }
            />
          </section>

          <section>
            <h3 className="text-xs font-medium text-white/70 mb-2 uppercase tracking-wider">Assignee</h3>
            <AssigneeFilterDropdown
              value={filters.assigned}
              onChange={(next) => onChange({ ...filters, assigned: next, page: 1 })}
            />
          </section>
        </div>

        <footer className="flex items-center justify-between gap-2 mt-6 pt-4 border-t border-white/10">
          <button
            type="button"
            onClick={onClearAll}
            className="text-sm text-white/60 hover:text-white"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-400 transition-colors"
          >
            Apply
          </button>
        </footer>
      </div>
    </div>
  );
}
