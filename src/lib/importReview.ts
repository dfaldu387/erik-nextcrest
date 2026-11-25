import type { LandRecord } from '@/data/types';
import { classifyCandidate, matchKey } from './duplicates';
import type { DuplicateCheckRow } from './duplicates';
import { mapRow } from './importMapping';
import type { Mapping } from './importMapping';
import { splitOwner } from './owner';

export interface BatchFile {
  name: string;
  table: string[][];
  mapping: Mapping;
}

export interface ReviewRow extends DuplicateCheckRow {
  source: string;
  fips: string;
  ownerName: string;
  isEntity: boolean;
  withinBatchDuplicate: boolean;
  firstSeenIn: string | null;
  fipsMissing: boolean;
}

// Checks every row against the database, then against the rows already seen in this batch.
// The first occurrence of a parcel is kept as new. Later occurrences in any file are flagged,
// so a parcel listed in two files is never counted twice.
export function reviewBatch(files: BatchFile[], owned: Map<string, LandRecord>): ReviewRow[] {
  const firstSeen = new Map<string, string>();
  const rows: ReviewRow[] = [];

  for (const file of files) {
    for (const cells of file.table.slice(1)) {
      const mapped = mapRow(cells, file.mapping);
      const result = classifyCandidate({ apn: mapped.apn, state: mapped.state, county: mapped.county }, owned);

      let withinBatchDuplicate = false;
      let firstSeenIn: string | null = null;
      if (result.status === 'new' && mapped.apn && mapped.state && mapped.county) {
        const key = matchKey(mapped.state, mapped.county, mapped.apn);
        const prior = firstSeen.get(key);
        if (prior) {
          withinBatchDuplicate = true;
          firstSeenIn = prior;
        } else {
          firstSeen.set(key, file.name);
        }
      }

      const owner = mapped.ownerName ? splitOwner(mapped.ownerName) : null;
      rows.push({
        ...result,
        source: file.name,
        fips: mapped.fips,
        ownerName: mapped.ownerName,
        isEntity: owner?.isEntity ?? false,
        withinBatchDuplicate,
        firstSeenIn,
        fipsMissing: mapped.fips === '',
      });
    }
  }

  return rows;
}

export interface BatchSummary {
  total: number;
  new: number;
  owned: number;
  withinBatchDuplicate: number;
  invalid: number;
  review: number;
  entities: number;
  fipsMissing: number;
}

export function summarizeBatch(rows: ReviewRow[]): BatchSummary {
  const summary: BatchSummary = {
    total: rows.length,
    new: 0,
    owned: 0,
    withinBatchDuplicate: 0,
    invalid: 0,
    review: 0,
    entities: 0,
    fipsMissing: 0,
  };
  for (const row of rows) {
    if (row.withinBatchDuplicate) summary.withinBatchDuplicate += 1;
    else if (row.status === 'new') summary.new += 1;
    else if (row.status === 'owned') summary.owned += 1;
    else if (row.status === 'invalid') summary.invalid += 1;
    else summary.review += 1;
    if (row.isEntity) summary.entities += 1;
    if (row.fipsMissing) summary.fipsMissing += 1;
  }
  return summary;
}
