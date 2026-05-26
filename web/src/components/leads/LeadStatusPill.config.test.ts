import { describe, expect, it } from 'vitest';
import { LEAD_STATUS_CONFIG } from './LeadStatusPill.config';
import type { LeadStatus } from '../../types/lead';

const ALL_STATUSES: LeadStatus[] = [
  'NEW', 'QUALIFIED', 'QUOTED', 'WON', 'CONVERTED', 'LOST',
];

describe('LEAD_STATUS_CONFIG', () => {
  it('has an entry for every LeadStatus', () => {
    for (const status of ALL_STATUSES) {
      expect(LEAD_STATUS_CONFIG[status]).toBeDefined();
    }
  });

  it('every entry has non-empty label', () => {
    for (const status of ALL_STATUSES) {
      expect(LEAD_STATUS_CONFIG[status].label.length).toBeGreaterThan(0);
    }
  });

  it('every entry has Tailwind-shaped class strings', () => {
    for (const status of ALL_STATUSES) {
      const cfg = LEAD_STATUS_CONFIG[status];
      expect(cfg.bg).toMatch(/^bg-/);
      expect(cfg.text).toMatch(/^text-/);
      expect(cfg.ring).toMatch(/^ring-/);
      expect(cfg.dot).toMatch(/^bg-/);
    }
  });

  it('CONVERTED visually distinct from WON (different intensity)', () => {
    expect(LEAD_STATUS_CONFIG.CONVERTED.bg).not.toBe(LEAD_STATUS_CONFIG.WON.bg);
  });
});
