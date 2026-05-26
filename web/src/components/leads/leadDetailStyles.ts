// web/src/components/leads/leadDetailStyles.ts
// Shared input styling for LeadDetail sections.

const BASE =
  'w-full rounded-md border bg-black/30 px-2.5 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-emerald-400 focus:outline-none disabled:opacity-50';

export function fieldInputCls(hasError: boolean): string {
  return `${BASE} ${hasError ? 'border-red-500/60' : 'border-white/10'}`;
}
