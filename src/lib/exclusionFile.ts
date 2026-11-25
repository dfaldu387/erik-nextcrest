// Builds the "check before you buy" exclusion file: every parcel already owned in the chosen
// state and county, so it can be uploaded to Land Portal before a new purchase.
//
// FORMAT NOTE: the exact Land Portal upload format has not been verified against a sample file.
// The columns below are a placeholder until one is provided. Change EXCLUSION_HEADERS and
// exclusionRow() together when the real format is known.

export const EXCLUSION_HEADERS = ['State', 'County', 'APN'] as const;

export interface OwnedParcel {
  apn: string;
  state: string;
  county: string;
}

export function normalizeApn(apn: string): string {
  return apn.trim().replace(/\s+/g, '');
}

// Keeps one row per APN. Blank APNs are dropped, since they cannot be matched.
export function buildExclusionRows(parcels: OwnedParcel[]): string[][] {
  const seen = new Set<string>();
  const rows: string[][] = [];
  for (const parcel of parcels) {
    const apn = normalizeApn(parcel.apn);
    if (!apn) continue;
    const key = `${parcel.state}|${parcel.county}|${apn}`.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push([parcel.state.trim().toUpperCase(), parcel.county.trim(), apn]);
  }
  return rows.sort((a, b) => a[2].localeCompare(b[2], 'en-US', { numeric: true }));
}

export function exclusionFilename(state: string, county: string, date: Date): string {
  const safeCounty = county.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
  return `exclusion-${state.toLowerCase()}-${safeCounty}-${date.toISOString().slice(0, 10)}.csv`;
}
