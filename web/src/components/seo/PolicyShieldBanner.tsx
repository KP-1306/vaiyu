// web/src/components/seo/PolicyShieldBanner.tsx
//
// Inline explainer of the deterministic Policy-Shield classification for the
// current draft. Updates live as the owner types / toggles proof.

import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { SEO_RISK_LABEL, SEO_RISK_TONE } from '../../config/localSeoPlanner';
import type { SeoBlueprintRisk } from '../../types/seoBlueprint';

interface Props {
  risk: SeoBlueprintRisk;
}

function explain(risk: SeoBlueprintRisk): string {
  switch (risk) {
    case 'SAFE_BLUEPRINT':
      return 'This concept reads as safe. Proof + governance review still required before any public page is built.';
    case 'NEEDS_PROOF':
      return 'Concept makes a verifiable claim (location/amenity/market). Tick the proof checklist as evidence is gathered.';
    case 'RISKY_DOORWAY':
      return 'Title uses superlative / overclaim language (best, cheapest, #1, guaranteed). Reword to a specific, honest claim.';
    case 'FAKE_LOCAL_CLAIM':
      return 'Reviewer flagged a fake local claim. Rework the concept around a real, substantiated location.';
    case 'DUPLICATE_LOW_VALUE':
      return 'Another live blueprint with the same title already exists for this hotel. Combine or differentiate.';
    case 'ON_HOLD':
      return 'Reviewer parked this blueprint. Resume from the lifecycle bar when ready.';
  }
}

export function PolicyShieldBanner({ risk }: Props) {
  const tone = SEO_RISK_TONE[risk];
  const cls =
    tone === 'safe'   ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100' :
    tone === 'warn'   ? 'border-amber-500/40 bg-amber-500/10 text-amber-100' :
    tone === 'danger' ? 'border-rose-500/40 bg-rose-500/10 text-rose-100' :
                        'border-slate-700 bg-slate-800/60 text-slate-200';
  const Icon = tone === 'safe' ? ShieldCheck : tone === 'danger' ? ShieldAlert : ShieldQuestion;
  return (
    <div
      role="status"
      className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${cls}`}
      data-testid="policy-shield-banner"
    >
      <Icon className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
      <div className="space-y-0.5">
        <p className="font-semibold uppercase tracking-wide text-[10px]">
          Policy Shield · {SEO_RISK_LABEL[risk]}
        </p>
        <p className="text-[11px] leading-relaxed">{explain(risk)}</p>
      </div>
    </div>
  );
}
