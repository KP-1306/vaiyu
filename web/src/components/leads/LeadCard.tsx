// web/src/components/leads/LeadCard.tsx
//
// List-row component for a Lead. Reused in Day 8 Kanban.
//
// Truncation rules baked in:
//   - min-w-0 on flex containers to prevent text from forcing the row wider
//   - truncate (single-line ellipsis) on name + phone/email
//   - line-clamp-1 on note preview
//   - shrink-0 on the status pill so it never collapses
//
// Optimistic state: rows tagged __optimistic render with reduced opacity +
// "Saving…" indicator and skip the click handler (you can't navigate to a
// lead that doesn't exist server-side yet).

import { useMemo } from 'react';
import { Clock, Loader2 } from 'lucide-react';
import type { Lead } from '../../types/lead';
import { LeadStatusPill } from './LeadStatusPill';
import { LeadSourceIcon } from './LeadSourceIcon';
import { isOptimisticLead, type OptimisticLead } from './LeadQuickAddModal.optimistic';
import { useOwnerT, type OwnerT } from '../../i18n/useOwnerT';

interface Props {
  lead: Lead | OptimisticLead;
  onClick?: (lead: Lead) => void;
}

function formatRelative(iso: string, t: OwnerT): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return t('rel.justNow', 'just now');
  if (diffMin < 60) return t('rel.mAgo', '{{m}}m ago', { m: diffMin });
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return t('rel.hAgo', '{{h}}h ago', { h: diffHr });
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return t('rel.dAgo', '{{d}}d ago', { d: diffDay });
  const diffMo = Math.round(diffDay / 30);
  return t('rel.moAgo', '{{mo}}mo ago', { mo: diffMo });
}

function formatNights(checkIn: string | null, checkOut: string | null, t: OwnerT): string | null {
  if (!checkIn || !checkOut) return null;
  const a = new Date(checkIn).getTime();
  const b = new Date(checkOut).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null;
  const nights = Math.round((b - a) / (1000 * 60 * 60 * 24));
  return t('card.nights', '{{n}}N', { n: nights });
}

function formatINR(n: number | null): string | null {
  if (n == null || Number.isNaN(n)) return null;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

export function LeadCard({ lead, onClick }: Props) {
  const t = useOwnerT('owner-leads');
  const optimistic = isOptimisticLead(lead);

  const subtitle = useMemo(() => {
    const parts: string[] = [];
    const nights = formatNights(lead.requested_check_in, lead.requested_check_out, t);
    if (nights) parts.push(nights);
    if (lead.party_adults || lead.party_children) {
      parts.push(`${lead.party_adults}A${lead.party_children ? ` ${lead.party_children}C` : ''}`);
    }
    if (lead.room_count > 1) parts.push(t('card.rooms', '{{count}} rooms', { count: lead.room_count }));
    const value = formatINR(lead.value_estimate);
    if (value) parts.push(value);
    return parts.join(' · '); // " · "
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead]);

  const clickable = !!onClick && !optimistic;

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : -1}
      data-testid={optimistic ? 'lead-card-optimistic' : 'lead-card'}
      onClick={clickable ? () => onClick!(lead) : undefined}
      onKeyDown={(e) => {
        if (!clickable) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick!(lead);
        }
      }}
      className={`
        group relative rounded-xl border border-white/10 bg-white/[0.02] p-4
        transition-colors
        ${clickable ? 'cursor-pointer hover:bg-white/[0.04] hover:border-white/20 focus:outline-none focus:ring-2 focus:ring-emerald-400/40' : ''}
        ${optimistic ? 'opacity-70' : ''}
      `}
    >
      {optimistic && (
        <div className="absolute right-3 top-3 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-amber-300">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('card.saving', 'Saving…')}
        </div>
      )}

      <div className="flex items-center gap-3 min-w-0">
        <LeadSourceIcon source={lead.source} size={20} className="shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="text-white font-medium truncate" title={lead.contact_name}>
              {lead.contact_name}
            </div>
          </div>
          <div className="text-xs text-white/60 truncate font-mono">
            {lead.contact_phone ?? lead.contact_email ?? '—'}
          </div>
          {subtitle && (
            <div className="text-xs text-white/50 truncate mt-0.5">{subtitle}</div>
          )}
          {lead.latest_note_preview && (
            <div className="text-xs text-white/50 line-clamp-1 mt-0.5 italic">
              &ldquo;{lead.latest_note_preview}&rdquo;
            </div>
          )}
        </div>

        <div className="shrink-0 flex items-end gap-2 flex-col">
          <LeadStatusPill status={lead.status} size="sm" />
          <div className="inline-flex items-center gap-1 text-[10px] text-white/40">
            <Clock className="h-3 w-3" aria-hidden="true" />
            {formatRelative(lead.last_activity_at, t)}
          </div>
        </div>
      </div>
    </div>
  );
}
