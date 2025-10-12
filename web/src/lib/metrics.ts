// One place to tune the landing-page KPIs (demo/pilot numbers)
// Keep values short; label can be a sentence fragment.

export type HeroMetric = {
  id: string;
  label: string;   // small caption
  value: string;   // big text
  sub?: string;    // optional footnote
  emoji?: string;  // optional leading icon
};

export const HERO_METRICS: HeroMetric[] = [
  {
    id: 'requests',
    emoji: '⏱️',
    label: 'Avg. request time',
    value: '↓ 28%',
    sub: 'from faster SLAs + fewer reworks',
  },
  {
    id: 'energy',
    emoji: '⚡',
    label: 'Peak-hour energy',
    value: '↓ 17%',
    sub: 'grid-savvy timing, same comfort',
  },
  {
    id: 'reviews',
    emoji: '📝',
    label: 'Verified reviews published',
    value: '↑ 2.3×',
    sub: 'truth-anchored drafts, owner-approved',
  },
];
