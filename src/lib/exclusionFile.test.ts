import { describe, expect, it } from 'vitest';
import { buildExclusionRows, exclusionFilename, normalizeApn } from './exclusionFile';

describe('buildExclusionRows', () => {
  it('keeps one row per parcel and drops blank APNs', () => {
    const rows = buildExclusionRows([
      { apn: ' 33-04-11-0000-0000-00601 ', state: 'FL', county: 'Lafayette' },
      { apn: '33-04-11-0000-0000-00601', state: 'FL', county: 'Lafayette' },
      { apn: '   ', state: 'FL', county: 'Lafayette' },
      { apn: '04-05-11-0000-0000-00201', state: 'fl', county: 'Lafayette' },
    ]);
    expect(rows).toEqual([
      ['FL', 'Lafayette', '04-05-11-0000-0000-00201'],
      ['FL', 'Lafayette', '33-04-11-0000-0000-00601'],
    ]);
  });

  it('sorts APNs naturally', () => {
    const rows = buildExclusionRows([
      { apn: 'A-10', state: 'FL', county: 'X' },
      { apn: 'A-2', state: 'FL', county: 'X' },
    ]);
    expect(rows.map((r) => r[2])).toEqual(['A-2', 'A-10']);
  });
});

describe('normalizeApn', () => {
  it('removes surrounding and inner whitespace', () => {
    expect(normalizeApn('  12 34 ')).toBe('1234');
  });
});

describe('exclusionFilename', () => {
  it('builds a safe, dated filename', () => {
    expect(exclusionFilename('FL', 'St. Johns', new Date('2026-11-23T10:00:00Z'))).toBe('exclusion-fl-st-johns-2026-11-23.csv');
  });
});
