import type { LandRecord } from '@/data/types';
import { normalizeZip } from './zip';

export interface ListFilters {
  state: string;
  county: string;
  zip: string[]; // ZIP codes picked from the list; empty means any ZIP
  status: string;
  ownerType: string;
  minContacts: string;
  maxContacts: string;
  minAcres: string;
  maxAcres: string;
}

export const emptyFilters: ListFilters = {
  state: '',
  county: '',
  zip: [],
  status: '',
  ownerType: '',
  minContacts: '',
  maxContacts: '',
  minAcres: '',
  maxAcres: '',
};

function toNumber(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function applyListFilters(records: LandRecord[], filters: ListFilters): LandRecord[] {
  const minContacts = toNumber(filters.minContacts);
  const maxContacts = toNumber(filters.maxContacts);
  const minAcres = toNumber(filters.minAcres);
  const maxAcres = toNumber(filters.maxAcres);
  // Saved lists from before the ZIP picker stored a text value; those are read as no ZIP filter.
  const zips = Array.isArray(filters.zip) ? filters.zip.map(normalizeZip).filter(Boolean) : [];

  return records.filter(
    (r) =>
      (!filters.state || r.state === filters.state) &&
      (!filters.county || r.county === filters.county) &&
      (zips.length === 0 || zips.includes(normalizeZip(r.zip))) &&
      (!filters.status || r.status === filters.status) &&
      (!filters.ownerType || r.ownerType === filters.ownerType) &&
      (minContacts === undefined || r.timesContacted >= minContacts) &&
      (maxContacts === undefined || r.timesContacted <= maxContacts) &&
      (minAcres === undefined || r.acres >= minAcres) &&
      (maxAcres === undefined || r.acres <= maxAcres),
  );
}
