// web/src/components/leads/LeadsFilterBar.tsx
//
// Sticky toolbar above the leads list. Inline filters on >= sm; collapses to
// a "Filters (N)" button + FilterSheet on mobile.

import { useEffect, useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import type { LeadSource, LeadStatus } from '../../types/lead';
import { StatusFilterChips } from './StatusFilterChips';
import { SourceFilterDropdown } from './SourceFilterDropdown';
import { AssigneeFilterDropdown } from './AssigneeFilterDropdown';
import { SortDropdown } from './SortDropdown';
import { FilterSheet } from './FilterSheet';
import { useOwnerT } from '../../i18n/useOwnerT';
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  hasActiveFilters,
  type LeadFiltersUrlState,
  type SortOption,
} from './leadsFilters';

interface Props {
  filters: LeadFiltersUrlState;
  onChange: (next: LeadFiltersUrlState) => void;
}

const SEARCH_DEBOUNCE_MS = 250;

export function LeadsFilterBar({ filters, onChange }: Props) {
  const t = useOwnerT('owner-leads');
  const [sheetOpen, setSheetOpen] = useState(false);
  // Local search state — debounced to avoid spamming the network on every keystroke
  const [searchInput, setSearchInput] = useState(filters.q ?? '');

  // Sync local search input when filters change externally (e.g., Clear all)
  useEffect(() => {
    setSearchInput(filters.q ?? '');
  }, [filters.q]);

  // Debounce search input → propagate to filters
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === (filters.q ?? '')) return;
    const timeout = setTimeout(() => {
      onChange({
        ...filters,
        q: trimmed === '' ? undefined : trimmed,
        page: 1,
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function clearAll() {
    setSearchInput('');
    onChange(DEFAULT_FILTERS);
    setSheetOpen(false);
  }

  const fCount = activeFilterCount(filters);
  const anyActive = hasActiveFilters(filters);

  return (
    <div data-testid="leads-filterbar" className="bg-[#101218] border-b border-white/10">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div role="search" className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40 pointer-events-none" aria-hidden="true" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('filterBar.searchPlaceholder', 'Search name, phone, email…')}
              data-testid="leads-search-input"
              aria-label={t('filterBar.searchAria', 'Search leads')}
              className="w-full pl-9 pr-9 py-2 rounded-lg bg-black/30 border border-white/10 text-sm text-white placeholder:text-white/40 focus:border-emerald-400 focus:outline-none"
            />
            {searchInput && (
              <button
                type="button"
                aria-label={t('filterBar.clearSearch', 'Clear search')}
                onClick={() => setSearchInput('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-white/40 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Desktop: inline filters */}
          <div className="hidden sm:flex items-center gap-2 flex-wrap">
            <StatusFilterChips
              value={filters.status ?? []}
              onChange={(next: LeadStatus[]) =>
                onChange({ ...filters, status: next.length > 0 ? next : undefined, page: 1 })
              }
            />
            <SourceFilterDropdown
              value={filters.source ?? []}
              onChange={(next: LeadSource[]) =>
                onChange({ ...filters, source: next.length > 0 ? next : undefined, page: 1 })
              }
            />
            <AssigneeFilterDropdown
              value={filters.assigned}
              onChange={(next) => onChange({ ...filters, assigned: next, page: 1 })}
            />
          </div>

          {/* Mobile: filters trigger */}
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className={`
              sm:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ring-1 transition-colors
              ${fCount > 0
                ? 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/30'
                : 'bg-white/[0.03] text-white/70 ring-white/10 hover:bg-white/[0.06]'
              }
            `}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {t('filterBar.filters', 'Filters')}{fCount > 0 ? ` (${fCount})` : ''}
          </button>

          {/* Sort always visible */}
          <SortDropdown
            value={filters.sort}
            onChange={(next: SortOption) => onChange({ ...filters, sort: next, page: 1 })}
          />
        </div>

        {/* Active filters summary (desktop + mobile) */}
        {anyActive && (
          <div className="flex items-center gap-3 mt-2 text-xs">
            <span className="text-white/50">
              {t('filterBar.filtersActive', '{{count}} filters active', { count: fCount })}
            </span>
            <button
              type="button"
              onClick={clearAll}
              className="text-emerald-300 hover:text-emerald-200 underline-offset-2 hover:underline"
            >
              {t('filterBar.clearAll', 'Clear all')}
            </button>
          </div>
        )}
      </div>

      <FilterSheet
        isOpen={sheetOpen}
        filters={filters}
        onChange={onChange}
        onClose={() => setSheetOpen(false)}
        onClearAll={clearAll}
      />
    </div>
  );
}
