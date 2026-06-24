// web/src/components/packages/PackageEmptyState.tsx
//
// Real empty state — no mock data. Two CTAs.

import { Plus, Tent } from 'lucide-react';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  onCreate: () => void;
}

export function PackageEmptyState({ onCreate }: Props) {
  const t = useOwnerT('owner-packages');
  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0F1320] p-8 sm:p-10 text-center">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/30 text-emerald-300">
        <Tent className="h-5 w-5" aria-hidden />
      </div>
      <h2 className="mt-4 text-base font-semibold text-slate-100">
        {t('empty.title', 'No packages yet')}
      </h2>
      <p className="mt-1 text-sm text-slate-400 max-w-md mx-auto">
        {t('empty.body', 'Build experience packages your team can share with guests — weekend escapes, Char Dham yatra, family stays, wellness retreats. Drafts stay private until you publish.')}
      </p>
      <p className="mt-1 text-xs text-slate-500 italic max-w-md mx-auto">
        {t('empty.hinglish', 'Apne hotel ke special packages yahan banayein. Guest ko share karne ke liye public link mil jaayega.')}
      </p>

      <div className="mt-5">
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20"
          data-testid="package-empty-create-button"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('empty.cta', 'Create your first package')}
        </button>
      </div>
    </div>
  );
}
