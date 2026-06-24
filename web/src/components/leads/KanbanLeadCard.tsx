// web/src/components/leads/KanbanLeadCard.tsx
//
// Compact card for the kanban board (smaller than list LeadCard).
// Two render modes:
//   - in-column draggable (uses dnd-kit useDraggable)
//   - overlay (during drag, rendered in DragOverlay portal — immune to cache re-renders)

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Loader2, Clock } from 'lucide-react';
import type { Lead } from '../../types/lead';
import { LeadSourceIcon } from './LeadSourceIcon';
import { isOptimisticLead, type OptimisticLead } from './LeadQuickAddModal.optimistic';
import { useOwnerT, type OwnerT } from '../../i18n/useOwnerT';

function formatRelative(iso: string, t: OwnerT): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMin = Math.round((Date.now() - then) / 60000);
  if (diffMin < 1) return t('relShort.now', 'now');
  if (diffMin < 60) return t('relShort.m', '{{m}}m', { m: diffMin });
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return t('relShort.h', '{{h}}h', { h: diffHr });
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return t('relShort.d', '{{d}}d', { d: diffDay });
  return t('relShort.mo', '{{mo}}mo', { mo: Math.round(diffDay / 30) });
}

function formatINR(n: number | null): string | null {
  if (n == null || Number.isNaN(n)) return null;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

interface BodyProps {
  lead: Lead | OptimisticLead;
  ghost?: boolean;       // render translucent (the source card while dragging)
  overlay?: boolean;     // render lifted (in DragOverlay portal)
}

function CardBody({ lead, ghost, overlay }: BodyProps) {
  const t = useOwnerT('owner-leads');
  const optimistic = isOptimisticLead(lead);
  const value = formatINR(lead.value_estimate);

  return (
    <div
      data-testid={`kanban-card-${lead.id}`}
      className={`
        relative rounded-lg border bg-[#0f1116] p-3
        transition-all
        ${overlay ? 'shadow-2xl ring-2 ring-emerald-400/60 scale-[1.02]' : 'border-white/10'}
        ${ghost ? 'opacity-30' : 'opacity-100'}
        ${optimistic ? 'opacity-70' : ''}
      `}
    >
      {optimistic && (
        <div className="absolute right-2 top-2 inline-flex items-center gap-1 text-[10px] text-amber-300">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('card.savingShort', 'Saving')}
        </div>
      )}

      <div className="flex items-center gap-2 min-w-0">
        <LeadSourceIcon source={lead.source} size={14} className="shrink-0" />
        <div className="text-sm text-white font-medium truncate" title={lead.contact_name}>
          {lead.contact_name}
        </div>
      </div>

      <div className="text-[11px] text-white/55 truncate font-mono mt-0.5">
        {lead.contact_phone ?? lead.contact_email ?? '—'}
      </div>

      <div className="flex items-center justify-between mt-2 text-[11px] text-white/60">
        <span className="truncate">{value ?? '—'}</span>
        <span className="inline-flex items-center gap-0.5 shrink-0">
          <Clock className="h-3 w-3" aria-hidden="true" />
          {formatRelative(lead.last_activity_at, t)}
        </span>
      </div>
    </div>
  );
}

// ─── Draggable wrapper for in-column rendering ────────────────────────────

interface DraggableProps {
  lead: Lead | OptimisticLead;
  onClick?: (lead: Lead | OptimisticLead) => void;
}

export function KanbanLeadCard({ lead, onClick }: DraggableProps) {
  const optimistic = isOptimisticLead(lead);
  // Optimistic rows are not draggable (no server id yet)
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
    data: { lead, fromStatus: lead.status },
    disabled: optimistic,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
  };

  // Click vs drag: dnd-kit PointerSensor has activationConstraint distance:4,
  // so clicks without movement don't start a drag. The onClick handler fires
  // safely for true clicks; drags are intercepted before onClick.
  function handleClick(e: React.MouseEvent) {
    if (optimistic || isDragging) return;
    e.stopPropagation();
    onClick?.(lead);
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      className={`
        ${optimistic ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}
        focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40 rounded-lg
      `}
    >
      <CardBody lead={lead} ghost={isDragging} />
    </div>
  );
}

// ─── Overlay render (in DragOverlay portal) ───────────────────────────────

export function KanbanLeadCardOverlay({ lead }: { lead: Lead | OptimisticLead }) {
  return <CardBody lead={lead} overlay />;
}
