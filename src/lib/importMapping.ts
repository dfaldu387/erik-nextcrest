export type TargetKey = 'fips' | 'apn' | 'state' | 'county' | 'ownerName' | 'acres' | 'zip' | 'phone';

export interface MappingTarget {
  key: TargetKey;
  label: string;
  required: boolean;
  pattern: RegExp;
}

// Patterns match the real Land Portal and Smarter Contact headers, after lower-casing and trimming.
export const MAPPING_TARGETS: MappingTarget[] = [
  { key: 'apn', label: 'APN / Parcel ID', required: true, pattern: /^(apn|parcel id|parcel number)$/ },
  { key: 'state', label: 'State', required: true, pattern: /^(state|property state|parcel state)$/ },
  { key: 'county', label: 'County', required: true, pattern: /^(county|property county|parcel county)$/ },
  { key: 'fips', label: 'County FIPS', required: false, pattern: /^(parcel fips|fips)$/ },
  { key: 'ownerName', label: 'Owner name', required: false, pattern: /^(owner|owner name|owner name\(s\)|owner 1 full name)$/ },
  { key: 'acres', label: 'Acres', required: false, pattern: /^(acres?|acreage|lot acres|calc acreage|gis acres)$/ },
  { key: 'zip', label: 'ZIP', required: false, pattern: /^(zip|zip code|property zip|parcel zip|situs zip5|zip5)$/ },
  { key: 'phone', label: 'Phone', required: false, pattern: /^phone( \d)?$/ },
];

// -1 means the field is not in this file.
export type Mapping = Record<TargetKey, number>;

export function normalizeHeader(header: string): string {
  return header.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function suggestMapping(headers: string[]): Mapping {
  return Object.fromEntries(
    MAPPING_TARGETS.map((t) => [t.key, headers.findIndex((h) => t.pattern.test(normalizeHeader(h)))]),
  ) as Mapping;
}

export function isMappingComplete(mapping: Mapping): boolean {
  return MAPPING_TARGETS.filter((t) => t.required).every((t) => mapping[t.key] >= 0);
}

export function cell(cells: string[], index: number): string {
  return index >= 0 ? (cells[index] ?? '').replace(/\s+/g, ' ').trim() : '';
}

export interface MappedRow {
  fips: string;
  apn: string;
  state: string;
  county: string;
  ownerName: string;
  acres: string;
  zip: string;
  phone: string;
}

export function mapRow(cells: string[], mapping: Mapping): MappedRow {
  return {
    fips: cell(cells, mapping.fips),
    apn: cell(cells, mapping.apn),
    state: cell(cells, mapping.state),
    county: cell(cells, mapping.county),
    ownerName: cell(cells, mapping.ownerName),
    acres: cell(cells, mapping.acres),
    zip: cell(cells, mapping.zip),
    phone: cell(cells, mapping.phone),
  };
}
