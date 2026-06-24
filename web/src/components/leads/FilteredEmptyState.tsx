// web/src/components/leads/FilteredEmptyState.tsx
//
// Distinct from EmptyLeadsState — this is shown when filters narrow to 0 rows
// (not when the hotel has 0 leads ever). Different CTA: "Clear filters".

import { Search } from 'lucide-react';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  onClearFilters: () => void;
}

export function FilteredEmptyState({ onClearFilters }: Props) {
  const t = useOwnerT('owner-leads');
  return (
    <div
      className="flex flex-col items-center justify-center py-16 text-center"
      data-testid="leads-filtered-empty"
    >
      <div className="rounded-full bg-white/5 p-4 mb-4 ring-1 ring-white/10">
        <Search className="h-8 w-8 text-white/50" />
      </div>
      <h3 className="text-lg font-semibold text-white mb-1">{t('filtered.title', 'No leads match these filters')}</h3>
      <p className="text-sm text-white/60 max-w-sm mb-6">
        {t('filtered.body', 'Try widening your search or clearing one of the active filters.')}
      </p>
      <button
        type="button"
        data-testid="leads-clear-filters"
        onClick={onClearFilters}
        className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20 transition-colors"
      >
        {t('filtered.cta', 'Clear all filters')}
      </button>
    </div>
  );
}
