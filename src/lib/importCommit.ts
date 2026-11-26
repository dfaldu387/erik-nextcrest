// Turns a reviewed import into the rows that get saved to the properties table.
// Only rows the review marked as new are saved. Owned parcels and repeats are left as they are, so
// an import never changes a property that already exists.

import type { BatchFile, BatchSummary, ReviewRow } from './importReview';
import { mapRow } from './importMapping';
import { normalizeApn } from './duplicates';
import { extractPhones, type PhoneLink } from './phones';

export interface PropertyInsert {
  internal_id: string;
  source: 'land_portal';
  state: string;
  county: string;
  zip_code: string | null;
  apn_raw: string;
  acreage: number | null;
  owner_name: string | null;
  owner_type: 'Individual' | 'Organization';
  first_acquired_at: string;
  marketing_status: 'never_contacted';
  total_contacts: number;
  import_batch_id: string;
  // Property details from the file (see propertyDetailsFrom). Optional so older callers still type-check.
  address?: string | null;
  city?: string | null;
  mailing_address?: string | null;
  mailing_city?: string | null;
  mailing_state?: string | null;
  mailing_zip?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  land_use?: string | null;
  zoning?: string | null;
  assessed_value?: number | null;
  market_value?: number | null;
  year_built?: number | null;
  import_fields?: Record<string, string>;
}

// Header lookup, ignoring case and extra spaces, so "Mail Full Address" and "mail full address" both match.
function valueOf(headers: string[], cells: string[], name: string): string {
  const wanted = name.toLowerCase();
  const index = headers.findIndex((h) => h.replace(/\s+/g, ' ').trim().toLowerCase() === wanted);
  return index >= 0 ? (cells[index] ?? '').replace(/\s+/g, ' ').trim() : '';
}

function numberOrNull(raw: string): number | null {
  const value = Number(raw.replace(/[$,\s]/g, ''));
  return raw.trim() !== '' && Number.isFinite(value) ? value : null;
}

/**
 * The property details of one file row: the fields the screens show, plus every non-empty column of the row
 * (import_fields), keyed by the file's own header. The mailing address comes from "Mail Full Address" and friends.
 */
export function propertyDetailsFrom(headers: string[], cells: string[]): Partial<PropertyInsert> {
  const importFields: Record<string, string> = {};
  headers.forEach((header, index) => {
    const value = (cells[index] ?? '').replace(/\s+/g, ' ').trim();
    const key = header.replace(/\s+/g, ' ').trim();
    if (key && value) importFields[key] = value;
  });
  const text = (name: string) => valueOf(headers, cells, name) || null;
  const year = numberOrNull(valueOf(headers, cells, 'Year Built'));
  return {
    address: text('Parcel Full Address'),
    city: text('Parcel City'),
    mailing_address: text('Mail Full Address'),
    mailing_city: text('Mail City'),
    mailing_state: text('Mail State'),
    mailing_zip: text('Mail Zip'),
    latitude: numberOrNull(valueOf(headers, cells, 'Latitude')),
    longitude: numberOrNull(valueOf(headers, cells, 'Longitude')),
    land_use: text('Land Use'),
    zoning: text('Zoning'),
    assessed_value: numberOrNull(valueOf(headers, cells, 'Total Assessed Value')),
    market_value: numberOrNull(valueOf(headers, cells, 'Total Market Value')),
    year_built: year !== null && year > 0 ? Math.round(year) : null,
    import_fields: importFields,
  };
}

// Stable identity for a parcel: state, county and normalized APN. Matches the duplicate check.
export function internalIdFor(state: string, county: string, apn: string): string {
  const countyCode = county.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return `${state.trim().toUpperCase()}-${countyCode}-${normalizeApn(apn)}`;
}

function parseAcres(raw: string): number | null {
  const value = Number(raw.replace(/,/g, '').trim());
  return raw.trim() !== '' && Number.isFinite(value) ? value : null;
}

// `reviewed` must come from reviewBatch(files, ...) with the same files, in the same order.
export function buildCommitRows(
  files: BatchFile[],
  reviewed: ReviewRow[],
  purchaseDate: string,
  batchId: string,
): PropertyInsert[] {
  const rows: PropertyInsert[] = [];
  let index = 0;

  for (const file of files) {
    const headers = file.table[0] ?? [];
    for (const cells of file.table.slice(1)) {
      const verdict = reviewed[index];
      index += 1;
      if (!verdict || verdict.status !== 'new' || verdict.withinBatchDuplicate) continue;

      const mapped = mapRow(cells, file.mapping);
      if (!mapped.apn.trim() || !mapped.state.trim() || !mapped.county.trim()) continue;

      const apn = mapped.apn.trim();
      rows.push({
        internal_id: internalIdFor(mapped.state, mapped.county, apn),
        source: 'land_portal',
        state: mapped.state.trim().toUpperCase(),
        county: mapped.county.trim(),
        zip_code: mapped.zip.trim() || null,
        apn_raw: apn,
        acreage: parseAcres(mapped.acres),
        owner_name: mapped.ownerName.trim() || null,
        owner_type: verdict.isEntity ? 'Organization' : 'Individual',
        first_acquired_at: purchaseDate,
        marketing_status: 'never_contacted',
        total_contacts: 0,
        import_batch_id: batchId,
        ...propertyDetailsFrom(headers, cells),
      });
    }
  }

  return rows;
}

// Splits rows into batches of at most `size`, so each database request stays small.
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Counts shown on the save panel and written to the batch record.
export interface SaveCounts {
  total: number;
  newRows: number;
  existing: number;
  duplicate: number;
  invalid: number;
  missingApn: number;
}

const MISSING_APN_REASON = 'Missing APN / parcel ID';

export function countsFrom(summary: BatchSummary, reviewed: ReviewRow[]): SaveCounts {
  const missingApn = reviewed.filter(
    (r) => r.status === 'invalid' && r.reason === MISSING_APN_REASON && !r.withinBatchDuplicate,
  ).length;
  return {
    total: summary.total,
    newRows: summary.new,
    existing: summary.owned,
    duplicate: summary.withinBatchDuplicate,
    invalid: summary.invalid - missingApn,
    missingApn,
  };
}

// Phone numbers for each new property, keyed by its internal ID. Uses the same row order and checks as buildCommitRows.
export function buildCommitPhones(files: BatchFile[], reviewed: ReviewRow[]): Map<string, PhoneLink[]> {
  const out = new Map<string, PhoneLink[]>();
  let index = 0;
  for (const file of files) {
    const headers = file.table[0] ?? [];
    for (const cells of file.table.slice(1)) {
      const verdict = reviewed[index];
      index += 1;
      if (!verdict || verdict.status !== 'new' || verdict.withinBatchDuplicate) continue;

      const mapped = mapRow(cells, file.mapping);
      if (!mapped.apn.trim() || !mapped.state.trim() || !mapped.county.trim()) continue;

      const phones = extractPhones(headers, cells);
      if (phones.length > 0) out.set(internalIdFor(mapped.state, mapped.county, mapped.apn.trim()), phones);
    }
  }
  return out;
}
