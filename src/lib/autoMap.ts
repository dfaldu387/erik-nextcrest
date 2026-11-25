import { MAPPING_TARGETS, normalizeHeader } from './importMapping';
import type { Mapping, TargetKey } from './importMapping';

const STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME',
  'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA',
  'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]);

// Two-digit state FIPS prefixes, so a 5-digit county FIPS can be told apart from a ZIP code.
const FIPS_STATE_PREFIXES = new Set([
  '01', '02', '04', '05', '06', '08', '09', '10', '11', '12', '13', '15', '16', '17', '18', '19', '20', '21', '22',
  '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '40', '41',
  '42', '44', '45', '46', '47', '48', '49', '50', '51', '53', '54', '55', '56',
]);

const ACCEPT_THRESHOLD = 0.6;
const HEADER_BONUS = 0.2;
const SAMPLE_SIZE = 300;

interface ColumnSample {
  header: string;
  index: number;
  values: string[];
}

function ratio(values: string[], test: (v: string) => boolean): number {
  if (values.length === 0) return 0;
  return values.filter(test).length / values.length;
}

function digitRatio(value: string): number {
  return value.length === 0 ? 0 : (value.match(/\d/g)?.length ?? 0) / value.length;
}

function phoneDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function distinctRatio(values: string[]): number {
  return values.length === 0 ? 0 : new Set(values).size / values.length;
}

// Scores how well a column's values look like one target field, from 0 to 1.
// Each target has a value test; the column's header only adds a small bonus.
function valueScore(key: TargetKey, values: string[]): number {
  switch (key) {
    case 'state':
      return ratio(values, (v) => /^[A-Za-z]{2}$/.test(v) && STATE_CODES.has(v.toUpperCase()));

    case 'fips': {
      const fipsLike = ratio(values, (v) => /^\d{5}$/.test(v) && FIPS_STATE_PREFIXES.has(v.slice(0, 2)));
      const zipLike = ratio(values, (v) => /^\d{5}(-\d{4})?$/.test(v));
      // Most 5-digit codes are also valid ZIPs, so values alone are not enough. The header decides.
      return zipLike > 0.9 ? fipsLike * 0.5 : fipsLike;
    }

    case 'zip': {
      const fipsLike = ratio(values, (v) => /^\d{5}$/.test(v) && FIPS_STATE_PREFIXES.has(v.slice(0, 2)));
      const zipLike = ratio(values, (v) => /^\d{5}(-\d{4})?$/.test(v));
      return fipsLike > 0.9 ? zipLike * 0.5 : zipLike;
    }

    case 'phone':
      return ratio(values, (v) => {
        const digits = phoneDigits(v);
        return (digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))) && digitRatio(v) >= 0.6;
      });

    case 'acres':
      return ratio(values, (v) => {
        if (!/^\d+(\.\d+)?$/.test(v)) return false;
        const n = Number(v);
        return n > 0 && n < 100000 && (v.includes('.') || n < 1000);
      });

    case 'apn':
      return ratio(values, (v) => {
        const digits = digitRatio(v);
        return v.length >= 6 && digits >= 0.5 && /^[0-9A-Za-z][0-9A-Za-z.\-\/ _]*$/.test(v);
      });

    case 'ownerName':
      return ratio(values, (v) => /[A-Za-z]{2,}/.test(v) && v.includes(' ') && digitRatio(v) < 0.1 && v.length >= 5);

    case 'county': {
      const textual = ratio(values, (v) => /^[A-Za-z][A-Za-z .'-]{2,24}$/.test(v) && !STATE_CODES.has(v.toUpperCase()));
      // Counties repeat across rows; owner names mostly do not.
      return distinctRatio(values) <= 0.5 ? textual : textual * 0.4;
    }
  }
}

function columnSamples(headers: string[], rows: string[][]): ColumnSample[] {
  const sample = rows.slice(0, SAMPLE_SIZE);
  return headers.map((header, index) => ({
    header: normalizeHeader(header),
    index,
    values: sample.map((r) => (r[index] ?? '').replace(/\s+/g, ' ').trim()).filter((v) => v !== ''),
  }));
}

export interface AutoMapResult {
  mapping: Mapping;
  confidence: Partial<Record<TargetKey, number>>;
}

// Chooses a column for each field from the values it contains. Each column is used for at most one field.
// Fields with no column above the threshold stay unmapped (-1), so the user decides them.
export function autoMap(headers: string[], rows: string[][]): AutoMapResult {
  const columns = columnSamples(headers, rows);

  const candidates: { key: TargetKey; index: number; score: number }[] = [];
  for (const target of MAPPING_TARGETS) {
    for (const column of columns) {
      const base = valueScore(target.key, column.values);
      const hinted = target.pattern.test(column.header);
      // The header bonus is not capped, so it can separate two columns that look alike
      // (for example PROPERTY COUNTY and MAILING CITY). Confidence is capped separately.
      const score = base + (hinted ? HEADER_BONUS : 0);
      if (base > 0 && (score >= ACCEPT_THRESHOLD || (hinted && base >= 0.3))) {
        candidates.push({ key: target.key, index: column.index, score });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const mapping = Object.fromEntries(MAPPING_TARGETS.map((t) => [t.key, -1])) as Mapping;
  const confidence: Partial<Record<TargetKey, number>> = {};
  const usedColumns = new Set<number>();

  for (const candidate of candidates) {
    if (mapping[candidate.key] >= 0 || usedColumns.has(candidate.index)) continue;
    mapping[candidate.key] = candidate.index;
    confidence[candidate.key] = Math.round(Math.min(1, candidate.score) * 100) / 100;
    usedColumns.add(candidate.index);
  }

  return { mapping, confidence };
}
