import { describe, expect, it } from 'vitest';
import { LEAD_SOURCE_CONFIG } from './LeadSourceIcon.config';
import type { LeadSource } from '../../types/lead';

const ALL_SOURCES: LeadSource[] = [
  'GOOGLE', 'WEBSITE', 'INSTAGRAM', 'FACEBOOK',
  'OTA', 'WALK_IN', 'REFERRAL',
  'AGENT', 'CORPORATE', 'WEDDING', 'GROUP', 'OTHER',
];

describe('LEAD_SOURCE_CONFIG', () => {
  it('has an entry for every LeadSource', () => {
    for (const source of ALL_SOURCES) {
      expect(LEAD_SOURCE_CONFIG[source]).toBeDefined();
    }
  });

  it('every entry has non-empty label and description', () => {
    for (const source of ALL_SOURCES) {
      const cfg = LEAD_SOURCE_CONFIG[source];
      expect(cfg.label.length).toBeGreaterThan(0);
      expect(cfg.description.length).toBeGreaterThan(0);
    }
  });

  it('every entry has a Lucide Icon component (function)', () => {
    for (const source of ALL_SOURCES) {
      expect(typeof LEAD_SOURCE_CONFIG[source].Icon).toBe('object');
    }
  });

  it('labels are unique (no two sources share the same display label)', () => {
    const labels = ALL_SOURCES.map((s) => LEAD_SOURCE_CONFIG[s].label);
    const unique = new Set(labels);
    expect(unique.size).toBe(labels.length);
  });
});
