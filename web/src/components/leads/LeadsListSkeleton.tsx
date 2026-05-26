// web/src/components/leads/LeadsListSkeleton.tsx
//
// Five shimmer rows matching LeadCard shape. Uses Tailwind's animate-pulse,
// matching the codebase pattern (TicketDetailsDrawer, HomeGate, etc.).

export function LeadsListSkeleton() {
  return (
    <div className="space-y-3" data-testid="leads-skeleton" aria-hidden="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-white/10 bg-white/[0.02] p-4 animate-pulse"
        >
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 rounded bg-white/10 shrink-0" />
            <div className="flex-1 space-y-2 min-w-0">
              <div className="h-4 w-32 rounded bg-white/10" />
              <div className="h-3 w-40 rounded bg-white/5" />
            </div>
            <div className="h-5 w-16 rounded-full bg-white/10 shrink-0" />
          </div>
        </div>
      ))}
    </div>
  );
}
