import { describe, expect, it } from 'vitest';
import {
  searchParamsToFilters,
  filtersToSearchParams,
  toServiceFilters,
  hasActiveFilters,
  activeFilterCount,
  nullsLastForSort,
  DEFAULT_FILTERS,
  SORT_OPTIONS,
  type LeadFiltersUrlState,
} from './leadsFilters';
import type { LeadOrderBy } from '../../types/lead';

describe('searchParamsToFilters', () => {
  it('returns defaults for empty URLSearchParams', () => {
    const out = searchParamsToFilters(new URLSearchParams());
    expect(out.sort).toBe(DEFAULT_FILTERS.sort);
    expect(out.page).toBe(1);
    expect(out.q).toBeUndefined();
    expect(out.status).toBeUndefined();
  });

  it('parses all known keys', () => {
    const sp = new URLSearchParams('q=priya&status=NEW,QUALIFIED&source=WALK_IN&assigned=me&sort=value_desc&page=3');
    const out = searchParamsToFilters(sp);
    expect(out.q).toBe('priya');
    expect(out.status).toEqual(['NEW', 'QUALIFIED']);
    expect(out.source).toEqual(['WALK_IN']);
    expect(out.assigned).toBe('me');
    expect(out.sort).toBe('value_desc');
    expect(out.page).toBe(3);
  });

  it('drops unknown status values, keeps known ones', () => {
    const sp = new URLSearchParams('status=NEW,FOO,QUALIFIED,BAR');
    expect(searchParamsToFilters(sp).status).toEqual(['NEW', 'QUALIFIED']);
  });

  it('drops unknown source values', () => {
    const sp = new URLSearchParams('source=WALK_IN,FOO');
    expect(searchParamsToFilters(sp).source).toEqual(['WALK_IN']);
  });

  it('returns undefined when status param entirely invalid', () => {
    const sp = new URLSearchParams('status=FOO,BAR');
    expect(searchParamsToFilters(sp).status).toBeUndefined();
  });

  it('falls back to default sort when sort key unknown', () => {
    const sp = new URLSearchParams('sort=alphabetical');
    expect(searchParamsToFilters(sp).sort).toBe(DEFAULT_FILTERS.sort);
  });

  it('clamps page to 1 for invalid page', () => {
    expect(searchParamsToFilters(new URLSearchParams('page=-1')).page).toBe(1);
    expect(searchParamsToFilters(new URLSearchParams('page=abc')).page).toBe(1);
    expect(searchParamsToFilters(new URLSearchParams('page=0')).page).toBe(1);
  });

  it('drops empty q string', () => {
    expect(searchParamsToFilters(new URLSearchParams('q=')).q).toBeUndefined();
    expect(searchParamsToFilters(new URLSearchParams('q=   ')).q).toBeUndefined();
  });

  it('rejects unknown assigned value', () => {
    expect(searchParamsToFilters(new URLSearchParams('assigned=somebody-else')).assigned).toBeUndefined();
  });
});

describe('filtersToSearchParams', () => {
  it('omits default values', () => {
    const sp = filtersToSearchParams(DEFAULT_FILTERS);
    expect(sp.toString()).toBe('');
  });

  it('serializes non-default values', () => {
    const sp = filtersToSearchParams({
      q: 'priya',
      status: ['NEW', 'QUALIFIED'],
      source: ['WALK_IN'],
      assigned: 'me',
      sort: 'value_desc',
      page: 3,
    });
    expect(sp.get('q')).toBe('priya');
    expect(sp.get('status')).toBe('NEW,QUALIFIED');
    expect(sp.get('source')).toBe('WALK_IN');
    expect(sp.get('assigned')).toBe('me');
    expect(sp.get('sort')).toBe('value_desc');
    expect(sp.get('page')).toBe('3');
  });

  it('omits page when page=1', () => {
    const sp = filtersToSearchParams({ ...DEFAULT_FILTERS, page: 1 });
    expect(sp.has('page')).toBe(false);
  });

  it('omits sort when sort is default', () => {
    const sp = filtersToSearchParams({ ...DEFAULT_FILTERS, sort: DEFAULT_FILTERS.sort });
    expect(sp.has('sort')).toBe(false);
  });

  it('trims q before serializing', () => {
    const sp = filtersToSearchParams({ ...DEFAULT_FILTERS, q: '  priya  ' });
    expect(sp.get('q')).toBe('priya');
  });

  it('round-trips with searchParamsToFilters preserving meaningful state', () => {
    const original: LeadFiltersUrlState = {
      q: 'priya',
      status: ['NEW', 'QUOTED'],
      source: ['WALK_IN', 'AGENT'],
      assigned: 'me',
      sort: 'value_desc',
      page: 5,
    };
    const sp = filtersToSearchParams(original);
    const parsed = searchParamsToFilters(sp);
    expect(parsed).toEqual(original);
  });
});

describe('toServiceFilters', () => {
  it('resolves assigned=me using currentUserId', () => {
    const out = toServiceFilters({ sort: 'activity_desc', page: 1, assigned: 'me' }, 'U1');
    expect(out.assignedTo).toBe('U1');
  });

  it('passes null when assigned=unassigned', () => {
    const out = toServiceFilters({ sort: 'activity_desc', page: 1, assigned: 'unassigned' }, 'U1');
    expect(out.assignedTo).toBeNull();
  });

  it('passes undefined when no assigned filter', () => {
    const out = toServiceFilters({ sort: 'activity_desc', page: 1 }, 'U1');
    expect(out.assignedTo).toBeUndefined();
  });

  it('passes sentinel when "me" but no user (defensive)', () => {
    const out = toServiceFilters({ sort: 'activity_desc', page: 1, assigned: 'me' }, null);
    // Should return a value that won't match any real user, preventing accidentally listing all
    expect(out.assignedTo).toBe('__no-user__');
  });

  it('translates sort=value_desc → orderBy=value_estimate, dir=desc', () => {
    const out = toServiceFilters({ sort: 'value_desc', page: 1 }, null);
    expect(out.orderBy).toBe('value_estimate');
    expect(out.orderDir).toBe('desc');
  });

  it('translates sort=activity_asc → orderBy=last_activity_at, dir=asc', () => {
    const out = toServiceFilters({ sort: 'activity_asc', page: 1 }, null);
    expect(out.orderBy).toBe('last_activity_at');
    expect(out.orderDir).toBe('asc');
  });

  it('passes through search/status/source', () => {
    const out = toServiceFilters(
      {
        q: 'priya',
        status: ['NEW'],
        source: ['WALK_IN'],
        sort: 'activity_desc',
        page: 1,
      },
      null,
    );
    expect(out.search).toBe('priya');
    expect(out.status).toEqual(['NEW']);
    expect(out.source).toEqual(['WALK_IN']);
  });
});

describe('nullsLastForSort', () => {
  it('returns true for value_desc / value_asc', () => {
    expect(nullsLastForSort('value_desc')).toBe(true);
    expect(nullsLastForSort('value_asc')).toBe(true);
  });

  it('returns false for non-value sorts', () => {
    expect(nullsLastForSort('activity_desc')).toBe(false);
    expect(nullsLastForSort('created_desc')).toBe(false);
  });
});

describe('hasActiveFilters', () => {
  it('returns false for defaults', () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
  });

  it('returns false for defaults + page change (page is not a filter)', () => {
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, page: 5 })).toBe(false);
  });

  it('returns false for defaults + sort change (sort is not a filter)', () => {
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, sort: 'value_desc' })).toBe(false);
  });

  it('returns true with q', () => {
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, q: 'priya' })).toBe(true);
  });

  it('returns true with status', () => {
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, status: ['NEW'] })).toBe(true);
  });

  it('returns true with assigned', () => {
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, assigned: 'me' })).toBe(true);
  });
});

describe('activeFilterCount', () => {
  it('counts 0 for defaults', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
  });

  it('counts 1 dimension for status with multiple values (not 2)', () => {
    expect(activeFilterCount({ ...DEFAULT_FILTERS, status: ['NEW', 'QUALIFIED', 'WON'] })).toBe(1);
  });

  it('counts 1 dimension per active filter regardless of values within', () => {
    expect(
      activeFilterCount({
        ...DEFAULT_FILTERS,
        status: ['NEW', 'QUALIFIED'],
        source: ['WALK_IN', 'AGENT', 'GOOGLE'],
        assigned: 'me',
        q: 'priya',
      }),
    ).toBe(4);
  });

  it('does not count sort or page', () => {
    expect(
      activeFilterCount({
        ...DEFAULT_FILTERS,
        sort: 'value_desc',
        page: 5,
      }),
    ).toBe(0);
  });
});

describe('SORT_OPTIONS', () => {
  it('every entry has all required metadata fields', () => {
    for (const opt of SORT_OPTIONS) {
      expect(opt.value).toBeTruthy();
      expect(opt.label.length).toBeGreaterThan(0);
      expect(opt.orderBy).toBeTruthy();
      expect(opt.orderDir).toMatch(/^(asc|desc)$/);
    }
  });

  it('every orderBy is a valid LeadOrderBy', () => {
    const valid: LeadOrderBy[] = ['last_activity_at', 'created_at', 'value_estimate'];
    for (const opt of SORT_OPTIONS) {
      expect(valid).toContain(opt.orderBy);
    }
  });

  it('values are unique', () => {
    const values = SORT_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('value sorts have nullsLast=true', () => {
    const valueDesc = SORT_OPTIONS.find((o) => o.value === 'value_desc');
    const valueAsc = SORT_OPTIONS.find((o) => o.value === 'value_asc');
    expect(valueDesc?.nullsLast).toBe(true);
    expect(valueAsc?.nullsLast).toBe(true);
  });
});
