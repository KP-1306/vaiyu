// web/src/components/followup/FollowUpEmptyState.tsx
//
// Real empty state for Follow-up Radar — no mock data, no demo.
// Tells the operator how to populate the workspace.

import { Link } from 'react-router-dom';
import { Plus, Radar, Users } from 'lucide-react';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  hotelSlug: string;
  onAddClick: () => void;
}

export function FollowUpEmptyState({ hotelSlug, onAddClick }: Props) {
  const t = useOwnerT('owner-followup');
  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0F1320] p-8 sm:p-10 text-center">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/30 text-emerald-300">
        <Radar className="h-5 w-5" aria-hidden />
      </div>
      <h2 className="mt-4 text-base font-semibold text-slate-100">
        {t('empty.title', 'No follow-ups yet')}
      </h2>
      <p className="mt-1 text-sm text-slate-400 max-w-md mx-auto">
        {t('empty.body', 'Follow-ups appear here automatically when you add a lead in your CRM, or when you send a quote. You can also add one manually.')}
      </p>
      <p className="mt-1 text-xs text-slate-500 italic max-w-md mx-auto">
        {t('empty.hinglish', 'Jab aap Leads mein nayi enquiry add karte hain, follow-up yahan apne aap aa jaata hai.')}
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={onAddClick}
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20"
          data-testid="follow-up-empty-add-button"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('empty.addFollowUp', 'Add follow-up')}
        </button>
        <Link
          to={`/owner/${hotelSlug}/leads`}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/60 px-3.5 py-2 text-xs text-slate-200 hover:bg-slate-800"
        >
          <Users className="h-3.5 w-3.5" aria-hidden />
          {t('empty.goToLeads', 'Go to Leads')}
        </Link>
      </div>
    </div>
  );
}
