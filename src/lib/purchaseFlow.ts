// Logic for the Land Portal search-and-buy flow. Pure functions only, so they can be tested without the API.

import type { LandRecord } from '@/data/types';
import { matchKey } from './duplicates';

export interface SearchResult {
  propertyId: string;
  fips: string;
  apn: string;
  owner: string;
  address: string;
  acres: number | null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
}

// Maps raw Land Portal filter rows to search results. Rows without a property ID are dropped,
// and each property ID appears once.
export function toSearchResults(rows: Record<string, unknown>[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const row of rows) {
    const propertyId = text(row.propertyid);
    if (!propertyId || seen.has(propertyId)) continue;
    seen.add(propertyId);
    const acres = row.lotsizeacres == null ? NaN : Number(row.lotsizeacres);
    out.push({
      propertyId,
      fips: text(row.fips),
      apn: text(row.apn),
      owner: text(row.ownername1full),
      address: text(row.situsfullstreetaddress),
      acres: Number.isFinite(acres) ? acres : null,
    });
  }
  return out;
}

// Splits results into parcels we already own and parcels we do not. placeOf maps a FIPS code to the
// state and county we keep records under. A result with no APN, or with an unknown county, counts as new
// and is checked again on import.
export function splitByOwned(
  results: SearchResult[],
  ownedKeys: Set<string>,
  placeOf: (fips: string) => { state: string; county: string } | null,
): { fresh: SearchResult[]; owned: SearchResult[] } {
  const fresh: SearchResult[] = [];
  const owned: SearchResult[] = [];
  for (const r of results) {
    const place = placeOf(r.fips);
    const key = r.apn && place ? matchKey(place.state, place.county, r.apn) : '';
    if (key && ownedKeys.has(key)) owned.push(r);
    else fresh.push(r);
  }
  return { fresh, owned };
}

export function ownedKeysFrom(parcels: { apn: string; state: string; county: string }[]): Set<string> {
  const keys = new Set<string>();
  for (const p of parcels) {
    if (p.apn) keys.add(matchKey(p.state, p.county, p.apn));
  }
  return keys;
}

// Land Portal export request: the distinct FIPS codes and the property IDs of the selected results.
export function exportRequest(selected: SearchResult[]): { fips: string[]; propertyid: string[] } {
  const fips = [...new Set(selected.map((r) => r.fips).filter(Boolean))].sort();
  const propertyid = selected.map((r) => r.propertyId);
  return { fips, propertyid };
}

// Parcels already owned, shaped as the review step expects. Only the fields the duplicate check reads are filled in.
export function ownedRecordsFrom(parcels: { apn: string; state: string; county: string }[]): LandRecord[] {
  return parcels.map((p, i) => ({
    id: `owned-${i}`,
    apn: p.apn,
    state: p.state,
    county: p.county,
    zip: '',
    acres: 0,
    ownerName: '',
    ownerType: 'Individual',
    phone: '',
    status: 'never_marketed',
    timesContacted: 0,
    responded: false,
    lastContactedAt: null,
    acquiredAt: '',
    assignedTo: null,
  }));
}

export function exportTokensNeeded(selectedCount: number): number {
  return selectedCount;
}
