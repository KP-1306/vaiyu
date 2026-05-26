// web/src/components/leads/LeadStatusPill.config.ts
//
// Pure visual config for LeadStatusPill. Extracted so it can be unit-tested
// without rendering React.

import type { LeadStatus } from '../../types/lead';

export interface LeadStatusVisualConfig {
  label: string;
  bg: string;
  text: string;
  ring: string;
  dot: string;
}

export const LEAD_STATUS_CONFIG: Record<LeadStatus, LeadStatusVisualConfig> = {
  NEW: {
    label: 'New',
    bg: 'bg-blue-500/15',
    text: 'text-blue-300',
    ring: 'ring-blue-500/30',
    dot: 'bg-blue-400',
  },
  QUALIFIED: {
    label: 'Qualified',
    bg: 'bg-indigo-500/15',
    text: 'text-indigo-300',
    ring: 'ring-indigo-500/30',
    dot: 'bg-indigo-400',
  },
  QUOTED: {
    label: 'Quoted',
    bg: 'bg-amber-500/15',
    text: 'text-amber-300',
    ring: 'ring-amber-500/30',
    dot: 'bg-amber-400',
  },
  WON: {
    label: 'Won',
    bg: 'bg-emerald-500/15',
    text: 'text-emerald-300',
    ring: 'ring-emerald-500/30',
    dot: 'bg-emerald-400',
  },
  CONVERTED: {
    label: 'Converted',
    bg: 'bg-emerald-600/20',
    text: 'text-emerald-200',
    ring: 'ring-emerald-600/40',
    dot: 'bg-emerald-500',
  },
  LOST: {
    label: 'Lost',
    bg: 'bg-slate-500/15',
    text: 'text-slate-400',
    ring: 'ring-slate-500/30',
    dot: 'bg-slate-500',
  },
};
