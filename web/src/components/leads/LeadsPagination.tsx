// web/src/components/leads/LeadsPagination.tsx
//
// Page-based pagination control. Hidden when total fits in one page.
// Desktop: prev / first / page numbers / last / next.
// Mobile: prev / "Page X of Y" / next.

import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  page: number;
  total: number | null;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export function LeadsPagination({ page, total, pageSize, onPageChange }: Props) {
  if (total === null || total <= pageSize) return null;

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const canPrev = page > 1;
  const canNext = page < lastPage;

  function go(p: number) {
    if (p < 1 || p > lastPage || p === page) return;
    onPageChange(p);
    // Scroll to top of list for context
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  // Build visible page numbers: always show first, last, current, and neighbors.
  const visible = new Set<number>([1, lastPage, page]);
  if (page > 1) visible.add(page - 1);
  if (page < lastPage) visible.add(page + 1);
  const sortedPages = Array.from(visible).sort((a, b) => a - b);

  return (
    <nav
      data-testid="leads-pagination"
      aria-label="Leads pagination"
      className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-6 text-sm"
    >
      <div className="text-white/60 text-xs">
        Showing <span className="text-white">{from}–{to}</span> of{' '}
        <span className="text-white">{total}</span>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => go(page - 1)}
          disabled={!canPrev}
          aria-label="Previous page"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-white/70 hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Prev</span>
        </button>

        {/* Desktop: page numbers with gaps */}
        <div className="hidden sm:flex items-center gap-1">
          {sortedPages.map((p, idx) => {
            const showGap = idx > 0 && p - sortedPages[idx - 1] > 1;
            return (
              <span key={p} className="flex items-center gap-1">
                {showGap && <span className="text-white/30 px-1">…</span>}
                <button
                  type="button"
                  onClick={() => go(p)}
                  aria-current={p === page ? 'page' : undefined}
                  className={`
                    min-w-[28px] px-2 py-1 rounded-md text-xs font-medium
                    ${p === page
                      ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40'
                      : 'text-white/70 hover:bg-white/[0.06]'
                    }
                  `}
                >
                  {p}
                </button>
              </span>
            );
          })}
        </div>

        {/* Mobile: compact label */}
        <div className="sm:hidden text-xs text-white/70 px-2">
          Page {page} of {lastPage}
        </div>

        <button
          type="button"
          onClick={() => go(page + 1)}
          disabled={!canNext}
          aria-label="Next page"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-white/70 hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}
