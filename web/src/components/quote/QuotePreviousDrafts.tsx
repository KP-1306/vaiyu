// web/src/components/quote/QuotePreviousDrafts.tsx
//
// Sidebar list of recent persisted drafts. Click → load into the editor.

import { useQuery } from '@tanstack/react-query';
import { Clock, FileText, Loader2, Sparkles } from 'lucide-react';
import { listQuoteDrafts, type QuoteDraftRow } from '../../services/quoteDraftService';

interface Props {
  hotelId: string;
  leadId: string | null;
  activeId: string | null;
  onPick: (row: QuoteDraftRow) => void;
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function QuotePreviousDrafts({ hotelId, leadId, activeId, onPick }: Props) {
  const query = useQuery({
    queryKey: ['quote-drafts', 'list', hotelId, leadId],
    queryFn: () => listQuoteDrafts(hotelId, { leadId, limit: 10 }),
    enabled: !!hotelId,
    staleTime: 15_000,
  });

  const rows = query.data ?? [];

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-100 inline-flex items-center gap-2">
          <Clock className="h-4 w-4 text-emerald-300" aria-hidden />
          Previous drafts
        </h3>
        {query.isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" aria-hidden />}
      </div>

      <p className="text-[11px] text-slate-500">
        {leadId
          ? 'Recent drafts for this enquiry.'
          : 'Recent drafts for this hotel — pick a lead to narrow.'}
      </p>

      {query.isError && (
        <p className="text-[11px] text-red-300">{(query.error as Error).message}</p>
      )}

      {rows.length === 0 && !query.isLoading && !query.isError ? (
        <p className="text-[11px] text-slate-500">No saved drafts yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => {
            const active = r.id === activeId;
            const preview = r.draft_text.split('\n').slice(0, 2).join(' ').slice(0, 80);
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onPick(r)}
                  className={`w-full text-left rounded-lg border px-3 py-2 text-xs transition-colors ${
                    active
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-slate-100'
                      : 'border-slate-800 bg-[#0B0E14] text-slate-200 hover:bg-slate-800/40'
                  }`}
                  data-testid={`quote-prev-${r.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide">
                      {r.generated_by === 'AI' ? (
                        <Sparkles className="h-3 w-3 text-emerald-300" aria-hidden />
                      ) : (
                        <FileText className="h-3 w-3 text-slate-400" aria-hidden />
                      )}
                      <span className={r.generated_by === 'AI' ? 'text-emerald-200' : 'text-slate-400'}>
                        {r.generated_by}
                      </span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-400">{r.status}</span>
                    </span>
                    <span className="text-[10px] text-slate-500">{relTime(r.updated_at)}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-300 line-clamp-2">{preview}…</div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
