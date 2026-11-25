import { describe, expect, it } from 'vitest';
import { buildCommitRows, chunk, internalIdFor } from './importCommit';
import { reviewBatch, type BatchFile } from './importReview';
import { buildOwnedIndex } from './duplicates';
import { autoMap } from './autoMap';
import type { LandRecord } from '@/data/types';

const table = [
  ['APN', 'State', 'County', 'Owner', 'Acres', 'Zip'],
  ['33-04-11-0000-0000-00601', 'FL', 'Lafayette', 'HYDE JIMMY A', '1.7', '32066'],
  ['04-05-11-0000-0000-00201', 'FL', 'Lafayette', 'GAMMA RENTALS LLC', '1,200.5', ''],
  ['04 05 11 0000 0000 00201', 'FL', 'Lafayette', 'GAMMA RENTALS LLC', '1', ''], // repeat of row 2
  ['99-99-99', 'FL', 'Lafayette', 'ALREADY OWNED', '5', '32066'], // owned below
  ['', 'FL', 'Lafayette', 'NO APN', '2', ''],
];

function batchFile(): BatchFile {
  return { name: 'purchase.csv', table, mapping: autoMap(table[0], table.slice(1)).mapping };
}

const owned = buildOwnedIndex([
  {
    id: '1',
    apn: '99-99-99',
    state: 'FL',
    county: 'Lafayette',
    zip: '',
    acres: 5,
    ownerName: '',
    ownerType: 'Individual',
    phone: '',
    status: 'never_marketed',
    timesContacted: 0,
    responded: false,
    lastContactedAt: null,
    acquiredAt: '',
    assignedTo: null,
  } satisfies LandRecord,
]);

describe('internalIdFor', () => {
  it('builds the same id for differently formatted APNs', () => {
    expect(internalIdFor('fl', 'St. Johns', '01-002-0034')).toBe(internalIdFor('FL', 'St. Johns', '01 002 0034'));
    expect(internalIdFor('FL', 'St. Johns', '01-002-0034')).toBe('FL-STJOHNS-010020034');
  });
});

describe('buildCommitRows', () => {
  it('saves only the parcels the review marked as new, once each', () => {
    const files = [batchFile()];
    const reviewed = reviewBatch(files, owned);
    const rows = buildCommitRows(files, reviewed, '2026-11-23', 'batch-1');

    expect(rows.map((r) => r.apn_raw)).toEqual(['33-04-11-0000-0000-00601', '04-05-11-0000-0000-00201']);
    expect(rows.every((r) => r.import_batch_id === 'batch-1')).toBe(true);
    expect(rows.every((r) => r.first_acquired_at === '2026-11-23')).toBe(true);
  });

  it('maps fields and leaves unknown values empty instead of inventing them', () => {
    const files = [batchFile()];
    const rows = buildCommitRows(files, reviewBatch(files, owned), '2026-11-23', 'b');
    const [first, second] = rows;

    expect(first).toMatchObject({
      source: 'land_portal',
      state: 'FL',
      county: 'Lafayette',
      zip_code: '32066',
      acreage: 1.7,
      owner_name: 'HYDE JIMMY A',
      owner_type: 'Individual',
      marketing_status: 'never_contacted',
      total_contacts: 0,
    });
    expect(second).toMatchObject({ owner_name: 'GAMMA RENTALS LLC', owner_type: 'Organization', zip_code: null, acreage: 1200.5 });
  });

  it('skips rows without a usable APN, state or county', () => {
    const files = [batchFile()];
    const rows = buildCommitRows(files, reviewBatch(files, owned), '2026-11-23', 'b');
    expect(rows.some((r) => r.owner_name === 'NO APN')).toBe(false);
  });
});

describe('chunk', () => {
  it('splits into fixed-size pieces with a shorter last piece', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});
