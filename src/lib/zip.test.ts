import { describe, expect, it } from 'vitest';
import { normalizeZip, parseZipList } from './zip';
import { applyListFilters, emptyFilters } from './listFilters';
import type { LandRecord } from '@/data/types';

describe('normalizeZip', () => {
  it('keeps 5 digits and drops the +4 suffix', () => {
    expect(normalizeZip('32066-1234')).toBe('32066');
    expect(normalizeZip(' 32066 ')).toBe('32066');
  });

  it('returns empty for anything shorter than 5 digits', () => {
    expect(normalizeZip('3206')).toBe('');
    expect(normalizeZip('')).toBe('');
  });
});

describe('parseZipList', () => {
  it('splits on commas, spaces and semicolons, and removes duplicates', () => {
    expect(parseZipList('32066, 32068 32066;32070')).toEqual(['32066', '32068', '32070']);
  });

  it('returns an empty list for blank input', () => {
    expect(parseZipList('   ')).toEqual([]);
  });
});

describe('applyListFilters ZIP', () => {
  const base = { ...emptyFilters } as const;
  const records = [
    { id: '1', zip: '32066', state: 'FL', county: 'Lafayette', status: 'never_marketed', ownerType: 'individual', timesContacted: 0, acres: 5 },
    { id: '2', zip: '32068-0001', state: 'FL', county: 'Lafayette', status: 'never_marketed', ownerType: 'individual', timesContacted: 0, acres: 5 },
    { id: '3', zip: '32070', state: 'FL', county: 'Lafayette', status: 'never_marketed', ownerType: 'individual', timesContacted: 0, acres: 5 },
  ] as unknown as LandRecord[];

  it('keeps every record when no ZIP is entered', () => {
    expect(applyListFilters(records, base)).toHaveLength(3);
  });

  it('matches the listed ZIPs, including ZIP+4 stored values', () => {
    const ids = applyListFilters(records, { ...base, zip: ['32066', '32068'] }).map((r) => r.id);
    expect(ids).toEqual(['1', '2']);
  });
});
