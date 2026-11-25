import { describe, expect, it } from 'vitest';
import {
  buildSearchFilters,
  countiesByState,
  EMPTY_FILTERS,
  landUseGroups,
  parseBound,
  rangeFilter,
  splitList,
  STATE_CODES,
  vacancySources,
} from './landportalFilters';

describe('buildSearchFilters', () => {
  it('needs at least one county', () => {
    expect(() => buildSearchFilters(EMPTY_FILTERS)).toThrow(/county/i);
  });

  it('sends the county FIPS codes as a list', () => {
    const f = buildSearchFilters({ ...EMPTY_FILTERS, fips: ['12067', '12005'] });
    expect(f).toEqual({ fips: { operator: 'condition', comparison: 'is', value: ['12067', '12005'] } });
  });

  it('uppercases city names, as the API requires', () => {
    const f = buildSearchFilters({ ...EMPTY_FILTERS, fips: ['12067'], cities: ['Mayo', 'Ocean'] });
    expect(f.situscity).toEqual({ operator: 'condition', comparison: 'is', value: ['MAYO', 'OCEAN'] });
  });

  it('adds ZIP, vacancy and land-use filters only when chosen', () => {
    const f = buildSearchFilters({
      ...EMPTY_FILTERS,
      fips: ['12067'],
      zips: ['32066'],
      vacantLots: true,
      vacantSources: ['L', 'V'],
      landUseCodes: ['1024'],
    });
    expect(f.situszip5).toEqual({ operator: 'condition', comparison: 'is', value: ['32066'] });
    expect(f.vacant).toEqual({ operator: 'boolean', value: true });
    expect(f.vacantflag).toEqual({ operator: 'condition', comparison: 'is', value: ['L', 'V'] });
    expect(f.landusecode).toEqual({ operator: 'condition', comparison: 'is', value: ['1024'] });
  });

  it('leaves out filters that were not set', () => {
    const f = buildSearchFilters({ ...EMPTY_FILTERS, fips: ['12067'] });
    expect(Object.keys(f)).toEqual(['fips']);
  });

  it('adds acre and lot-size ranges', () => {
    const f = buildSearchFilters({ ...EMPTY_FILTERS, fips: ['12067'], acres: { min: 1, max: 5 }, lotSqft: { min: 2000 } });
    expect(f.lotsizeacres).toEqual({ operator: 'range', comparison: 'is_between', value: { min: 1, max: 5 } });
    expect(f.lotsizesqft).toEqual({ operator: 'range', value: { min: 2000 } });
  });
});

describe('rangeFilter', () => {
  it('returns null when neither bound is set', () => {
    expect(rangeFilter({})).toBeNull();
  });

  it('uses max alone when only a maximum is given', () => {
    expect(rangeFilter({ max: 10 })).toEqual({ operator: 'range', value: { max: 10 } });
  });
});

describe('parseBound', () => {
  it('reads numbers with commas and ignores blanks', () => {
    expect(parseBound('2,000')).toBe(2000);
    expect(parseBound('  ')).toBeUndefined();
    expect(parseBound('abc')).toBeUndefined();
  });
});

describe('splitList', () => {
  it('splits, trims and drops empty values', () => {
    expect(splitList(' Mayo, , Ocean ,')).toEqual(['Mayo', 'Ocean']);
  });
});

describe('countiesByState', () => {
  it('reads state groups of FIPS to county names', () => {
    const map = countiesByState({ Florida: { '12067': 'Lafayette', '12005': 'Bay' } });
    expect(map.Florida['12067']).toBe('Lafayette');
  });
});

describe('landUseGroups and vacancySources', () => {
  it('groups land-use codes by category, sorted by code', () => {
    const groups = landUseGroups({ 'Misc': { '0011': 'Pipeline', '0010': 'General' } });
    expect(groups).toEqual([{ category: 'Misc', codes: [{ code: '0010', label: 'General' }, { code: '0011', label: 'Pipeline' }] }]);
  });

  it('reads vacancy sources', () => {
    expect(vacancySources({ vacantflag: { L: 'Listing Based', B: 'Bank Owned' } })).toEqual([
      { code: 'B', label: 'Bank Owned' },
      { code: 'L', label: 'Listing Based' },
    ]);
  });
});

describe('STATE_CODES', () => {
  it('maps state names to two-letter codes', () => {
    expect(STATE_CODES.Florida).toBe('FL');
    expect(STATE_CODES['North Carolina']).toBe('NC');
  });
});

describe('valuesFor', () => {
  it('reads city and ZIP lists, sorted and without duplicates', async () => {
    const { valuesFor } = await import('./landportalFilters');
    expect(valuesFor({ situscity: ['MAYO', 'BRANFORD', 'MAYO'] }, 'situscity')).toEqual(['BRANFORD', 'MAYO']);
    expect(valuesFor({ situszip5: ['32066', '32008'] }, 'situszip5')).toEqual(['32008', '32066']);
    expect(valuesFor({}, 'situscity')).toEqual([]);
  });
});
