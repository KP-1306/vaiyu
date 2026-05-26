import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const addBreadcrumbMock = vi.fn();
vi.mock('../../lib/monitoring', () => ({
  addBreadcrumb: (...args: unknown[]) => addBreadcrumbMock(...args),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import {
  KANBAN_COLUMN_ORDER,
  COLUMN_CAP,
  canDropInKanban,
  requiresConfirmationModal,
  explainBlockedDrop,
  moreInColumnLabel,
  trackDragEvent,
  detectViewport,
} from './kanbanHelpers';
import type { LeadStatus } from '../../types/lead';

const ALL: LeadStatus[] = ['NEW', 'QUALIFIED', 'QUOTED', 'WON', 'CONVERTED', 'LOST'];

beforeEach(() => {
  addBreadcrumbMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('KANBAN_COLUMN_ORDER', () => {
  it('contains all 6 statuses in pipeline order', () => {
    expect(KANBAN_COLUMN_ORDER).toEqual(['NEW', 'QUALIFIED', 'QUOTED', 'WON', 'CONVERTED', 'LOST']);
  });
  it('COLUMN_CAP is sensible (between 25 and 200)', () => {
    expect(COLUMN_CAP).toBeGreaterThanOrEqual(25);
    expect(COLUMN_CAP).toBeLessThanOrEqual(200);
  });
});

describe('canDropInKanban — explicit matrix', () => {
  it('blocks same-status drops', () => {
    for (const s of ALL) expect(canDropInKanban(s, s)).toBe(false);
  });

  it('blocks all drops onto CONVERTED (Day 8 deferred to Day 10 detail flow)', () => {
    for (const from of ALL) expect(canDropInKanban(from, 'CONVERTED')).toBe(false);
  });

  it('allows NEW → QUALIFIED, QUOTED, WON, LOST', () => {
    expect(canDropInKanban('NEW', 'QUALIFIED')).toBe(true);
    expect(canDropInKanban('NEW', 'QUOTED')).toBe(true);
    expect(canDropInKanban('NEW', 'WON')).toBe(true);
    expect(canDropInKanban('NEW', 'LOST')).toBe(true);
  });

  it('allows QUALIFIED → QUOTED, WON, LOST (but NOT back to NEW)', () => {
    expect(canDropInKanban('QUALIFIED', 'QUOTED')).toBe(true);
    expect(canDropInKanban('QUALIFIED', 'WON')).toBe(true);
    expect(canDropInKanban('QUALIFIED', 'LOST')).toBe(true);
    expect(canDropInKanban('QUALIFIED', 'NEW')).toBe(false);
  });

  it('allows QUOTED → WON, LOST', () => {
    expect(canDropInKanban('QUOTED', 'WON')).toBe(true);
    expect(canDropInKanban('QUOTED', 'LOST')).toBe(true);
    expect(canDropInKanban('QUOTED', 'NEW')).toBe(false);
    expect(canDropInKanban('QUOTED', 'QUALIFIED')).toBe(false);
  });

  it('allows WON → LOST (but NOT to NEW/QUALIFIED/QUOTED, and blocks CONVERTED per Day 8 UI rule)', () => {
    expect(canDropInKanban('WON', 'LOST')).toBe(true);
    expect(canDropInKanban('WON', 'CONVERTED')).toBe(false); // Day 8 UI rule
    expect(canDropInKanban('WON', 'NEW')).toBe(false);
    expect(canDropInKanban('WON', 'QUALIFIED')).toBe(false);
    expect(canDropInKanban('WON', 'QUOTED')).toBe(false);
  });

  it('CONVERTED is terminal (no outgoing transitions)', () => {
    for (const to of ALL) expect(canDropInKanban('CONVERTED', to)).toBe(false);
  });

  it('allows LOST → NEW (reopen path); blocks all others', () => {
    expect(canDropInKanban('LOST', 'NEW')).toBe(true);
    expect(canDropInKanban('LOST', 'QUALIFIED')).toBe(false);
    expect(canDropInKanban('LOST', 'QUOTED')).toBe(false);
    expect(canDropInKanban('LOST', 'WON')).toBe(false);
  });
});

describe('requiresConfirmationModal', () => {
  it("returns 'LOST' only for LOST", () => {
    expect(requiresConfirmationModal('LOST')).toBe('LOST');
  });
  it('returns null for every non-LOST status', () => {
    for (const s of ALL) {
      if (s === 'LOST') continue;
      expect(requiresConfirmationModal(s)).toBeNull();
    }
  });
});

describe('explainBlockedDrop', () => {
  it('CONVERTED gets dedicated guidance message', () => {
    expect(explainBlockedDrop('NEW', 'CONVERTED')).toMatch(/Convert/i);
  });
  it('returns empty string for valid drops', () => {
    expect(explainBlockedDrop('NEW', 'QUALIFIED')).toBe('');
  });
  it('returns empty string for same-status', () => {
    expect(explainBlockedDrop('NEW', 'NEW')).toBe('');
  });
  it('returns generic message for other blocked drops', () => {
    expect(explainBlockedDrop('CONVERTED', 'NEW')).toMatch(/Cannot move/i);
  });
});

describe('moreInColumnLabel', () => {
  it('returns null when total is null', () => {
    expect(moreInColumnLabel(50, null)).toBeNull();
  });
  it('returns null when total ≤ visible', () => {
    expect(moreInColumnLabel(50, 30)).toBeNull();
    expect(moreInColumnLabel(50, 50)).toBeNull();
  });
  it('returns label when total > visible', () => {
    expect(moreInColumnLabel(50, 142)).toContain('50 of 142');
  });
});

describe('trackDragEvent', () => {
  it('fires breadcrumb with category leadKanban.drag', () => {
    trackDragEvent({ type: 'drag.started', from: 'NEW', leadId: 'L1', viewport: 'mobile' });
    expect(addBreadcrumbMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'leadKanban.drag',
        message: 'drag.started',
        data: expect.objectContaining({ from: 'NEW', leadId: 'L1', viewport: 'mobile' }),
      }),
    );
  });

  it('uses warning level for drag.cancelled', () => {
    trackDragEvent({ type: 'drag.cancelled', from: 'NEW', leadId: 'L1', reason: 'esc' });
    expect(addBreadcrumbMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('uses warning level for drag.invalid_drop', () => {
    trackDragEvent({
      type: 'drag.invalid_drop',
      from: 'CONVERTED',
      attempted_to: 'NEW',
      leadId: 'L1',
    });
    expect(addBreadcrumbMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('uses info level for drag.started and drag.completed', () => {
    trackDragEvent({ type: 'drag.started', from: 'NEW', leadId: 'L1', viewport: 'desktop' });
    expect(addBreadcrumbMock).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'info' }));

    trackDragEvent({
      type: 'drag.completed',
      from: 'NEW',
      to: 'QUALIFIED',
      leadId: 'L1',
      duration_ms: 320,
      required_modal: false,
    });
    expect(addBreadcrumbMock).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'info' }));
  });
});

describe('detectViewport', () => {
  it('returns desktop when window is wider than 640', () => {
    vi.stubGlobal('window', { innerWidth: 1024 });
    expect(detectViewport()).toBe('desktop');
  });
  it('returns mobile when window is narrower than 640', () => {
    vi.stubGlobal('window', { innerWidth: 320 });
    expect(detectViewport()).toBe('mobile');
  });
  it('returns desktop when window is undefined (SSR safety)', () => {
    vi.stubGlobal('window', undefined);
    expect(detectViewport()).toBe('desktop');
  });
});
