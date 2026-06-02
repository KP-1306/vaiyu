// web/src/components/seo/ProofChecklist.tsx
//
// Toggleable per-blueprint proof checklist (bilingual labels). Drives the
// NEEDS_PROOF flag in the Policy Shield. Proof is advisory in v0 — it does
// not hard-block READY_TO_BUILD.

import { Check, Square, CheckSquare } from 'lucide-react';
import type { SeoProofItem } from '../../types/seoBlueprint';
import { toggleProof } from './BlueprintForm.validation';

interface Props {
  items: SeoProofItem[];
  onChange: (next: SeoProofItem[]) => void;
  disabled?: boolean;
}

export function ProofChecklist({ items, onChange, disabled = false }: Props) {
  if (items.length === 0) {
    return (
      <p className="text-[11px] text-slate-500">
        No proof items required for this category. The Policy Shield will still flag superlatives.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5" data-testid="proof-checklist">
      {items.map((p) => (
        <li key={p.key}>
          <button
            type="button"
            onClick={() => onChange(toggleProof(items, p.key))}
            disabled={disabled}
            className={`group flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
              p.satisfied
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
                : 'border-slate-700 bg-slate-800/40 text-slate-200 hover:bg-slate-800'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            data-testid={`proof-item-${p.key}`}
            aria-pressed={p.satisfied}
          >
            {p.satisfied ? (
              <CheckSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-300" aria-hidden />
            ) : (
              <Square className="h-3.5 w-3.5 mt-0.5 shrink-0 text-slate-500" aria-hidden />
            )}
            <span className="min-w-0">
              <span className="block">{p.label_en}</span>
              <span className="block text-[10px] text-slate-400">{p.label_hi}</span>
            </span>
            {p.satisfied && <Check className="ml-auto h-3 w-3 text-emerald-300 shrink-0" aria-hidden />}
          </button>
        </li>
      ))}
    </ul>
  );
}
