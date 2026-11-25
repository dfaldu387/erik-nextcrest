import { describe, expect, it } from 'vitest';
import type { LandRecord } from '@/data/types';
import { buildOwnedIndex } from './duplicates';
import { suggestMapping } from './importMapping';
import { reviewBatch, summarizeBatch } from './importReview';
import type { BatchFile } from './importReview';

const HEADERS = ['APN', 'ACREAGE', 'OWNER NAME', 'PROPERTY COUNTY', 'PROPERTY STATE'];

function file(name: string, rows: string[][], headers = HEADERS): BatchFile {
  return { name, table: [headers, ...rows], mapping: suggestMapping(headers) };
}

const ownedRecord: LandRecord = {
  id: 'r1',
  apn: '001-234-567',
  state: 'FL',
  county: 'Lafayette',
  zip: '32008',
  acres: 10,
  ownerName: 'Owner',
  ownerType: 'Individual',
  phone: '',
  status: 'contacted_1',
  timesContacted: 1,
  responded: false,
  lastContactedAt: null,
  acquiredAt: '2026-01-01T00:00:00.000Z',
  assignedTo: null,
};

describe('batch import review', () => {
  it('flags a parcel that appears in two files only once as new', () => {
    const rows = reviewBatch(
      [
        file('a.csv', [['100-1', '5', 'Smith', 'Lafayette', 'FL']]),
        file('b.csv', [['100-1', '5', 'Smith', 'Lafayette', 'FL']]),
      ],
      new Map(),
    );
    expect(rows[0].withinBatchDuplicate).toBe(false);
    expect(rows[1].withinBatchDuplicate).toBe(true);
    expect(rows[1].firstSeenIn).toBe('a.csv');
  });

  it('marks parcels already in the database as owned', () => {
    const rows = reviewBatch(
      [file('a.csv', [['001234567', '5', 'Smith', 'Lafayette', 'FL'], ['100-2', '5', 'Smith', 'Lafayette', 'FL']])],
      buildOwnedIndex([ownedRecord]),
    );
    expect(rows[0].status).toBe('owned');
    expect(rows[1].status).toBe('new');
  });

  it('counts each outcome across all files', () => {
    const rows = reviewBatch(
      [
        file('a.csv', [
          ['100-1', '5', 'Smith', 'Lafayette', 'FL'],
          ['', '5', 'Missing', 'Lafayette', 'FL'],
        ]),
        file('b.csv', [['100-1', '5', 'Smith', 'Lafayette', 'FL']]),
      ],
      new Map(),
    );
    const summary = summarizeBatch(rows);
    expect(summary.total).toBe(3);
    expect(summary.new).toBe(1);
    expect(summary.invalid).toBe(1);
    expect(summary.withinBatchDuplicate).toBe(1);
  });

  it('keeps organisation owners whole', () => {
    const rows = reviewBatch(
      [file('a.csv', [['100-3', '5', 'Smith Family Trust', 'Lafayette', 'FL']])],
      new Map(),
    );
    expect(rows[0].isEntity).toBe(true);
    expect(rows[0].ownerName).toBe('Smith Family Trust');
  });

  it('reports rows without a FIPS code as fipsMissing instead of guessing one', () => {
    const rows = reviewBatch([file('a.csv', [['100-4', '5', 'Smith', 'Lafayette', 'FL']])], new Map());
    expect(rows[0].fipsMissing).toBe(true);
    expect(summarizeBatch(rows).fipsMissing).toBe(1);
  });

  it('reads FIPS from a Land Portal export that has a Parcel FIPS column', () => {
    const headers = ['APN', 'Parcel Full Address', 'Parcel State', 'Parcel County', 'Parcel FIPS'];
    const rows = reviewBatch(
      [file('madison.csv', [['09-04-10-0000-0000-00303', '1 Road', 'FL', 'Madison', '12079']], headers)],
      new Map(),
    );
    expect(rows[0].fips).toBe('12079');
    expect(rows[0].fipsMissing).toBe(false);
  });
});
