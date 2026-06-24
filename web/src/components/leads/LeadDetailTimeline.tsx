// web/src/components/leads/LeadDetailTimeline.tsx

import {
  Plus,
  ArrowRight,
  UserPlus,
  UserMinus,
  Lock,
  Unlock,
  MessageCircle,
  Tag,
  Edit2,
  Send,
  CheckCircle,
  Trash2,
  RotateCcw,
  HelpCircle,
  Clock,
} from 'lucide-react';
import type { LeadEvent } from '../../types/lead';
import { formatLeadEvent, type EventIconName, type EventColor } from './formatLeadEvent';
import { useOwnerT, type OwnerT } from '../../i18n/useOwnerT';

interface Props {
  events: LeadEvent[];
  isLoading: boolean;
}

const ICONS: Record<EventIconName, React.ComponentType<{ className?: string }>> = {
  plus: Plus,
  'arrow-right': ArrowRight,
  'user-plus': UserPlus,
  'user-minus': UserMinus,
  lock: Lock,
  unlock: Unlock,
  'message-circle': MessageCircle,
  tag: Tag,
  'edit-2': Edit2,
  send: Send,
  'check-circle': CheckCircle,
  'trash-2': Trash2,
  'rotate-ccw': RotateCcw,
  'help-circle': HelpCircle,
};

const COLOR_CLASSES: Record<EventColor, { bg: string; text: string; ring: string }> = {
  emerald: { bg: 'bg-emerald-500/15', text: 'text-emerald-300', ring: 'ring-emerald-500/30' },
  blue:    { bg: 'bg-blue-500/15',    text: 'text-blue-300',    ring: 'ring-blue-500/30' },
  indigo:  { bg: 'bg-indigo-500/15',  text: 'text-indigo-300',  ring: 'ring-indigo-500/30' },
  amber:   { bg: 'bg-amber-500/15',   text: 'text-amber-300',   ring: 'ring-amber-500/30' },
  red:     { bg: 'bg-red-500/15',     text: 'text-red-300',     ring: 'ring-red-500/30' },
  slate:   { bg: 'bg-slate-500/15',   text: 'text-slate-400',   ring: 'ring-slate-500/30' },
};

function formatRelative(iso: string, t: OwnerT): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMin = Math.round((Date.now() - then) / 60000);
  if (diffMin < 1) return t('rel.justNow', 'just now');
  if (diffMin < 60) return t('rel.mAgo', '{{m}}m ago', { m: diffMin });
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return t('rel.hAgo', '{{h}}h ago', { h: diffHr });
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return t('rel.dAgo', '{{d}}d ago', { d: diffDay });
  return t('rel.moAgo', '{{mo}}mo ago', { mo: Math.round(diffDay / 30) });
}

export function LeadDetailTimeline({ events, isLoading }: Props) {
  const t = useOwnerT('owner-leads');
  if (isLoading) {
    return (
      <section className="px-5 py-4" data-testid="lead-detail-timeline">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/60 mb-3">{t('timeline.heading', 'Timeline')}</h3>
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-md border border-white/10 bg-white/[0.02] p-3 animate-pulse">
              <div className="h-3 w-32 rounded bg-white/10 mb-2" />
              <div className="h-2.5 w-48 rounded bg-white/5" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (events.length === 0) {
    return (
      <section className="px-5 py-4" data-testid="lead-detail-timeline">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/60 mb-3">{t('timeline.heading', 'Timeline')}</h3>
        <div className="text-xs text-white/30 italic">{t('timeline.noActivity', 'No activity yet')}</div>
      </section>
    );
  }

  return (
    <section className="px-5 py-4" data-testid="lead-detail-timeline">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-white/60 mb-3">{t('timeline.heading', 'Timeline')}</h3>
      <ul className="space-y-2">
        {events.map((event) => {
          const fmt = formatLeadEvent(event, t);
          const Icon = ICONS[fmt.iconName] ?? HelpCircle;
          const colorCls = COLOR_CLASSES[fmt.color];
          return (
            <li
              key={event.id}
              className="flex items-start gap-2.5 rounded-md border border-white/10 bg-white/[0.02] p-2.5"
            >
              <div
                className={`shrink-0 rounded-full ring-1 p-1 ${colorCls.bg} ${colorCls.text} ${colorCls.ring}`}
              >
                <Icon className="h-3 w-3" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white break-words">{fmt.title}</div>
                {fmt.detail && (
                  <div className="mt-0.5 text-xs text-white/60 break-words">{fmt.detail}</div>
                )}
                <div className="mt-1 flex items-center gap-2 text-[11px] text-white/40">
                  <span>{fmt.actor}</span>
                  <span className="inline-flex items-center gap-0.5">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    {formatRelative(event.occurred_at, t)}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
