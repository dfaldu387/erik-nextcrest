// Filter choices for the Inbox, and the pure helpers behind them (tested offline).

export type MatchMode = 'any' | 'all';

export interface InboxFilters {
  includeLabels: string[];
  includeMode: MatchMode;
  excludeLabels: string[];
  excludeMode: MatchMode;
  responseFrom: string; // YYYY-MM-DD, '' when not set
  responseTo: string; // YYYY-MM-DD, '' when not set
  areaCodes: string[];
}

export const EMPTY_INBOX_FILTERS: InboxFilters = {
  includeLabels: [],
  includeMode: 'any',
  excludeLabels: [],
  excludeMode: 'any',
  responseFrom: '',
  responseTo: '',
  areaCodes: [],
};

export type DatePreset = 'today' | 'last_week' | 'this_month' | 'last_month' | 'last_30_days' | 'last_year';

export const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'last_week', label: 'Last week' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'last_30_days', label: 'Last 30 days' },
  { key: 'last_year', label: 'Last year' },
];

// Local calendar date as YYYY-MM-DD.
export function toIsoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// The from and to days for a preset, counted back from today. Calendar weeks start on Sunday.
export function presetRange(preset: DatePreset, now: Date = new Date()): { from: string; to: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAgo = (n: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
  switch (preset) {
    case 'today':
      return { from: toIsoDay(today), to: toIsoDay(today) };
    case 'last_week': {
      const start = daysAgo(today.getDay() + 7);
      const end = daysAgo(today.getDay() + 1);
      return { from: toIsoDay(start), to: toIsoDay(end) };
    }
    case 'this_month':
      return { from: toIsoDay(new Date(today.getFullYear(), today.getMonth(), 1)), to: toIsoDay(today) };
    case 'last_month':
      return {
        from: toIsoDay(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        to: toIsoDay(new Date(today.getFullYear(), today.getMonth(), 0)),
      };
    case 'last_30_days':
      return { from: toIsoDay(daysAgo(29)), to: toIsoDay(today) };
    case 'last_year':
      return { from: toIsoDay(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())), to: toIsoDay(today) };
  }
}

// The 42 cells of a month view, Sunday first. Days from the neighbouring months are included, marked inMonth false.
export function calendarGrid(year: number, month: number): { day: string; inMonth: boolean }[] {
  const firstWeekday = new Date(year, month, 1).getDay();
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(year, month, 1 - firstWeekday + i);
    return { day: toIsoDay(d), inMonth: d.getMonth() === month };
  });
}

// The first three digits of a 10-digit US phone number.
export function areaCodeOf(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10, -7) : '';
}

// How many filter groups are set, for the button badge.
export function countActiveFilters(filters: InboxFilters): number {
  let count = 0;
  if (filters.includeLabels.length) count += 1;
  if (filters.excludeLabels.length) count += 1;
  if (filters.responseFrom || filters.responseTo) count += 1;
  if (filters.areaCodes.length) count += 1;
  return count;
}

// Checks the response-date range is in order. Returns a message, or null when it is fine.
export function dateRangeError(filters: InboxFilters): string | null {
  if (filters.responseFrom && filters.responseTo && filters.responseFrom > filters.responseTo) {
    return 'The "from" date is after the "to" date.';
  }
  return null;
}
