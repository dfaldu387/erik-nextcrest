// Turns the filter panel's choices into a Land Portal filter request. Pure functions, so they can be tested offline.
// Filter keys and value shapes come from the Land Portal API: /filter-data/filters-list and /filter-data/filter-values.

export const STATE_CODES: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT',
  Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL',
  Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE',
  Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC',
  'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA',
  Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
};

export interface Range {
  min?: number;
  max?: number;
}

export interface PanelFilters {
  fips: string[];
  cities: string[];
  zips: string[];
  vacantLots: boolean;
  vacantSources: string[];
  landUseCodes: string[];
  acres: Range;
  lotSqft: Range;
}

export const EMPTY_FILTERS: PanelFilters = {
  fips: [],
  cities: [],
  zips: [],
  vacantLots: false,
  vacantSources: [],
  landUseCodes: [],
  acres: {},
  lotSqft: {},
};

// Splits "a, b ,c" into trimmed, non-empty values.
export function splitList(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

// Land Portal ranges: both bounds use is_between; a single bound uses min or max alone, as in the API examples.
export function rangeFilter(range: Range): Record<string, unknown> | null {
  const { min, max } = range;
  const hasMin = typeof min === 'number' && Number.isFinite(min);
  const hasMax = typeof max === 'number' && Number.isFinite(max);
  if (!hasMin && !hasMax) return null;
  if (hasMin && hasMax) {
    return { operator: 'range', comparison: 'is_between', value: { min, max } };
  }
  return { operator: 'range', value: hasMin ? { min } : { max } };
}

export function buildSearchFilters(input: PanelFilters): Record<string, unknown> {
  if (input.fips.length === 0) {
    throw new Error('Choose at least one county before searching.');
  }
  const filters: Record<string, unknown> = {
    fips: { operator: 'condition', comparison: 'is', value: input.fips },
  };
  if (input.cities.length > 0) {
    filters.situscity = { operator: 'condition', comparison: 'is', value: input.cities.map((c) => c.toUpperCase()) };
  }
  if (input.zips.length > 0) {
    filters.situszip5 = { operator: 'condition', comparison: 'is', value: input.zips };
  }
  if (input.vacantLots) {
    filters.vacant = { operator: 'boolean', value: true };
  }
  if (input.vacantSources.length > 0) {
    filters.vacantflag = { operator: 'condition', comparison: 'is', value: input.vacantSources };
  }
  if (input.landUseCodes.length > 0) {
    filters.landusecode = { operator: 'condition', comparison: 'is', value: input.landUseCodes };
  }
  const acres = rangeFilter(input.acres);
  if (acres) filters.lotsizeacres = acres;
  const sqft = rangeFilter(input.lotSqft);
  if (sqft) filters.lotsizesqft = sqft;
  return filters;
}

// Parses the number typed into a range box. Blank or invalid input means "no bound".
export function parseBound(value: string): number | undefined {
  const cleaned = value.replace(/,/g, '').trim();
  if (cleaned === '') return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

// Reads the county names from /filter-data/filter-values?filter=fips.
// Shape: { "Alabama": { "01001": "Autauga", ... }, ... }
export function countiesByState(raw: unknown): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [state, counties] of Object.entries(raw as Record<string, unknown>)) {
    if (!counties || typeof counties !== 'object') continue;
    const map: Record<string, string> = {};
    for (const [fips, name] of Object.entries(counties as Record<string, unknown>)) {
      if (typeof name === 'string') map[fips] = name;
    }
    out[state] = map;
  }
  return out;
}

// State names by FIPS prefix (the first two digits of a county FIPS code). Used to group V2 county values by state.
const STATE_BY_FIPS_PREFIX: Record<string, string> = {
  '01': 'Alabama', '02': 'Alaska', '04': 'Arizona', '05': 'Arkansas', '06': 'California', '08': 'Colorado',
  '09': 'Connecticut', '10': 'Delaware', '11': 'District of Columbia', '12': 'Florida', '13': 'Georgia', '15': 'Hawaii',
  '16': 'Idaho', '17': 'Illinois', '18': 'Indiana', '19': 'Iowa', '20': 'Kansas', '21': 'Kentucky', '22': 'Louisiana',
  '23': 'Maine', '24': 'Maryland', '25': 'Massachusetts', '26': 'Michigan', '27': 'Minnesota', '28': 'Mississippi',
  '29': 'Missouri', '30': 'Montana', '31': 'Nebraska', '32': 'Nevada', '33': 'New Hampshire', '34': 'New Jersey',
  '35': 'New Mexico', '36': 'New York', '37': 'North Carolina', '38': 'North Dakota', '39': 'Ohio', '40': 'Oklahoma',
  '41': 'Oregon', '42': 'Pennsylvania', '44': 'Rhode Island', '45': 'South Carolina', '46': 'South Dakota',
  '47': 'Tennessee', '48': 'Texas', '49': 'Utah', '50': 'Vermont', '51': 'Virginia', '53': 'Washington',
  '54': 'West Virginia', '55': 'Wisconsin', '56': 'Wyoming',
};

// V2 county values are a flat map of FIPS code to county name. This regroups them as state -> FIPS -> county,
// the shape the Search & Buy county picker reads. Codes whose state is unknown are left out.
export function countiesFromFips(flat: unknown): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  if (!flat || typeof flat !== 'object') return out;
  for (const [fips, county] of Object.entries(flat as Record<string, unknown>)) {
    const state = STATE_BY_FIPS_PREFIX[fips.slice(0, 2)];
    if (!state || typeof county !== 'string') continue;
    (out[state] ??= {})[fips] = county;
  }
  return out;
}

// V2 land-use values are a flat map of code to label, with no categories. They are shown as one group.
export function landUseFromFlat(flat: unknown): { category: string; codes: { code: string; label: string }[] }[] {
  return landUseGroups({ 'Land use codes': flat });
}

// Reads land-use codes from /filter-data/filter-values?filter=landusecode.
// Shape: { "Category": { "1024": "Label", ... }, ... }. Returns groups sorted by category.
export function landUseGroups(raw: unknown): { category: string; codes: { code: string; label: string }[] }[] {
  if (!raw || typeof raw !== 'object') return [];
  return Object.entries(raw as Record<string, unknown>)
    .filter(([, codes]) => codes && typeof codes === 'object')
    .map(([category, codes]) => ({
      category,
      codes: Object.entries(codes as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .map(([code, label]) => ({ code, label }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

// Reads vacancy sources from /filter-data/filter-values?filter=vacantflag. Shape: { "vacantflag": { "B": "Bank Owned" } }.
export function vacancySources(raw: unknown): { code: string; label: string }[] {
  const map = raw && typeof raw === 'object' ? ((raw as Record<string, unknown>).vacantflag as Record<string, unknown> | undefined) : undefined;
  if (!map || typeof map !== 'object') return [];
  return Object.entries(map)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// Reads city or ZIP values from /filter-data/filter-values?filter=<key>&fips=<code>.
// Shape: { "situscity": ["BRANFORD", "MAYO"] }. Returns a sorted, de-duplicated list.
export function valuesFor(raw: unknown, key: string): string[] {
  const list = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[key] : undefined;
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim()))].sort();
}
