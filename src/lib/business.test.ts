import { describe, expect, it } from 'vitest';
import type { LandRecord } from '@/data/types';
import { classifyCandidate, buildOwnedIndex, normalizeApn } from './duplicates';
import { escapeCsvCell, parseCsv } from './csv';
import { summarize } from './metrics';

function record(overrides: Partial<LandRecord>): LandRecord {
  return {
    id: 'r1',
    apn: '001-234-567',
    state: 'TX',
    county: 'Bexar',
    zip: '78201',
    acres: 10,
    ownerName: 'John Smith',
    ownerType: 'Individual',
    phone: '(210) 555-0100',
    status: 'never_marketed',
    timesContacted: 0,
    responded: false,
    lastContactedAt: null,
    acquiredAt: '2026-01-01T00:00:00.000Z',
    assignedTo: null,
    ...overrides,
  };
}

describe('APN normalization', () => {
  it('keeps leading zeros so distinct parcels never collapse', () => {
    expect(normalizeApn('001-234-567')).toBe('001234567');
    expect(normalizeApn('1234567')).not.toBe(normalizeApn('001-234-567'));
  });

  it('strips separators and case but not meaningful characters', () => {
    expect(normalizeApn(' ab.12/3 ')).toBe('AB123');
  });
});

describe('duplicate classification', () => {
  const owned = buildOwnedIndex([record({ apn: '001-234-567' })]);

  it('flags an APN already owned in the same state and county', () => {
    const result = classifyCandidate({ apn: '001234567', state: 'tx', county: 'bexar' }, owned);
    expect(result.status).toBe('owned');
  });

  it('treats the same APN in another state as new', () => {
    const result = classifyCandidate({ apn: '001234567', state: 'FL', county: 'Broward' }, owned);
    expect(result.status).toBe('new');
  });

  it('marks a missing APN as invalid', () => {
    expect(classifyCandidate({ apn: '  ', state: 'TX', county: 'Bexar' }, owned).status).toBe('invalid');
  });

  it('sends rows without state or county to review instead of guessing', () => {
    expect(classifyCandidate({ apn: '001234567', state: '', county: '' }, owned).status).toBe('review');
  });
});

describe('CSV safety and parsing', () => {
  it('prefixes formula triggers so spreadsheets cannot execute them', () => {
    expect(escapeCsvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(escapeCsvCell('+1234')).toBe("'+1234");
  });

  it('parses quoted fields with commas and CRLF line endings', () => {
    const rows = parseCsv('apn,owner\r\n001,"Smith, John"\r\n');
    expect(rows).toEqual([
      ['apn', 'owner'],
      ['001', 'Smith, John'],
    ]);
  });
});

describe('portfolio summary', () => {
  it('counts statuses and contact reach from the records', () => {
    const summary = summarize([
      record({ id: 'a', status: 'followup_due', timesContacted: 2 }),
      record({ id: 'b', status: 'wrong_number', timesContacted: 1 }),
      record({ id: 'c', status: 'never_marketed' }),
    ]);
    expect(summary.total).toBe(3);
    expect(summary.followUpDue).toBe(1);
    expect(summary.wrongNumbers).toBe(1);
    expect(summary.reachedAtLeast1).toBe(2);
    expect(summary.reachedAtLeast2).toBe(1);
  });
});
