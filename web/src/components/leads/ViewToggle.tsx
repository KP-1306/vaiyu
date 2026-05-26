// web/src/components/leads/ViewToggle.tsx
//
// Segmented control for List ↔ Kanban view.

import { List, Columns3 } from 'lucide-react';

export type LeadsView = 'list' | 'kanban';

interface Props {
  value: LeadsView;
  onChange: (next: LeadsView) => void;
}

export function ViewToggle({ value, onChange }: Props) {
  return (
    <div
      role="group"
      aria-label="View"
      data-testid="view-toggle"
      className="inline-flex items-center rounded-lg bg-white/[0.03] ring-1 ring-white/10 p-0.5"
    >
      <ToggleButton active={value === 'list'} onClick={() => onChange('list')} testId="view-toggle-list">
        <List className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">List</span>
      </ToggleButton>
      <ToggleButton active={value === 'kanban'} onClick={() => onChange('kanban')} testId="view-toggle-kanban">
        <Columns3 className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Kanban</span>
      </ToggleButton>
    </div>
  );
}

interface BtnProps {
  active: boolean;
  onClick: () => void;
  testId: string;
  children: React.ReactNode;
}

function ToggleButton({ active, onClick, testId, children }: BtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-pressed={active}
      className={`
        inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium
        transition-colors
        ${active ? 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/30' : 'text-white/60 hover:text-white'}
      `}
    >
      {children}
    </button>
  );
}
