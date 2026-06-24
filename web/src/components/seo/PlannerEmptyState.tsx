// web/src/components/seo/PlannerEmptyState.tsx
//
// First-blueprint empty state with safe starter ideas (per PO spec). Clicking
// a starter pre-fills the new-blueprint form; otherwise the owner writes
// their own concept. No fake/mock blueprint rows are ever inserted.

import { Compass, Plus } from 'lucide-react';
import { SEO_CATEGORY_LABEL, SEO_STARTER_IDEAS } from '../../config/localSeoPlanner';
import type { SeoBlueprintCategory } from '../../types/seoBlueprint';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  onPickStarter: (idea: { title: string; category: SeoBlueprintCategory }) => void;
  onCreateBlank: () => void;
}

export function PlannerEmptyState({ onPickStarter, onCreateBlank }: Props) {
  const t = useOwnerT('owner-seo');
  return (
    <div
      className="rounded-2xl border border-dashed border-slate-700 bg-[#0F1320] p-6 sm:p-8 text-center space-y-4"
      data-testid="planner-empty-state"
    >
      <div className="mx-auto h-10 w-10 rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/30 flex items-center justify-center">
        <Compass className="h-5 w-5 text-emerald-300" aria-hidden />
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-slate-100">{t('empty.title', 'No blueprints yet')}</h2>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          {t('empty.body', 'A blueprint is a *page idea* — not a public page. Pick a starter to see how the Policy Shield flags it, or write your own from scratch. Nothing is published.')}
        </p>
      </div>
      <button
        type="button"
        onClick={onCreateBlank}
        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3.5 py-2 text-xs font-medium text-emerald-100 hover:bg-emerald-500/25"
        data-testid="planner-empty-create"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {t('empty.startBlank', 'Start a blank blueprint')}
      </button>
      <div className="pt-2 text-left">
        <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">{t('empty.orPickStarter', 'Or pick a safe starter')}</p>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {SEO_STARTER_IDEAS.map((idea) => (
            <li key={idea.title}>
              <button
                type="button"
                onClick={() => onPickStarter(idea)}
                className="w-full text-left rounded-md border border-slate-800 bg-[#0B0E14] px-3 py-2 text-xs text-slate-200 hover:border-slate-700"
                data-testid={`planner-starter-${idea.category}`}
              >
                <span className="block font-medium">{idea.title}</span>
                <span className="block text-[10px] text-slate-500">{t(`category.${idea.category}`, SEO_CATEGORY_LABEL[idea.category])}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
