// web/src/components/seo/SeoBlueprintTimeline.tsx
//
// Audit timeline for a single blueprint. Shows every governance event in
// reverse-chronological order, with event-specific payload context where
// useful (override reason, request-changes note, hold reason, etc.).

import { useQuery } from '@tanstack/react-query';
import {
  Archive,
  Check,
  Loader2,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Send,
  Shield,
  Trash2,
} from 'lucide-react';
import { getSeoBlueprintEvents } from '../../services/seoBlueprintService';
import { seoBlueprintQueryKeys } from '../../services/seoBlueprintQueryKeys';
import type {
  SeoBlueprintEvent,
  SeoBlueprintEventType,
  SeoBlueprintRisk,
} from '../../types/seoBlueprint';
import { SEO_RISK_LABEL } from '../../config/localSeoPlanner';
import { useOwnerT, type OwnerT } from '../../i18n/useOwnerT';

interface Props {
  blueprintId: string;
}

export function SeoBlueprintTimeline({ blueprintId }: Props) {
  const t = useOwnerT('owner-seo');
  const q = useQuery({
    queryKey: seoBlueprintQueryKeys.events(blueprintId),
    queryFn: () => getSeoBlueprintEvents(blueprintId),
    staleTime: 5_000,
  });

  return (
    <section
      className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-3"
      data-testid="seo-blueprint-timeline"
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-100 inline-flex items-center gap-1.5">
          <Shield className="h-4 w-4 text-slate-400" aria-hidden />
          {t('timeline.activity', 'Activity')}
        </h3>
        <span className="text-[10px] uppercase tracking-wide text-slate-500">
          {t('timeline.eventCount', '{{count}} event', { count: q.data?.length ?? 0 })}
        </span>
      </header>

      {q.isLoading ? (
        <div className="py-4 text-center">
          <Loader2 className="h-4 w-4 animate-spin text-slate-500 mx-auto" aria-hidden />
        </div>
      ) : (q.data?.length ?? 0) === 0 ? (
        <p className="text-[11px] text-slate-500">{t('timeline.noActivity', 'No activity yet.')}</p>
      ) : (
        <ol className="space-y-2">
          {q.data!.map((e) => (
            <li key={e.id} className="flex items-start gap-2 rounded-md border border-slate-800 bg-[#0B0E14] px-2.5 py-2">
              <div className="mt-0.5 shrink-0 text-slate-400">{iconFor(e.event_type)}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-slate-200">{labelFor(e.event_type, t)}</span>
                  <time className="text-[10px] text-slate-500" dateTime={e.occurred_at}>
                    {formatWhen(e.occurred_at)}
                  </time>
                </div>
                {renderDetail(e, t)}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ─── icons + labels ─────────────────────────────────────────────────────────

function iconFor(t: SeoBlueprintEventType) {
  const cls = 'h-3.5 w-3.5';
  switch (t) {
    case 'CREATED':              return <Plus className={cls} aria-hidden />;
    case 'EDITED':               return <Pencil className={cls} aria-hidden />;
    case 'RECLASSIFIED':         return <RefreshCw className={cls} aria-hidden />;
    case 'SUBMITTED_FOR_REVIEW': return <Send className={cls} aria-hidden />;
    case 'APPROVED':             return <Check className={cls} aria-hidden />;
    case 'CHANGES_REQUESTED':    return <MessageSquare className={cls} aria-hidden />;
    case 'HELD':                 return <Pause className={cls} aria-hidden />;
    case 'RESUMED':              return <Play className={cls} aria-hidden />;
    case 'ARCHIVED':             return <Archive className={cls} aria-hidden />;
    case 'SOFT_DELETED':         return <Trash2 className={cls} aria-hidden />;
  }
}

function labelFor(type: SeoBlueprintEventType, t: OwnerT): string {
  switch (type) {
    case 'CREATED':              return t('event.CREATED', 'Created');
    case 'EDITED':               return t('event.EDITED', 'Edited');
    case 'RECLASSIFIED':         return t('event.RECLASSIFIED', 'Risk reclassified');
    case 'SUBMITTED_FOR_REVIEW': return t('event.SUBMITTED_FOR_REVIEW', 'Submitted for review');
    case 'APPROVED':             return t('event.APPROVED', 'Approved & marked ready');
    case 'CHANGES_REQUESTED':    return t('event.CHANGES_REQUESTED', 'Changes requested');
    case 'HELD':                 return t('event.HELD', 'Held');
    case 'RESUMED':              return t('event.RESUMED', 'Resumed');
    case 'ARCHIVED':             return t('event.ARCHIVED', 'Archived');
    case 'SOFT_DELETED':         return t('event.SOFT_DELETED', 'Deleted');
  }
}

// ─── payload renderers ──────────────────────────────────────────────────────

function renderDetail(e: SeoBlueprintEvent, t: OwnerT) {
  const riskLabel = (r: SeoBlueprintRisk) => t(`risk.${r}`, SEO_RISK_LABEL[r] ?? r);
  const p = (e.payload ?? {}) as Record<string, unknown>;
  switch (e.event_type) {
    case 'CREATED': {
      const cat = typeof p.category === 'string' ? p.category : null;
      const risk = typeof p.risk === 'string' ? (p.risk as SeoBlueprintRisk) : null;
      if (!cat && !risk) return null;
      return (
        <p className="mt-0.5 text-[10px] text-slate-500">
          {cat && <>{t('timeline.detailCategory', 'category')} <span className="text-slate-400">{t(`category.${cat}`, cat)}</span></>}
          {cat && risk && ' · '}
          {risk && <>{t('timeline.detailFlag', 'flag')} <span className="text-slate-400">{riskLabel(risk)}</span></>}
        </p>
      );
    }
    case 'RECLASSIFIED': {
      const from = typeof p.from === 'string' ? (p.from as SeoBlueprintRisk) : null;
      const to = typeof p.to === 'string' ? (p.to as SeoBlueprintRisk) : null;
      const overridden = p.overridden === true;
      const reason = typeof p.reason === 'string' ? p.reason : null;
      return (
        <p className="mt-0.5 text-[10px] text-slate-500">
          {from && to && (
            <>
              <span className="text-slate-400">{riskLabel(from)}</span>
              <span className="mx-1">→</span>
              <span className="text-slate-400">{riskLabel(to)}</span>
            </>
          )}
          {overridden && <span className="ml-1 text-amber-300">{t('timeline.detailOverridden', '(overridden)')}</span>}
          {reason && <span className="block mt-0.5 italic text-slate-400">"{reason}"</span>}
        </p>
      );
    }
    case 'APPROVED':
    case 'CHANGES_REQUESTED': {
      const note = typeof p.note === 'string' ? p.note : null;
      if (!note) return null;
      return <p className="mt-0.5 text-[10px] italic text-slate-400">"{note}"</p>;
    }
    case 'HELD':
    case 'ARCHIVED': {
      const reason = typeof p.reason === 'string' ? p.reason : null;
      const prev = typeof p.prev_status === 'string' ? p.prev_status : null;
      if (!reason && !prev) return null;
      return (
        <p className="mt-0.5 text-[10px] text-slate-500">
          {prev && <>{t('timeline.detailFrom', 'from')} <span className="text-slate-400">{t(`status.${prev}`, prev)}</span></>}
          {reason && <span className="block mt-0.5 italic text-slate-400">"{reason}"</span>}
        </p>
      );
    }
    case 'SOFT_DELETED': {
      const reason = typeof p.reason === 'string' ? p.reason : null;
      if (!reason) return null;
      return <p className="mt-0.5 text-[10px] italic text-slate-400">"{reason}"</p>;
    }
    default:
      return null;
  }
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
