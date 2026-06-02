// web/src/components/quote/QuoteDraftPreview.tsx
//
// Editable draft preview. Operator can edit freely (textarea). Copy button
// is enabled only when both governance checkboxes are ticked AND the draft
// is non-empty. Clipboard fallback shows a visible error on failure.

import { useState } from 'react';
import { AlertCircle, Check, Copy, RotateCcw } from 'lucide-react';
import { track } from '../../lib/analytics';

type CopyState = 'idle' | 'copied' | 'error';

interface Props {
  draftText: string;
  onChange: (text: string) => void;
  onClear: () => void;
  approvalReady: boolean;
}

export function QuoteDraftPreview({ draftText, onChange, onClear, approvalReady }: Props) {
  const [copyState, setCopyState] = useState<CopyState>('idle');

  const empty = draftText.trim().length === 0;
  const canCopy = approvalReady && !empty;

  async function copyDraft() {
    if (!canCopy) return;
    if (!navigator.clipboard?.writeText) {
      setCopyState('error');
      window.setTimeout(() => setCopyState('idle'), 2500);
      return;
    }
    try {
      await navigator.clipboard.writeText(draftText);
      setCopyState('copied');
      track('quote_draft_copied', { length: draftText.length });
      window.setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('error');
      window.setTimeout(() => setCopyState('idle'), 2500);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-100">Draft proposal</h3>
        <span className="text-[10px] uppercase tracking-wide text-slate-500">
          Editable
        </span>
      </div>

      <textarea
        data-testid="quote-draft-textarea"
        value={draftText}
        onChange={(e) => onChange(e.target.value)}
        rows={18}
        spellCheck
        className="w-full resize-y rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-2.5 text-[13px] leading-relaxed text-slate-100 font-mono focus:border-emerald-400 focus:outline-none"
        placeholder="Select a lead and package, then click Generate draft. You can edit freely before copying."
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500">
          {empty
            ? 'No draft yet — fill the form on the left and click Generate.'
            : approvalReady
            ? 'Both governance checkboxes are ticked. You can copy when ready.'
            : 'Tick both operator approval checkboxes above to enable Copy.'}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClear}
            disabled={empty}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="quote-clear-button"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Clear
          </button>
          <button
            type="button"
            onClick={copyDraft}
            disabled={!canCopy}
            aria-live="polite"
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              copyState === 'error'
                ? 'border-red-500/50 bg-red-500/10 text-red-200'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
            }`}
            data-testid="quote-copy-button"
            title={
              !canCopy
                ? 'Tick both approval checkboxes and generate a draft first.'
                : 'Copy draft to clipboard.'
            }
          >
            {copyState === 'copied' ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-300" aria-hidden />
                Copied
              </>
            ) : copyState === 'error' ? (
              <>
                <AlertCircle className="h-3.5 w-3.5 text-red-300" aria-hidden />
                Copy failed
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden />
                Copy draft
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
