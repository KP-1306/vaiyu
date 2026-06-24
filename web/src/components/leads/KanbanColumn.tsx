// web/src/components/leads/KanbanColumn.tsx

import { useDroppable } from '@dnd-kit/core';
import type { Lead, LeadStatus } from '../../types/lead';
import { LEAD_STATUS_CONFIG } from './LeadStatusPill.config';
import { KanbanLeadCard } from './KanbanLeadCard';
import { isOptimisticLead, type OptimisticLead } from './LeadQuickAddModal.optimistic';
import { moreInColumnLabel, canDropInKanban } from './kanbanHelpers';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  status: LeadStatus;
  leads: (Lead | OptimisticLead)[];
  totalInColumn: number | null;
  isLoading: boolean;
  /** Source status of the currently-active drag (null when no drag in progress). */
  activeDragFrom: LeadStatus | null;
  onViewInList: () => void;
  /** Card click handler (Day 9: opens detail drawer). */
  onCardClick?: (lead: Lead | OptimisticLead) => void;
}

export function KanbanColumn({
  status,
  leads,
  totalInColumn,
  isLoading,
  activeDragFrom,
  onViewInList,
  onCardClick,
}: Props) {
  const t = useOwnerT('owner-leads');
  const { isOver, setNodeRef } = useDroppable({
    id: status,
    data: { status },
  });

  const cfg = LEAD_STATUS_CONFIG[status];
  const dragInProgress = activeDragFrom !== null;
  // Compute drop intent ONLY when this column is the hover target
  const canDropHere = dragInProgress ? canDropInKanban(activeDragFrom, status) : true;
  const showInvalid = isOver && dragInProgress && !canDropHere;
  const showValid = isOver && dragInProgress && canDropHere;

  const visibleCount = leads.length;
  const moreLabel = moreInColumnLabel(visibleCount, totalInColumn, t);

  return (
    <section
      data-testid={`kanban-column-${status}`}
      className={`
        snap-start shrink-0 w-72 sm:w-[280px] flex flex-col
        rounded-xl border bg-white/[0.02] overflow-hidden
        transition-all
        ${showValid ? 'border-emerald-400/60 ring-2 ring-emerald-400/40' : ''}
        ${showInvalid ? 'border-red-400/60 ring-2 ring-red-400/40 cursor-not-allowed' : ''}
        ${!showValid && !showInvalid ? 'border-white/10' : ''}
      `}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-white/[0.02]">
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${cfg.dot}`} aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wider text-white/80">
            {t(`status.${status}`, cfg.label)}
          </span>
        </div>
        <span className="text-[11px] text-white/50 font-mono tabular-nums">
          {totalInColumn ?? visibleCount}
        </span>
      </header>

      {/* Body */}
      <div
        ref={setNodeRef}
        className="flex-1 min-h-[80px] p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-260px)]"
      >
        {isLoading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : visibleCount === 0 ? (
          <div className="flex items-center justify-center h-20 text-[11px] text-white/30 italic">
            {t('kanban.noLeadsHere', 'No leads here')}
          </div>
        ) : (
          leads.map((lead) => {
            const optimistic = isOptimisticLead(lead);
            return (
              <KanbanLeadCard
                key={optimistic ? `o-${lead.id}` : lead.id}
                lead={lead}
                onClick={onCardClick}
              />
            );
          })
        )}
      </div>

      {/* Footer — "+N more" link when capped */}
      {moreLabel && (
        <footer className="px-3 py-2 border-t border-white/10 bg-white/[0.02]">
          <button
            type="button"
            onClick={onViewInList}
            className="w-full text-[11px] text-emerald-300/80 hover:text-emerald-200 text-left"
          >
            {moreLabel}
          </button>
        </footer>
      )}
    </section>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 animate-pulse">
      <div className="h-3 w-24 rounded bg-white/10 mb-2" />
      <div className="h-2.5 w-32 rounded bg-white/5" />
    </div>
  );
}
