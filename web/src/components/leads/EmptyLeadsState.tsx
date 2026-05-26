// web/src/components/leads/EmptyLeadsState.tsx

import { FileText, Plus } from 'lucide-react';

interface Props {
  onCreateClick: () => void;
}

export function EmptyLeadsState({ onCreateClick }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-emerald-500/10 p-4 mb-4 ring-1 ring-emerald-500/20">
        <FileText className="h-8 w-8 text-emerald-300" />
      </div>
      <h3 className="text-lg font-semibold text-white mb-1">No leads yet</h3>
      <p className="text-sm text-white/60 max-w-xs mb-6">
        Every enquiry you capture here becomes a follow-up. Start with the next call,
        walk-in, or referral.
      </p>
      <button
        type="button"
        data-testid="leads-empty-cta"
        onClick={onCreateClick}
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-400 transition-colors"
      >
        <Plus className="h-4 w-4" />
        Capture your first lead
      </button>
    </div>
  );
}
