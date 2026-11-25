import type { LandRecord } from '@/data/types';

// Separators only. Letters, digits and leading zeros are preserved so that
// distinct parcels can never collapse into the same key.
export function normalizeApn(apn: string): string {
  return apn.trim().toUpperCase().replace(/[\s\-._/]/g, '');
}

export function matchKey(state: string, county: string, apn: string): string {
  return `${state.trim().toUpperCase()}|${county.trim().toLowerCase()}|${normalizeApn(apn)}`;
}

export type DuplicateStatus = 'owned' | 'new' | 'invalid' | 'review';

export interface DuplicateCheckRow {
  apn: string;
  state: string;
  county: string;
  status: DuplicateStatus;
  ownedSince: string | null;
  reason: string;
}

export function buildOwnedIndex(records: LandRecord[]): Map<string, LandRecord> {
  const index = new Map<string, LandRecord>();
  for (const record of records) {
    index.set(matchKey(record.state, record.county, record.apn), record);
  }
  return index;
}

export function classifyCandidate(
  candidate: { apn: string; state: string; county: string },
  owned: Map<string, LandRecord>,
): DuplicateCheckRow {
  const apn = candidate.apn.trim();
  if (!normalizeApn(apn)) {
    return { ...candidate, status: 'invalid', ownedSince: null, reason: 'Missing APN / parcel ID' };
  }
  if (!candidate.state.trim() || !candidate.county.trim()) {
    return {
      ...candidate,
      status: 'review',
      ownedSince: null,
      reason: 'State or county missing, so ownership cannot be confirmed',
    };
  }
  const hit = owned.get(matchKey(candidate.state, candidate.county, apn));
  if (hit) {
    return { ...candidate, status: 'owned', ownedSince: hit.acquiredAt, reason: 'Already in your database' };
  }
  return { ...candidate, status: 'new', ownedSince: null, reason: 'Not in your database' };
}
