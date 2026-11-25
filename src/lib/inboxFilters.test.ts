import { describe, expect, it } from 'vitest';
import { EMPTY_INBOX_FILTERS, areaCodeOf, calendarGrid, countActiveFilters, dateRangeError, presetRange } from './inboxFilters';

describe('calendarGrid', () => {
  it('lays out 42 days from the Sunday before the 1st, marking the month', () => {
    // 1 November 2026 is a Sunday.
    const grid = calendarGrid(2026, 10);
    expect(grid).toHaveLength(42);
    expect(grid[0]).toEqual({ day: '2026-11-01', inMonth: true });
    expect(grid[29]).toEqual({ day: '2026-11-30', inMonth: true });
    expect(grid[30]).toEqual({ day: '2026-12-01', inMonth: false });
  });

  it('starts with the previous month when the 1st is not a Sunday', () => {
    // 1 December 2026 is a Tuesday, so the grid starts on Sunday 29 November.
    const grid = calendarGrid(2026, 11);
    expect(grid[0]).toEqual({ day: '2026-11-29', inMonth: false });
    expect(grid[2]).toEqual({ day: '2026-12-01', inMonth: true });
  });
});

// Wednesday 25 November 2026 (local time).
const now = new Date(2026, 10, 25, 14, 0, 0);

describe('presetRange', () => {
  it('covers today', () => {
    expect(presetRange('today', now)).toEqual({ from: '2026-11-25', to: '2026-11-25' });
  });

  it('covers last calendar week, Sunday to Saturday', () => {
    expect(presetRange('last_week', now)).toEqual({ from: '2026-11-15', to: '2026-11-21' });
  });

  it('covers this month and last month', () => {
    expect(presetRange('this_month', now)).toEqual({ from: '2026-11-01', to: '2026-11-25' });
    expect(presetRange('last_month', now)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('covers the last 30 days including today, and the last year', () => {
    expect(presetRange('last_30_days', now)).toEqual({ from: '2026-10-27', to: '2026-11-25' });
    expect(presetRange('last_year', now)).toEqual({ from: '2025-11-25', to: '2026-11-25' });
  });
});

describe('areaCodeOf', () => {
  it('reads the area code of a 10-digit number', () => {
    expect(areaCodeOf('8434758031')).toBe('843');
    expect(areaCodeOf('(843) 475-8031')).toBe('843');
  });

  it('returns empty when there is no usable number', () => {
    expect(areaCodeOf(null)).toBe('');
    expect(areaCodeOf('12')).toBe('');
  });
});

describe('countActiveFilters and dateRangeError', () => {
  it('counts each filter group once', () => {
    expect(countActiveFilters(EMPTY_INBOX_FILTERS)).toBe(0);
    expect(
      countActiveFilters({ ...EMPTY_INBOX_FILTERS, includeLabels: ['NR', 'NI'], responseFrom: '2026-11-01', areaCodes: ['843'] }),
    ).toBe(3);
  });

  it('flags a date range that runs backwards', () => {
    expect(dateRangeError({ ...EMPTY_INBOX_FILTERS, responseFrom: '2026-11-10', responseTo: '2026-11-01' })).not.toBeNull();
    expect(dateRangeError({ ...EMPTY_INBOX_FILTERS, responseFrom: '2026-11-01', responseTo: '2026-11-10' })).toBeNull();
  });
});
